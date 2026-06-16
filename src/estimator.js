import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { buildSystemPrompt } from "./prompt.js";
import { collections } from "./db.js";

const MODEL = "claude-opus-4-8";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

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

export async function estimatePallets(materialList) {
  const examples = await collections.examples().find().toArray();

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
    output_config: { format: zodOutputFormat(EstimateSchema) },
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
