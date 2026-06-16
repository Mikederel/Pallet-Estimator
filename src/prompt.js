// Builds the few-shot system prompt for the pallet estimator from stored examples.

function formatMaterials(materials = []) {
  return materials
    .map((m) => {
      const dims = [m.length, m.width, m.height].filter((v) => v != null).join(" x ");
      const parts = [
        `- ${m.name ?? "item"}`,
        m.quantity != null ? `qty ${m.quantity}` : null,
        dims ? `dims ${dims}` : null,
        m.weight != null ? `weight ${m.weight}` : null,
      ].filter(Boolean);
      return parts.join(", ");
    })
    .join("\n");
}

// An example may be structured (materials[]) or free text (rawText).
function formatExampleBody(ex) {
  if (Array.isArray(ex.materials) && ex.materials.length) return formatMaterials(ex.materials);
  return (ex.rawText || "").trim();
}

export function buildSystemPrompt(examples = []) {
  const header = `You are a logistics expert who estimates how many shipping pallets a material list requires.

Reason about: item dimensions, quantities, weight, stackability, and how items combine onto a standard pallet (1200x800mm / 48x40in, ~1.8m max stack height, ~1000kg max weight) unless an example implies a different convention. Respect the units given in the input.

Use the worked examples below to calibrate your estimates. Always answer through the provided JSON schema: a whole number of pallets, a concise reasoning, and a per-group breakdown.`;

  if (!examples.length) {
    return `${header}\n\n(No worked examples are available yet — estimate from first principles.)`;
  }

  const blocks = examples
    .map((ex, i) => {
      const body = formatExampleBody(ex);
      return `### Example ${i + 1}
Material list:
${body}
${ex.notes ? `Notes: ${ex.notes}\n` : ""}=> Pallets: ${ex.pallets}`;
    })
    .join("\n\n");

  return `${header}\n\n## Worked examples\n${blocks}`;
}
