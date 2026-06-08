#!/usr/bin/env node
// scripts/extract_pdf_pages.js
//
// Extract only specific pages from a PDF, discarding all the others.
//
//   node extract_pdf_pages.js input.pdf [output.pdf]
//
// If output.pdf is omitted, writes to <input>-extracted.pdf next to the input.
// Page numbers are 1-based (page 13 = the 13th page).

import fs from "fs/promises";
import path from "path";
import { PDFDocument } from "pdf-lib";

// Pages to KEEP (1-based). Everything else is erased.
const KEEP_PAGES = [
  13, 20, 21, 23, 27, 31, 34, 38, 39, 42, 45, 47, 49, 51, 54, 58, 60, 63, 67,
  70, 73, 75, 77, 79, 82, 85, 88, 91, 95, 98, 101, 104, 108, 112, 115, 119,
  122, 125, 129, 132, 136,
];

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node extract_pdf_pages.js input.pdf [output.pdf]");
  process.exit(1);
}

const outputPath =
  process.argv[3] ??
  path.join(
    path.dirname(inputPath),
    `${path.basename(inputPath, path.extname(inputPath))}-extracted.pdf`,
  );

async function main() {
  const bytes = await fs.readFile(inputPath);
  const srcDoc = await PDFDocument.load(bytes);
  const total = srcDoc.getPageCount();

  // Convert to 0-based indices, keep only those that exist, sorted & unique.
  const indices = [...new Set(KEEP_PAGES)]
    .sort((a, b) => a - b)
    .filter((n) => n >= 1 && n <= total)
    .map((n) => n - 1);

  const missing = KEEP_PAGES.filter((n) => n < 1 || n > total);
  if (missing.length) {
    console.warn(
      `Warning: input has ${total} pages; skipping out-of-range: ${missing.join(", ")}`,
    );
  }

  const outDoc = await PDFDocument.create();
  const copied = await outDoc.copyPages(srcDoc, indices);
  copied.forEach((p) => outDoc.addPage(p));

  const outBytes = await outDoc.save();
  await fs.writeFile(outputPath, outBytes);

  console.log(`Input:  ${inputPath} (${total} pages)`);
  console.log(`Output: ${outputPath} (${indices.length} pages)`);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
