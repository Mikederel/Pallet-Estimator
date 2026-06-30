import { buildSystemPrompt, DIM_RULES } from "./prompt.js";
import { collections } from "./db.js";
import { getClient, MODEL } from "./anthropic.js";
import { pdfTextFromBase64 } from "./pdf.js";

// Raw JSON Schema (no zod helper — it is coupled to the Zod major version).
const PALLET = {
  type: "object",
  properties: {
    w: { type: "number", description: "Width in inches (typically <= 48)" },
    l: { type: "number", description: "Length in inches (long side, <= ~145)" },
    h: { type: "number", description: "Height in inches (aim <= 68)" },
    weight: { type: "number", description: "Approximate weight in lb" },
  },
  required: ["w", "l", "h", "weight"],
  additionalProperties: false,
};

const ESTIMATE_SCHEMA = {
  type: "object",
  properties: {
    totalWeight: { type: "number", description: "Total weight of all pallets, lb" },
    palletCount: { type: "number" },
    pallets: { type: "array", items: PALLET, description: "Each pallet's approx W x L x H (in) + weight (lb)" },
    reasoning: { type: "string", description: "Concise explanation of the grouping and estimate" },
  },
  required: ["totalWeight", "palletCount", "pallets", "reasoning"],
  additionalProperties: false,
};

// Closed jobs are the calibration set: their BOM summary -> the pallets they
// actually became.
async function closedExamples() {
  const closed = await collections
    .jobs()
    .find({ status: "closed", "actual.pallets": { $type: "array" } })
    .toArray();
  return closed.map((j) => ({
    job: j.jobNo,
    bomSummary: j.bomSummary,
    pallets: j.actual.pallets,
    palletCount: j.actual.palletCount,
    totalWeight: j.actual.totalWeight,
    note: j.actual.note,
  }));
}

// input: { jobNo?: string, materialList?: string, pdfs?: [{ name, dataB64 }] }
// pdfs[0] is treated as the BOM. Persists the job as "open" (awaiting results).
export async function estimatePallets({ jobNo, materialList, pdfs = [] } = {}) {
  const examples = await closedExamples();
  const client = await getClient();

  const content = [
    {
      type: "text",
      text: "Here is the Bill of Materials (BOM) for a job — the full list of products, quantities, and unit weights. This is the only document available now (the per-shipment accusés come later); estimate from the BOM alone.",
    },
  ];
  for (const f of pdfs) {
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: f.dataB64 },
      title: f.name || "document.pdf",
    });
  }
  if (materialList && materialList.trim()) {
    content.push({ type: "text", text: `Additional pasted notes:\n${materialList.trim()}` });
  }
  content.push({
    type: "text",
    text: `Estimate the complete set of pallets this whole job will require. ${DIM_RULES}\nReturn each pallet's W x L x H and approximate weight, plus the total weight.`,
  });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [{ type: "text", text: buildSystemPrompt(examples), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
    output_config: { format: { type: "json_schema", schema: ESTIMATE_SCHEMA } },
  });

  if (response.stop_reason === "refusal") throw new Error("Le modèle a refusé de répondre à cette requête.");
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error(`Aucune sortie structurée renvoyée (stop_reason : ${response.stop_reason}).`);
  let result;
  try {
    result = JSON.parse(textBlock.text);
  } catch {
    throw new Error("Le modèle a renvoyé une sortie non-JSON (réessayez, ou la réponse a été tronquée).");
  }

  // Extract BOM text now so the job can be closed later without re-uploading it.
  let bomText = "";
  if (pdfs[0]?.dataB64) {
    try {
      bomText = await pdfTextFromBase64(pdfs[0].dataB64);
    } catch (e) {
      console.error("[estimate] BOM text extraction failed:", e.message);
    }
  }

  // Persist as an OPEN job (awaiting real results). Keyed by jobNo so re-estimating
  // the same job updates it; never downgrades a closed job back to open.
  const label = (jobNo && jobNo.trim()) || (pdfs[0]?.name || "").replace(/\.pdf$/i, "") || `job-${Date.now()}`;
  const now = new Date();
  await collections.jobs().updateOne(
    { jobNo: label },
    {
      $set: { jobNo: label, bomText, estimate: result, estimatedAt: now, updatedAt: now },
      $setOnInsert: { status: "open", createdAt: now },
    },
    { upsert: true }
  );

  return { ...result, jobNo: label };
}
