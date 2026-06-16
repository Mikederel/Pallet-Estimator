# Pallet Estimator

Estimate how many shipping pallets a material list needs. An Express API sends your
material list to **Claude (Opus 4.8)** together with few-shot worked examples stored in
MongoDB, and returns a structured estimate `{ pallets, reasoning, breakdown }`.

## Stack
Node.js (ESM) · Express · MongoDB · `@anthropic-ai/sdk` · PM2

## Setup
```bash
npm install
cp .env.example .env     # then put your ANTHROPIC_API_KEY in .env
npm run seed             # optional: load sample few-shot examples
npm run dev              # http://localhost:3005
```
Requires a local MongoDB (`mongodb://127.0.0.1:27017`) and an Anthropic API key.

## Environment
| var | purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key — **required** (console.anthropic.com) |
| `MONGODB_URI` | Mongo connection (default `mongodb://127.0.0.1:27017`) |
| `PORT` | HTTP port (set by PM2: 3004 prod / 3005 dev) |
| `DB_NAME` | Mongo database (set by PM2: `pallet-estimator` / `pallet-estimator-dev`) |

## API
- `POST /api/estimate` — `{ materialList: string }` → `{ pallets, reasoning, breakdown }`
- `GET /api/examples` · `POST /api/examples` · `DELETE /api/examples/:id` — manage few-shot examples
- `GET /api/health`

## Deploy (PM2)
```bash
pm2 start ecosystem.config.cjs       # prod  (:3004, db pallet-estimator)
pm2 start ecosystem.dev.config.cjs   # dev   (:3005, db pallet-estimator-dev)
pm2 save
```
See **CLAUDE.md** for the full dev → prod workflow, backups, and rollback procedure.
