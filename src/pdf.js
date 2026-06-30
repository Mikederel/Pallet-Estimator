// PDF text extraction (pdf-parse v2 exposes a PDFParse class; required via
// createRequire because the package is CJS and the project is ESM).
import { createRequire } from "module";
import fs from "fs";

const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse");

export async function pdfText(data) {
  const parser = new PDFParse({ data: data instanceof Uint8Array ? data : new Uint8Array(data) });
  const r = await parser.getText();
  return (r.text || "").replace(/\n{3,}/g, "\n\n").trim();
}

export const pdfTextFromBase64 = (b64) => pdfText(Buffer.from(b64, "base64"));
export const pdfTextFromFile = (p) => pdfText(fs.readFileSync(p));
