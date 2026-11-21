// The latest invoices the invoice agent FOUND (owner 2026-11-22: "see the latest invoices it found, not the date of
// creation"): the rows of the agent's Drive indexes, newest FOUND first — sorted by `filed_at` (when the agent filed
// the invoice), never by the date printed on the invoice. Pure: no Drive, no database. Used by the admin Finance API
// (/finance/invoices/drive-latest) and its test.

// Israel time, "YYYY-MM-DD HH:mm": the owner reads the found time on his own clock, and a found DAY is an Israel day
const TZ = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
export const localTime = (iso) => (iso && !Number.isNaN(Date.parse(iso)) ? TZ.format(new Date(iso)) : null);
const day = (r) => String(r.foundLocal || "").slice(0, 10);
const norm = (s) => String(s ?? "").toLowerCase().replace(/["'״׳.,\-\s]/g, "");

/** One index row → the row the API gives. folder = { name, unmatched, target }. */
export function latestRow(inv, folder) {
  const income = inv.direction === "income";
  return {
    foundAt: inv.filed_at || null,
    foundLocal: localTime(inv.filed_at),
    company: folder.unmatched ? null : folder.name,
    unmatched: Boolean(folder.unmatched),
    target: folder.target || "main",
    direction: inv.direction || null,
    party: (income ? inv.to : inv.from) || inv.party_folder || null,
    partyTaxId: inv.party_tax_id || null,
    issuedTo: income ? null : inv.to || null,
    number: inv.number ?? null,
    docType: inv.doc_type || null,
    total: inv.total ?? null,
    currency: inv.currency || null,
    date: inv.date || null,
    allocationNumber: inv.allocation_number || null,
    mailbox: inv.gmail_account || "main",
    books: inv.books?.status || null,
    driveFileId: inv.drive_file_id || null,
    fileUrl: inv.drive_file_id ? `https://drive.google.com/file/d/${inv.drive_file_id}/view` : null,
  };
}

/**
 * Filters and sorts. f = { since?, until? (found days in Israel time, YYYY-MM-DD), company? (part of the name), direction?,
 * mailbox? ("main" or an address), q? (part of the party's name or the invoice number), unmatched? ("only" | "hide") }.
 * @returns {{ rows, total, lastFoundAt, byDay }} rows = all that match, newest found first; byDay = the last 10 found
 * days of the matching rows [{ day, count }].
 */
export function latestInvoices(rows, f = {}) {
  let list = rows.filter((r) => r.foundAt && r.foundLocal);
  if (f.since) list = list.filter((r) => day(r) >= f.since);
  if (f.until) list = list.filter((r) => day(r) <= f.until);
  if (f.company) list = list.filter((r) => norm(r.company).includes(norm(f.company)));
  if (f.direction) list = list.filter((r) => r.direction === f.direction);
  if (f.mailbox) list = list.filter((r) => r.mailbox === String(f.mailbox).toLowerCase());
  if (f.unmatched === "only") list = list.filter((r) => r.unmatched);
  if (f.unmatched === "hide") list = list.filter((r) => !r.unmatched);
  if (f.q) list = list.filter((r) => norm(r.party).includes(norm(f.q)) || String(r.number ?? "").includes(String(f.q).trim()));
  list.sort((a, b) => Date.parse(b.foundAt) - Date.parse(a.foundAt));
  const counts = new Map();
  for (const r of list) counts.set(day(r), (counts.get(day(r)) || 0) + 1);
  return { rows: list, total: list.length, lastFoundAt: list[0]?.foundAt ?? null, byDay: [...counts].slice(0, 10).map(([d, count]) => ({ day: d, count })) };
}
