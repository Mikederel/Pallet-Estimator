// Shared Anthropic client — loaded lazily so the server boots even without the
// key/SDK; a missing key surfaces only when an estimate/ingest actually runs.
export const MODEL = "claude-opus-4-8";

let _client;
export async function getClient() {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.includes("xxxx")) {
    throw new Error("ANTHROPIC_API_KEY n'est pas défini dans .env (obtenez-en une sur https://console.anthropic.com).");
  }
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  _client = new Anthropic();
  return _client;
}
