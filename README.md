# Pallet Estimator

Estimate how a whole job packs onto pallets/skids from its **Bill of Materials (BOM)** — the
only document available at estimate time. An Express API sends the BOM PDF to **Claude (Opus 4.8)**
with few-shot examples from real past jobs stored in MongoDB, and returns each pallet's
approximate **`W × L × H`** + weight, plus the total:

```json
{ "totalWeight": 12345, "palletCount": 3,
  "pallets": [ { "w": 47, "l": 104, "h": 60, "weight": 1300 } ],
  "reasoning": "…" }
```

## Stack
Node.js (ESM) · Express · MongoDB · `@anthropic-ai/sdk` · `pdf-parse` · PM2

## Setup
```bash
npm install
cp .env.example .env     # then put your ANTHROPIC_API_KEY in .env
npm run ingest           # load calibration examples from ./examples-data (see below)
npm run dev              # http://localhost:3005
```
Requires a local MongoDB (`mongodb://127.0.0.1:27017`) and an Anthropic API key.

## Calibration examples (`npm run ingest`)
Put one folder per past job under `examples-data/` (override with `EXAMPLES_DIR`):
```
examples-data/
  186148/
    186148.01.pdf … .NN.pdf   # material lists, one per shipment suffix
    BOM.pdf                    # bill of materials (unit weights)
    MJQ.txt                    # the skid list (ground truth: dims + weight per skid)
```
`npm run ingest` walks those folders and, per job, has Claude reconcile the BOM + accusés + skid
list into a **closed** job (BOM → all the job's pallets, normalized to `W × L × H` + weight). It's
**incremental** — already-loaded jobs are skipped (`--force` to re-process). The accusés are
calibration-only; at estimate time just the BOM is used.

## Environment
| var | purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key — **required** (console.anthropic.com) |
| `MONGODB_URI` | Mongo connection (default `mongodb://127.0.0.1:27017`) |
| `PORT` | HTTP port (set by PM2: 3004 prod / 3005 dev) |
| `DB_NAME` | Mongo database (set by PM2: `pallet-estimator` / `pallet-estimator-dev`) |
| `PALLET_DB_NAME` | Overrides `DB_NAME` — set this when embedding so the app keeps its own DB apart from the host app's |
| `EXAMPLES_DIR` | Folder of example jobs for `npm run ingest` (default `./examples-data`) |

## How it learns (the hub)
Estimate a BOM → the job is saved as **open** (awaiting results). When the real pallets are
known, upload the `.txt` (+ optional accusés) to **close** it — it becomes a calibration example
and the next estimates improve. Bulk-seed past jobs with `npm run ingest`.

## API
- `POST /api/estimate` — `{ pdfs:[{name,dataB64}], jobNo?, materialList? }` → `{ totalWeight, palletCount, pallets:[{w,l,h,weight}], reasoning, jobNo }` (saves an **open** job)
- `GET /api/jobs` — list jobs (open = awaiting results, closed = calibrating)
- `POST /api/jobs/:id/close` — `{ skidText, accuses?:[{name,dataB64}] }` → reconciles the real results into a calibration example
- `DELETE /api/jobs/:id` · `GET /api/health`

## Embed in another Express app (one server)
The whole app is also an Express **router** (`palletRouter`), so an existing app — e.g. the
calendar app — can serve it instead of you running a second server:

```js
import { palletRouter } from "pallet-estimator";   // CommonJS host: const { palletRouter } = await import("pallet-estimator")
app.use("/pallets", palletRouter);                 // page at /pallets, API at /pallets/api/*
```
- **Mount it before any global `express.json()`** — the router brings its own 30 MB body parser
  (base64 PDFs ride in the body); a smaller host limit would reject uploads.
- It connects to Mongo lazily, so the host only has to `app.use(...)` — no `connectDB()` call needed.
- Set **`PALLET_DB_NAME`** so it keeps its own database, separate from the host app's `DB_NAME`.
- The host process needs **`ANTHROPIC_API_KEY`** in its environment.

Install it as a local dependency in the host app: `npm install /path/to/pallet-estimator`.

## Deploy (PM2)
```bash
pm2 start ecosystem.config.cjs       # prod  (:3004, db pallet-estimator)
pm2 start ecosystem.dev.config.cjs   # dev   (:3005, db pallet-estimator-dev)
pm2 save
```
See **CLAUDE.md** for the full dev → prod workflow, backups, and rollback procedure.
