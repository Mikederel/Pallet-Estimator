import { buildSystemPrompt, DIM_RULES } from "./prompt.js";
import { collections } from "./db.js";

const MODEL = "claude-opus-4-8";

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

// Lazy SDK load so the server boots even without the key / SDK.
let _client;
async function getClient() {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.includes("xxxx")) {
    throw new Error("ANTHROPIC_API_KEY is not set in .env (get one at https://console.anthropic.com).");
  }
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  _client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
  return _client;
}

// input: { materialList?: string, pdfs?: [{ name, dataB64 }] }
export async function estimatePallets({ materialList, pdfs = [] } = {}) {
  const examples = await collections.examples().find({ pallets: { $type: "array" } }).toArray();
  const client = await getClient();

  const content = [
    {
      type: "text",
      text: "Here are the shipment documents. Some are material lists (Quantité / Produit / Description = what is shipped); one may be a Bill of Materials listing a unit weight per product code. Use them together.",
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
    content.push({ type: "text", text: `Additional pasted material list / notes:\n${materialList.trim()}` });
  }
  content.push({
    type: "text",
    text: `Estimate how this shipment is packed onto pallets. ${DIM_RULES}\nReturn each pallet's W x L x H and approximate weight, plus the total weight.`,
  });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [
      { type: "text", text: buildSystemPrompt(examples), cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content }],
    output_config: { format: { type: "json_schema", schema: ESTIMATE_SCHEMA } },
  });

  if (response.stop_reason === "refusal") {
    throw new Error("The model declined to answer this request.");
  }
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) {
    throw new Error(`No structured output returned (stop_reason: ${response.stop_reason}).`);
  }
  let result;
  try {
    result = JSON.parse(textBlock.text);
  } catch {
    throw new Error("Model returned non-JSON output (try again, or the response was truncated).");
  }

  // Log the estimation for later review / tuning (best-effort).
  try {
    await collections.estimations().insertOne({
      input: materialList || null,
      pdfNames: pdfs.map((f) => f.name).filter(Boolean),
      result,
      model: MODEL,
      createdAt: new Date(),
    });
  } catch (err) {
    console.error("[estimator] failed to log estimation:", err.message);
  }

  return result;
}
