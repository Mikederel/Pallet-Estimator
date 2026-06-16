import "dotenv/config";
import { connectDB, collections } from "../src/db.js";

// Illustrative seed data so the estimator has a few-shot baseline.
// Replace these with your real pallet lists (or add them via the UI / POST /api/examples).
const SEED = [
  {
    materials: [
      { name: "Carton A", quantity: 40, length: 600, width: 400, height: 300, weight: 12 },
      { name: "Carton B", quantity: 20, length: 800, width: 600, height: 400, weight: 25 },
    ],
    pallets: 2,
    notes: "Cartons A stack 4 high; cartons B stack 2 high on a EUR pallet (1200x800).",
  },
  {
    materials: [{ name: "Drum 200L", quantity: 8, length: 600, width: 600, height: 900, weight: 210 }],
    pallets: 4,
    notes: "Drums are not stackable; 2 drums per pallet due to weight + footprint.",
  },
];

const run = async () => {
  await connectDB();
  const col = collections.examples();
  const count = await col.countDocuments();
  if (count > 0 && !process.argv.includes("--force")) {
    console.log(`[seed] examples collection already has ${count} doc(s) — skipping (pass --force to add anyway).`);
    process.exit(0);
  }
  const docs = SEED.map((d) => ({ ...d, createdAt: new Date() }));
  await col.insertMany(docs);
  console.log(`[seed] inserted ${docs.length} example(s).`);
  process.exit(0);
};

run().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
