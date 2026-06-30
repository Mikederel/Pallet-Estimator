import "dotenv/config";
import express from "express";
import { connectDB } from "./db.js";
import { palletRouter } from "./router.js";

const PORT = process.env.PORT || 3005;

// Standalone server: mount the same router at the root (page at "/", API at
// "/api/*"). The calendar app mounts palletRouter under "/pallets" instead —
// see README → "Embed in another Express app".
const app = express();
app.use(palletRouter);

connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(`[server] pallet-estimator listening on :${PORT}`));
  })
  .catch((err) => {
    console.error("[server] failed to start:", err);
    process.exit(1);
  });
