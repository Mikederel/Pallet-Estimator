// Builds the few-shot system prompt for the pallet estimator from stored examples.
// Each example is a real shipment: a material list -> the pallets it became
// (W x L x H inches + weight lb), ingested from your example folders.

export const DIM_RULES = `Report every pallet/skid as W x L x H in inches:
- W (width) comes first, and is normally <= 48".
- L (length) is the long side, normally <= 145".
- H (height) is the vertical, and should fit a 53' trailer — aim for <= 68".
Weights are in pounds (lb).`;

function formatPallets(pallets = []) {
  return pallets
    .map((p, i) => `  - Pallet ${i + 1}: ${p.w}" W x ${p.l}" L x ${p.h}" H — ${p.weight} lb`)
    .join("\n");
}

export function buildSystemPrompt(examples = []) {
  // Only the new-shape examples (pallets is an array of {w,l,h,weight}).
  const usable = examples.filter((e) => Array.isArray(e.pallets) && e.pallets.length);

  const header = `You are a logistics expert. From a shipment's material list (and a Bill of Materials with unit weights when provided), estimate how it is packed onto pallets/skids.

${DIM_RULES}

For each pallet, output an approximate W x L x H and an approximate weight, plus the total weight across all pallets. Group items sensibly, respecting the size limits above (split long runs of rail/track, keep heavy items low, etc.). The material list gives quantities + product codes + descriptions; the Bill of Materials gives unit weights per product code. Calibrate your dimensions, grouping, and weights against the worked examples below. Answer ONLY through the provided JSON schema.`;

  if (!usable.length) {
    return `${header}\n\n(No worked examples yet — estimate from first principles.)`;
  }

  const blocks = usable
    .map((e, i) => {
      const tag = `job ${e.job ?? "?"}${e.suffix ? ` .${e.suffix}` : ""}`;
      return `### Example ${i + 1} (${tag})
Material list:
${(e.materialList || "").trim()}

Resulting pallets (${e.palletCount ?? e.pallets.length}, total ${e.totalWeight ?? "?"} lb):
${formatPallets(e.pallets)}`;
    })
    .join("\n\n");

  return `${header}\n\n## Worked examples\n${blocks}`;
}
