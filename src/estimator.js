import { buildSystemPrompt } from "./prompt.js";
import { collections } from "./db.js";

const MODEL = "claude-opus-4-8";

// Raw JSON Schema for structured output — avoids the SDK's zod helper, which is
// coupled to the installed Zod major version. Every object needs
// additionalProperties:false + required, as structured outputs require.
const ESTIMATE_SCHEMA = {
  type: "object",
  properties: {
    pallets: { type: "number", description: "Total whole number of pallets required" },
    reasoning: { type: "string", description: "Concise explanation of how the estimate was reached" },
    breakdown: {
      type: "array",
      description: "Per-group pallet breakdown",
      items: {
        type: "object",
        properties: {
          group: { type: "string", description: "Item or group of items" },
          pallets: { type: "number", description: "Pallets attributed to this group" },
        },
        required: ["group", "pallets"],
        additionalProperties: false,
      },
    },
  },
  required: ["pallets", "reasoning", "breakdown"],
  additionalProperties: false,
};

// The Anthropic SDK is loaded lazily so a missing key / SDK issue surfaces on
// /api/estimate only — it never prevents the server from booting.
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

export async function estimatePallets(materialList) {
  const examples = await collections.examples().find().toArray();
  const client = await getClient();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" }, // numeric/spatial reasoning for the estimate
    system: [
      {
        type: "text",
        text: buildSystemPrompt(examples),
        cache_control: { type: "ephemeral" }, // few-shot prefix is reused across requests
      },
    ],
    messages: [
      {
        role: "user",
        content: `Estimate the number of pallets for this material list:\n\n${materialList}`,
      },
    ],
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
    throw new Error("Model returned non-JSON output.");
  }

  // Log the estimation for later review / tuning (best-effort, non-blocking).
  try {
    await collections.estimations().insertOne({
      input: materialList,
      result,
      model: MODEL,
      createdAt: new Date(),
    });
  } catch (err) {
    console.error("[estimator] failed to log estimation:", err.message);
  }

  return result;
}
