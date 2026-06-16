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
app.use(express.json({ limit: "1mb" }));
app.use(express.static(join(__dirname, "..", "public")));

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Estimate pallets from a free-text material list.
app.post("/api/estimate", async (req, res) => {
  const { materialList } = req.body || {};
  if (!materialList || typeof materialList !== "string" || !materialList.trim()) {
    return res.status(400).json({ error: "materialList (non-empty string) is required" });
  }
  try {
    const result = await estimatePallets(materialList.trim());
    res.json(result);
  } catch (err) {
    console.error("[estimate] error:", err);
    res.status(502).json({ error: err.message || "Estimation failed" });
  }
});

// List worked examples (few-shot training data).
app.get("/api/examples", async (req, res) => {
  const docs = await collections.examples().find().sort({ createdAt: -1 }).toArray();
  res.json(docs);
});

// Add a worked example (structured materials[] OR free-text rawText).
app.post("/api/examples", async (req, res) => {
  const { materials, rawText, pallets, notes } = req.body || {};
  const hasMaterials = Array.isArray(materials) && materials.length > 0;
  const hasRaw = typeof rawText === "string" && rawText.trim().length > 0;
  if (typeof pallets !== "number" || (!hasMaterials && !hasRaw)) {
    return res
      .status(400)
      .json({ error: "Provide pallets (number) and either materials (array) or rawText (string)." });
  }
  const doc = { pallets, notes: notes || "", createdAt: new Date() };
  if (hasMaterials) doc.materials = materials;
  if (hasRaw) doc.rawText = rawText.trim();
  const { insertedId } = await collections.examples().insertOne(doc);
  res.status(201).json({ _id: insertedId, ...doc });
});

// Delete a worked example.
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
