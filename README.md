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
list into one example (BOM → all the job's pallets, normalized to `W × L × H` + weight). The
accusés (`.NN.pdf`) are calibration-only — at estimate time just the BOM is used.

## Environment
| var | purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key — **required** (console.anthropic.com) |
| `MONGODB_URI` | Mongo connection (default `mongodb://127.0.0.1:27017`) |
| `PORT` | HTTP port (set by PM2: 3004 prod / 3005 dev) |
| `DB_NAME` | Mongo database (set by PM2: `pallet-estimator` / `pallet-estimator-dev`) |
| `EXAMPLES_DIR` | Folder of example jobs for `npm run ingest` (default `./examples-data`) |

## API
- `POST /api/estimate` — `{ pdfs: [{name, dataB64}], materialList?: string }` → `{ totalWeight, palletCount, pallets:[{w,l,h,weight}], reasoning }`
- `GET /api/examples` · `DELETE /api/examples/:id` — list / remove calibration examples
- `GET /api/health`

## Deploy (PM2)
```bash
pm2 start ecosystem.config.cjs       # prod  (:3004, db pallet-estimator)
pm2 start ecosystem.dev.config.cjs   # dev   (:3005, db pallet-estimator-dev)
pm2 save
```
See **CLAUDE.md** for the full dev → prod workflow, backups, and rollback procedure.
