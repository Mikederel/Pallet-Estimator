import { z } from "zod";
import { buildSystemPrompt } from "./prompt.js";
import { collections } from "./db.js";

const MODEL = "claude-opus-4-8";

const EstimateSchema = z.object({
  pallets: z.number().describe("Total whole number of pallets required"),
  reasoning: z.string().describe("Concise explanation of how the estimate was reached"),
  breakdown: z
    .array(
      z.object({
        group: z.string().describe("Item or group of items"),
        pallets: z.number().describe("Pallets attributed to this group"),
      })
    )
    .describe("Per-group pallet breakdown"),
});

// The Anthropic SDK is loaded lazily so that a missing key or an SDK/runtime
// issue surfaces on /api/estimate only — it never prevents the server from
// booting and serving the UI, examples, and /api/health.
let _client;
let _zodOutputFormat;

async function getClient() {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.includes("xxxx")) {
    throw new Error("ANTHROPIC_API_KEY is not set in .env (get one at https://console.anthropic.com).");
  }
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  ({ zodOutputFormat: _zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod"));
  _client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
  return _client;
}

export async function estimatePallets(materialList) {
  const examples = await collections.examples().find().toArray();
  const client = await getClient();

  const response = await client.messages.parse({
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
    output_config: { format: _zodOutputFormat(EstimateSchema) },
  });

  const result = response.parsed_output;
  if (!result) {
    throw new Error("Model did not return a valid structured estimate (possible refusal or truncation).");
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
