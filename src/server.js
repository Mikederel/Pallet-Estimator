import "dotenv/config";
import express from "express";
import { ObjectId } from "mongodb";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { connectDB, collections } from "./db.js";
import { estimatePallets } from "./estimator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3005;

const app = express();
app.use(express.json({ limit: "30mb" })); // base64-encoded PDFs ride in the JSON body
app.use(express.static(join(__dirname, "..", "public")));

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Estimate pallets from uploaded PDFs (material lists + optional BOM) and/or pasted text.
app.post("/api/estimate", async (req, res) => {
  const { materialList, pdfs } = req.body || {};
  const hasText = typeof materialList === "string" && materialList.trim().length > 0;
  const validPdfs = Array.isArray(pdfs) ? pdfs.filter((p) => p && typeof p.dataB64 === "string") : [];
  if (!hasText && !validPdfs.length) {
    return res.status(400).json({ error: "Provide pdfs ([{name,dataB64}]) and/or materialList (text)." });
  }
  try {
    const result = await estimatePallets({ materialList, pdfs: validPdfs });
    res.json(result);
  } catch (err) {
    console.error("[estimate] error:", err);
    res.status(502).json({ error: err.message || "Estimation failed" });
  }
});

// List ingested examples (few-shot training data), metadata only.
app.get("/api/examples", async (req, res) => {
  const docs = await collections
    .examples()
    .find({ pallets: { $type: "array" } })
    .project({ job: 1, source: 1, palletCount: 1, totalWeight: 1, note: 1 })
    .sort({ job: 1 })
    .toArray();
  res.json(docs);
});

// Delete an example.
app.delete("/api/examples/:id", async (req, res) => {
  try {
    const { deletedCount } = await collections.examples().deleteOne({ _id: new ObjectId(req.params.id) });
    if (!deletedCount) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: "invalid id" });
  }
});

connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(`[server] pallet-estimator listening on :${PORT}`));
  })
  .catch((err) => {
    console.error("[server] failed to start:", err);
    process.exit(1);
  });
