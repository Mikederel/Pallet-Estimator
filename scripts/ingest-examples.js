import "dotenv/config";
import fs from "fs";
import path from "path";
import { connectDB, collections } from "../src/db.js";
import { reconcileJob } from "../src/reconcile.js";
import { pdfTextFromFile } from "../src/pdf.js";

// Bulk-loads past jobs from example folders into the jobs collection as
// CLOSED (calibration) jobs. Incremental by default: a folder already loaded
// as a closed job is skipped — pass --force to re-process everything.
const EXAMPLES_DIR = process.env.EXAMPLES_DIR || path.join(process.cwd(), "examples-data");
const FORCE = process.argv.includes("--force");

async function ingestJob(db, dir) {
  const jobNo = path.basename(dir);

  if (!FORCE) {
    const existing = await db.collection("jobs").findOne({ jobNo, status: "closed" });
    if (existing) {
      console.log(`[ingest] ${jobNo}: already loaded — skipped (use --force to re-process)`);
      return 0;
    }
  }

  const files = fs.readdirSync(dir);
  const txtFile = files.find((f) => f.toLowerCase().endsWith(".txt"));
  const pdfs = files.filter((f) => f.toLowerCase().endsWith(".pdf"));
  const bomFile = pdfs.find((f) => /(^|[^0-9])bom\.pdf$/i.test(f));
  if (!txtFile || !bomFile) {
    console.log(`[ingest] ${jobNo}: skipped (need BOM.pdf and a .txt skid list)`);
    return 0;
  }

  // Accusés = every PDF except the BOM (handles <job>.01.pdf… and single <order>.pdf).
  const accuseFiles = pdfs.filter((f) => f !== bomFile).sort();
  const bomText = await pdfTextFromFile(path.join(dir, bomFile));
  const skidText = fs.readFileSync(path.join(dir, txtFile), "utf8");
  const accuses = [];
  for (const f of accuseFiles) {
    const m = f.match(/\.(\d{2})\.pdf$/i);
    const label = m ? `shipment .${m[1]}` : `shipment ${f.replace(/\.pdf$/i, "")}`;
    accuses.push({ label, text: await pdfTextFromFile(path.join(dir, f)) });
  }

  const norm = await reconcileJob({ bomText, accuses, skidText });
  const now = new Date();
  await db.collection("jobs").updateOne(
    { jobNo },
    {
      $set: {
        jobNo,
        source: txtFile.replace(/\.txt$/i, ""),
        bomText,
        bomSummary: norm.bomSummary,
        actual: { pallets: norm.pallets, palletCount: norm.palletCount, totalWeight: norm.totalWeight, note: norm.note },
        status: "closed",
        closedAt: now,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );
  console.log(`[ingest] ${jobNo}: ${norm.palletCount} pallet(s), ${norm.totalWeight} lb${norm.note ? ` — ${norm.note}` : ""}`);
  return 1;
}

const run = async () => {
  if (!fs.existsSync(EXAMPLES_DIR)) {
    console.error(`[ingest] EXAMPLES_DIR not found: ${EXAMPLES_DIR}
Create it (one subfolder per job, each with BOM.pdf + the .txt skid list, plus the accusé PDFs), or set EXAMPLES_DIR.`);
    process.exit(1);
  }
  const db = await connectDB();
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
      total += await ingestJob(db, dir);
    } catch (e) {
      console.error(`[ingest] ${path.basename(dir)}: ERROR ${e.message}`);
    }
  }
  console.log(`[ingest] done — ${total} job(s) loaded/updated (closed). ${FORCE ? "" : "Already-loaded jobs were skipped; use --force to re-process."}`);
  process.exit(0);
};

run().catch((e) => {
  console.error("[ingest] failed:", e);
  process.exit(1);
});
