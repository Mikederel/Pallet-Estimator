import "dotenv/config";
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { connectDB } from "../src/db.js";

const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse");

const MODEL = "claude-opus-4-8";
const EXAMPLES_DIR = process.env.EXAMPLES_DIR || path.join(process.cwd(), "examples-data");

// Claude normalizes each job's messy skid list into clean per-suffix examples.
const JOB_SCHEMA = {
  type: "object",
  properties: {
    examples: {
      type: "array",
      items: {
        type: "object",
        properties: {
          suffix: { type: "string", description: "Shipment suffix, e.g. 01" },
          reliable: { type: "boolean", description: "true only if this suffix has a clear material list AND a precise per-skid breakdown" },
          palletCount: { type: "number" },
          totalWeight: { type: "number", description: "Sum of pallet weights, lb" },
          pallets: {
            type: "array",
            items: {
              type: "object",
              properties: { w: { type: "number" }, l: { type: "number" }, h: { type: "number" }, weight: { type: "number" } },
              required: ["w", "l", "h", "weight"],
              additionalProperties: false,
            },
          },
        },
        required: ["suffix", "reliable", "palletCount", "totalWeight", "pallets"],
        additionalProperties: false,
      },
    },
  },
  required: ["examples"],
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
  const bomFile = files.find((f) => /(^|[^0-9])bom\.pdf$/i.test(f));
  const listFiles = files.filter((f) => /\.(\d{2})\.pdf$/i.test(f)).sort();

  if (!txtFile || !listFiles.length) {
    console.log(`[ingest] ${job}: skipped (need one .txt skid list and at least one .NN.pdf)`);
    return 0;
  }

  const skidText = fs.readFileSync(path.join(dir, txtFile), "utf8");
  const bomText = bomFile ? await pdfText(path.join(dir, bomFile)) : "";
  const lists = {};
  for (const f of listFiles) {
    const suffix = f.match(/\.(\d{2})\.pdf$/i)[1];
    lists[suffix] = await pdfText(path.join(dir, f));
  }

  const prompt = `You are normalizing real packing data into a training set for pallet estimation.

DIMENSIONS: output every pallet/skid as W x L x H in inches — W (width) first, normally <= 48"; L (length) the long side (<= ~145"); H (height) the vertical (<= ~68"). The skid list below may use an inconsistent order or format; REORDER each skid to W x L x H using these rules. Weights are pounds.

Return one entry per shipment suffix that has BOTH a material list (below) AND a clear, precise per-skid breakdown in the skid list. Set reliable=false for any suffix whose skid data is imprecise, combined across suffixes, or missing — those will be skipped.

== SKID LIST (${txtFile}) ==
${skidText}

== BILL OF MATERIALS (unit weights, optional) ==
${bomText ? bomText.slice(0, 12000) : "(none provided)"}

== MATERIAL LISTS BY SUFFIX ==
${Object.entries(lists).map(([s, t]) => `--- suffix ${s} ---\n${t.slice(0, 4000)}`).join("\n\n")}`;

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
  const { examples } = JSON.parse(text);

  let n = 0;
  for (const ex of examples) {
    if (!ex.reliable || !lists[ex.suffix] || !ex.pallets?.length) {
      console.log(`[ingest] ${job}.${ex.suffix}: skipped (unreliable or unmatched)`);
      continue;
    }
    await db.collection("examples").updateOne(
      { job, suffix: ex.suffix },
      {
        $set: {
          job,
          suffix: ex.suffix,
          source: txtFile.replace(/\.txt$/i, ""),
          materialList: lists[ex.suffix],
          pallets: ex.pallets,
          palletCount: ex.palletCount,
          totalWeight: ex.totalWeight,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
    n++;
    console.log(`[ingest] ${job}.${ex.suffix}: ${ex.palletCount} pallet(s), ${ex.totalWeight} lb`);
  }
  return n;
}

const run = async () => {
  if (!fs.existsSync(EXAMPLES_DIR)) {
    console.error(`[ingest] EXAMPLES_DIR not found: ${EXAMPLES_DIR}
Create it (one subfolder per job, each with .NN.pdf material lists + BOM.pdf + the .txt skid list), or set EXAMPLES_DIR.`);
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
  console.log(`[ingest] done — ${total} example(s) upserted into the examples collection.`);
  process.exit(0);
};

run().catch((e) => {
  console.error("[ingest] failed:", e);
  process.exit(1);
});
