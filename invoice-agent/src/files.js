import path from 'path';
import * as XLSX from 'xlsx';

const MAX_FILE = 20 * 1024 * 1024;
const MAX_SHEET_TEXT = 100_000;
const IMAGES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
const SHEETS = new Set(['xlsx', 'xlsm', 'xls', 'ods', 'csv']);
const MIME = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', csv: 'text/csv', ...IMAGES };

function sheetText(bytes) {
  const book = XLSX.read(bytes, { type: 'buffer', sheetRows: 2000 });
  const text = book.SheetNames.map((n) => `Sheet "${n}":\n${XLSX.utils.sheet_to_csv(book.Sheets[n], { blankrows: false })}`).join('\n\n');
  return text.slice(0, MAX_SHEET_TEXT);
}

/**
 * Decides how to show a file to the model. Trusts the bytes before the name.
 * @returns {{ id, name, bytes, ext, mimeType, kind: 'pdf'|'image'|'sheet'|'unreadable', text?, note? }}
 */
export function prepareFile({ id, name, bytes }) {
  const ext = path.extname(name).slice(1).toLowerCase();
  const base = { id, name, bytes, ext, mimeType: MIME[ext] ?? 'application/octet-stream' };
  if (bytes.length > MAX_FILE) return { ...base, kind: 'unreadable', note: 'too large to read' };
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') {
    const pdf = { ...base, ext: 'pdf', mimeType: MIME.pdf };
    if (bytes.includes('/Encrypt')) return { ...pdf, kind: 'unreadable', note: 'the PDF has a password' };
    return { ...pdf, kind: 'pdf' };
  }
  if (IMAGES[ext]) return { ...base, kind: 'image' };
  if (SHEETS.has(ext)) {
    try {
      return { ...base, kind: 'sheet', text: sheetText(bytes) };
    } catch (e) {
      return { ...base, kind: 'unreadable', note: `the spreadsheet could not be read (${e.message})` };
    }
  }
  return { ...base, kind: 'unreadable', note: `file type "${ext || 'unknown'}" is not supported` };
}

/** True for files worth reading: not a logo or a small signature image. */
export function worthReading(att) {
  const image = /^image\//.test(att.mimeType ?? '');
  return !(image && (att.inline || att.size < 15_000));
}

/** The content blocks for one file. */
export function fileBlocks(f) {
  const label = { type: 'text', text: `File ${f.id}: "${f.name}"${f.note ? ` — cannot be shown: ${f.note}` : ''}` };
  const data = f.bytes.toString('base64');
  if (f.kind === 'pdf') return [label, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }];
  if (f.kind === 'image') return [label, { type: 'image', source: { type: 'base64', media_type: f.mimeType, data } }];
  if (f.kind === 'sheet') return [label, { type: 'text', text: `<spreadsheet>\n${f.text}\n</spreadsheet>` }];
  return [label];
}
