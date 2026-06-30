import { getClient, MODEL } from "./anthropic.js";

// Reconciles a finished job's real data — its BOM + per-shipment accusés + the
// real skid list (.txt) — into one calibration record: a normalized BOM summary
// and the full set of pallets the job actually became (W x L x H + weight).
// Shared by the folder ingester and the app's "close a job" endpoint.

const PALLET = {
  type: "object",
  properties: { w: { type: "number" }, l: { type: "number" }, h: { type: "number" }, weight: { type: "number" } },
  required: ["w", "l", "h", "weight"],
  additionalProperties: false,
};

const JOB_SCHEMA = {
  type: "object",
  properties: {
    bomSummary: { type: "string", description: "Concise normalized summary of the BOM: key product codes, quantities, unit + total weights" },
    pallets: { type: "array", items: PALLET, description: "Every pallet/skid the whole job became, normalized to W x L x H + weight, de-duplicated" },
    palletCount: { type: "number" },
    totalWeight: { type: "number", description: "Total weight of all pallets, lb" },
    note: { type: "string", description: "Coverage/confidence note (e.g. which shipments were imprecise or estimated)" },
  },
  required: ["bomSummary", "pallets", "palletCount", "totalWeight", "note"],
  additionalProperties: false,
};

export async function reconcileJob({ bomText = "", accuses = [], skidText }) {
  const client = await getClient();

  const prompt = `You are building a calibration example for pallet estimation. The model will later see ONLY a Bill of Materials (BOM) and must predict the pallets the whole job becomes.

DIMENSIONS: output every pallet/skid as W x L x H in inches — W (width) first, normally <= 48"; L (length) the long side (<= ~145"); H (height) the vertical (<= ~68"). The skid list below may use an inconsistent order or format; REORDER each to W x L x H. Weights are pounds.

Produce ONE job-level result:
- bomSummary: a concise normalized summary of the BOM (product codes, quantities, unit + total weights).
- pallets: EVERY pallet/skid this job became, gathered from the skid list across all shipments, normalized to W x L x H + weight. De-duplicate overlapping/repeated sections. Where the skid list is imprecise, give your best estimate and say so in 'note'.
- palletCount, totalWeight, and a 'note' on coverage/confidence.

The per-shipment accusés and the skid list help you map BOM items -> shipments -> pallets; they are NOT available at estimate time.

== BILL OF MATERIALS (BOM) ==
${(bomText || "(none provided)").slice(0, 16000)}

== REAL SKID LIST ==
${skidText}

== PER-SHIPMENT ACCUSÉS (material lists, optional context) ==
${accuses.map((a) => `--- ${a.label} ---\n${(a.text || "").slice(0, 3000)}`).join("\n\n") || "(none provided)"}`;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    messages: [{ role: "user", content: prompt }],
    output_config: { format: { type: "json_schema", schema: JOB_SCHEMA } },
  });

  if (resp.stop_reason === "refusal") throw new Error("Le modèle a refusé de réconcilier ce job.");
  const text = resp.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error(`Aucune sortie de réconciliation (stop_reason : ${resp.stop_reason}).`);
  const out = JSON.parse(text);
  if (!Array.isArray(out.pallets) || !out.pallets.length) throw new Error("La réconciliation n'a renvoyé aucune palette.");
  return out;
}
