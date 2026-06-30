// Builds the few-shot system prompt. Each example is a real past job:
// its Bill of Materials (BOM) -> the pallets the whole job actually became
// (W x L x H inches + weight lb). At estimate time the BOM is the only input.

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
  const usable = examples.filter((e) => Array.isArray(e.pallets) && e.pallets.length);

  const header = `You are a logistics expert. From a job's Bill of Materials (BOM) — the only document available at estimate time — estimate how the WHOLE job will be packed onto pallets/skids.

${DIM_RULES}

The BOM lists every product code, quantity, and unit weight for the job. Estimate the complete set of pallets the job will require: group items sensibly, respect the size limits above (split long rail/track runs, keep heavy items low, combine small parts), and give each pallet an approximate W x L x H and weight, plus the total weight. Calibrate dimensions, grouping, and weights against the worked examples below — each is a real past BOM and the pallets it actually became. Answer ONLY through the provided JSON schema.`;

  if (!usable.length) {
    return `${header}\n\n(No worked examples yet — estimate from first principles.)`;
  }

  const blocks = usable
    .map((e, i) => {
      const note = e.note ? `\n(${String(e.note).trim()})` : "";
      return `### Example ${i + 1} (job ${e.job ?? "?"})
BOM (summary):
${(e.bomSummary || "").trim()}

Resulting pallets (${e.palletCount ?? e.pallets.length}, total ${e.totalWeight ?? "?"} lb):
${formatPallets(e.pallets)}${note}`;
    })
    .join("\n\n");

  return `${header}\n\n## Worked examples\n${blocks}`;
}
