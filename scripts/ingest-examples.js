import "dotenv/config";
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { connectDB } from "../src/db.js";

const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse");

const MODEL = "claude-opus-4-8";
const EXAMPLES_DIR = process.env.EXAMPLES_DIR || path.join(process.cwd(), "examples-data");

// Claude reconciles a job's BOM + per-shipment accusés + skid list into ONE
// job-level example: the BOM (the estimate-time input) -> all the pallets it
// became (the result we want to predict).
const PALLET = {
  type: "object",
  properties: { w: { type: "number" }, l: { type: "number" }, h: { type: "number" }, weight: { type: "number" } },
  required: ["w", "l", "h", "weight"],
  additionalProperties: false,
};
const JOB_SCHEMA = {
  type: "object",
  properties: {
    bomSummary: { type: "string", description: "Concise normalized summary of the BOM: key product codes, quantities, unit + total weights" },
    pallets: { type: "array", items: PALLET, description: "Every pallet/skid the whole job became, normalized to W x L x H + weight, de-duplicated" },
    palletCount: { type: "number" },
    totalWeight: { type: "number", description: "Total weight of all pallets, lb" },
    note: { type: "string", description: "Coverage/confidence note (e.g. which shipments were imprecise or estimated)" },
  },
  required: ["bomSummary", "pallets", "palletCount", "totalWeight", "note"],
  additionalProperties: false,
};

async function pdfText(file) {
  const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(file)) });
  const r = await parser.getText();
  return (r.text || "").replace(/\n{3,}/g, "\n\n").trim();
}

async function getClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.includes("xxxx")) throw new Error("ANTHROPIC_API_KEY is not set in .env.");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  return new Anthropic();
}

async function ingestJob(client, db, dir) {
  const job = path.basename(dir);
  const files = fs.readdirSync(dir);
  const txtFile = files.find((f) => f.toLowerCase().endsWith(".txt"));
  const pdfs = files.filter((f) => f.toLowerCase().endsWith(".pdf"));
  const bomFile = pdfs.find((f) => /(^|[^0-9])bom\.pdf$/i.test(f));

  if (!txtFile || !bomFile) {
    console.log(`[ingest] ${job}: skipped (need BOM.pdf and a .txt skid list)`);
    return 0;
  }

  // Accusés = every PDF except the BOM. They may be named <job>.01.pdf,
  // <job>.02.pdf, … or, for a single-shipment job, just <ordernumber>.pdf.
  const accuseFiles = pdfs.filter((f) => f !== bomFile).sort();
  const bomText = await pdfText(path.join(dir, bomFile));
  const skidText = fs.readFileSync(path.join(dir, txtFile), "utf8");
  const accuses = [];
  for (const f of accuseFiles) {
    const m = f.match(/\.(\d{2})\.pdf$/i);
    const label = m ? `shipment .${m[1]}` : `shipment ${f.replace(/\.pdf$/i, "")}`;
    accuses.push({ label, text: await pdfText(path.join(dir, f)) });
  }

  const prompt = `You are building a calibration example for pallet estimation. The model will later see ONLY a Bill of Materials (BOM) and must predict the pallets the whole job becomes.

DIMENSIONS: output every pallet/skid as W x L x H in inches — W (width) first, normally <= 48"; L (length) the long side (<= ~145"); H (height) the vertical (<= ~68"). The skid list below may use an inconsistent order or format; REORDER each to W x L x H. Weights are pounds.

Produce ONE job-level result:
- bomSummary: a concise normalized summary of the BOM (product codes, quantities, unit + total weights).
- pallets: EVERY pallet/skid this job became, gathered from the skid list across all shipments, normalized to W x L x H + weight. De-duplicate overlapping/repeated sections. Where the skid list is imprecise, give your best estimate and say so in 'note'.
- palletCount, totalWeight, and a 'note' on coverage/confidence.

The per-shipment accusés (.01, .02, …) and the skid list are provided to help you map BOM items -> shipments -> pallets; they are NOT available at estimate time.

== BILL OF MATERIALS (BOM) ==
${bomText.slice(0, 16000)}

== SKID LIST (${txtFile}) ==
${skidText}

== PER-SHIPMENT ACCUSÉS (material lists, optional context) ==
${accuses.map((a) => `--- ${a.label} ---\n${a.text.slice(0, 3000)}`).join("\n\n") || "(none provided)"}`;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    messages: [{ role: "user", content: prompt }],
    output_config: { format: { type: "json_schema", schema: JOB_SCHEMA } },
  });

  const text = resp.content.find((b) => b.type === "text")?.text;
  if (!text) {
    console.log(`[ingest] ${job}: no output (stop_reason ${resp.stop_reason})`);
    return 0;
  }
  const ex = JSON.parse(text);
  if (!ex.pallets?.length) {
    console.log(`[ingest] ${job}: no pallets parsed — skipped`);
    return 0;
  }

  // One example per job — replace any prior docs for this job.
  await db.collection("examples").deleteMany({ job });
  await db.collection("examples").insertOne({
    job,
    source: txtFile.replace(/\.txt$/i, ""),
    bomSummary: ex.bomSummary,
    pallets: ex.pallets,
    palletCount: ex.palletCount,
    totalWeight: ex.totalWeight,
    note: ex.note,
    updatedAt: new Date(),
  });
  console.log(`[ingest] ${job}: ${ex.palletCount} pallet(s), ${ex.totalWeight} lb${ex.note ? ` — ${ex.note}` : ""}`);
  return 1;
}

const run = async () => {
  if (!fs.existsSync(EXAMPLES_DIR)) {
    console.error(`[ingest] EXAMPLES_DIR not found: ${EXAMPLES_DIR}
Create it (one subfolder per job, each with BOM.pdf + the .txt skid list, plus the .NN.pdf accusés), or set EXAMPLES_DIR.`);
    process.exit(1);
  }
  const db = await connectDB();
  const client = await getClient();
  const jobs = fs
    .readdirSync(EXAMPLES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(EXAMPLES_DIR, d.name));

  if (!jobs.length) {
    console.log(`[ingest] no job folders found in ${EXAMPLES_DIR}`);
    process.exit(0);
  }

  let total = 0;
  for (const dir of jobs) {
    try {
      total += await ingestJob(client, db, dir);
    } catch (e) {
      console.error(`[ingest] ${path.basename(dir)}: ERROR ${e.message}`);
    }
  }
  console.log(`[ingest] done — ${total} job example(s) in the examples collection.`);
  process.exit(0);
};

run().catch((e) => {
  console.error("[ingest] failed:", e);
  process.exit(1);
});
