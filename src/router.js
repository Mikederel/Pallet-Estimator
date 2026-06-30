import express from "express";
import { ObjectId } from "mongodb";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { connectDB, collections } from "./db.js";
import { estimatePallets } from "./estimator.js";
import { reconcileJob } from "./reconcile.js";
import { pdfTextFromBase64 } from "./pdf.js";

// Everything the Pallet Estimator serves, as a self-contained Express router.
// Mount it anywhere:
//   app.use(palletRouter)            // standalone — page at "/", API at "/api/*"
//   app.use("/pallets", palletRouter) // embedded   — page at "/pallets", API at "/pallets/api/*"
// The router brings its own large-body JSON parser and lazily connects to Mongo,
// so a host app only has to mount it (BEFORE any global express.json(), so the
// host's smaller body limit doesn't reject the base64 PDFs that ride in the body).
const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");

export const palletRouter = express.Router();

// base64-encoded PDFs ride in the JSON body — scoped to this router only.
palletRouter.use(express.json({ limit: "30mb" }));

// Static UI first, so the page + assets load even if Mongo is momentarily down;
// non-file requests fall through to the routes below.
palletRouter.use(express.static(PUBLIC_DIR));

// Liveness check — intentionally before the DB gate so it needs no database.
palletRouter.get("/api/health", (req, res) => res.json({ ok: true }));

// Everything past here touches Mongo — connect lazily (idempotent) so embedding
// is just app.use(); a host app never has to call connectDB() itself.
palletRouter.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error("[pallet] db connection failed:", err);
    res.status(503).json({ error: "Database unavailable" });
  }
});

// Estimate pallets from a BOM PDF. Saves the job as "open" (awaiting results).
palletRouter.post("/api/estimate", async (req, res) => {
  const { jobNo, materialList, pdfs } = req.body || {};
  const hasText = typeof materialList === "string" && materialList.trim().length > 0;
  const validPdfs = Array.isArray(pdfs) ? pdfs.filter((p) => p && typeof p.dataB64 === "string") : [];
  if (!hasText && !validPdfs.length) {
    return res.status(400).json({ error: "Provide the BOM as pdfs ([{name,dataB64}]) and/or materialList (text)." });
  }
  try {
    const result = await estimatePallets({ jobNo, materialList, pdfs: validPdfs });
    res.json(result);
  } catch (err) {
    console.error("[estimate] error:", err);
    res.status(502).json({ error: err.message || "Estimation failed" });
  }
});

// List jobs (open = awaiting real results, closed = calibrating).
palletRouter.get("/api/jobs", async (req, res) => {
  const docs = await collections
    .jobs()
    .find({})
    .project({
      jobNo: 1, status: 1, estimatedAt: 1, closedAt: 1,
      "estimate.palletCount": 1, "estimate.totalWeight": 1,
      "actual.palletCount": 1, "actual.totalWeight": 1, "actual.note": 1,
    })
    .sort({ updatedAt: -1 })
    .toArray();
  res.json(docs);
});

// Close a job: upload the real skid list (.txt text) + optional accusé PDFs.
// Reconciles them with the stored BOM into the calibration record.
palletRouter.post("/api/jobs/:id/close", async (req, res) => {
  const { skidText, accuses } = req.body || {};
  if (!skidText || typeof skidText !== "string" || !skidText.trim()) {
    return res.status(400).json({ error: "skidText (the real pallet list, as text) is required." });
  }
  let job;
  try {
    job = await collections.jobs().findOne({ _id: new ObjectId(req.params.id) });
  } catch {
    return res.status(400).json({ error: "invalid id" });
  }
  if (!job) return res.status(404).json({ error: "job not found" });

  try {
    const accuseTexts = [];
    for (const a of Array.isArray(accuses) ? accuses : []) {
      if (a?.dataB64) {
        accuseTexts.push({ label: `shipment ${(a.name || "").replace(/\.pdf$/i, "")}`, text: await pdfTextFromBase64(a.dataB64) });
      }
    }
    const norm = await reconcileJob({ bomText: job.bomText || "", accuses: accuseTexts, skidText: skidText.trim() });
    const now = new Date();
    await collections.jobs().updateOne(
      { _id: job._id },
      {
        $set: {
          bomSummary: norm.bomSummary,
          actual: { pallets: norm.pallets, palletCount: norm.palletCount, totalWeight: norm.totalWeight, note: norm.note },
          status: "closed",
          closedAt: now,
          updatedAt: now,
        },
      }
    );
    res.json({ ok: true, actual: norm });
  } catch (err) {
    console.error("[close] error:", err);
    res.status(502).json({ error: err.message || "Could not close the job" });
  }
});

// Delete a job.
palletRouter.delete("/api/jobs/:id", async (req, res) => {
  try {
    const { deletedCount } = await collections.jobs().deleteOne({ _id: new ObjectId(req.params.id) });
    if (!deletedCount) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: "invalid id" });
  }
});
