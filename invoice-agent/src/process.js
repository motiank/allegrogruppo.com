// One email from start to end. Everything outside is passed in, so tests can replace it.
import { analyzeEmail } from './agent.js';
import { prepareFile, worthReading } from './files.js';
import { fileInvoice, problem, route } from './filing.js';

const MAX_ATTACHMENTS = 8;
const FORM_101 = /(טופס|tofes|form)[\s_-]*101(?!\d)/i;
const INVOICE_WORD = /חשבונית|חשבוניות|invoice/i;

/** A Form 101 email holds employee ID photos. Skipped without the model, unless it also speaks of an invoice. */
export function isForm101Only(email) {
  const names = email.attachments.map((a) => a.name).join(' ');
  return FORM_101.test(`${email.subject} ${names}`) && !INVOICE_WORD.test(`${email.subject} ${names} ${email.text}`);
}

/** @returns {{ status, reason, invoices, filed }} the entry for the state file; filed = invoices saved. */
export async function processEmail({ id, gmail, ask, fetchLink, store, rootId, companies, dryRun, log = () => {}, guard = (fn) => fn() }) {
  const email = await gmail.get(id);
  const summary = { subject: email.subject.slice(0, 150), from: email.from.slice(0, 150) };
  if (isForm101Only(email)) return { ...summary, status: 'ignored', reason: 'Form 101 with no invoice word', invoices: [], filed: 0 };
  const wanted = email.attachments.filter(worthReading).slice(0, MAX_ATTACHMENTS);
  if (!wanted.length && !email.links.length) return { ...summary, status: 'ignored', reason: 'no attachment and no links', invoices: [], filed: 0 };

  const files = [];
  for (const att of wanted) files.push(prepareFile({ id: `f${files.length + 1}`, name: att.name, bytes: await gmail.attachment(id, att.attachmentId) }));

  const result = await analyzeEmail({ email, files, ask, fetchLink, log });
  if (result.decision === 'not_invoice') return { ...summary, status: 'ignored', reason: result.reason, invoices: [], filed: 0 };
  if (result.decision !== 'invoices' || !result.invoices.length) return { ...summary, status: 'needs_review', reason: result.reason, invoices: [], filed: 0 };

  const done = [];
  const problems = [];
  let filed = 0;
  for (const inv of result.invoices) {
    const bad = problem(inv, result.files);
    if (bad) { problems.push(`${inv.number || '?'}: ${bad}`); continue; }
    const file = result.files.find((f) => f.id === inv.file_id);
    let isNew = false;
    for (const place of route(inv, companies)) {
      if (dryRun) { log(`  would file: ${place.company} / ${place.direction} / ${place.party} / ${inv.number} / ${inv.total} ${inv.currency} / ${inv.date} / הקצאה ${inv.allocation_number || '-'}`); isNew = true; continue; }
      const r = await guard(() => fileInvoice({ store, rootId: typeof rootId === 'function' ? rootId(place.company) : rootId, place, inv, file, email }));
      done.push({ company: place.company, direction: place.direction, party: place.party, number: inv.number, duplicate: r.duplicate });
      isNew ||= !r.duplicate;
      log(`  ${r.duplicate ? 'already filed' : 'filed'}: ${place.company} / ${place.direction} / ${place.party} / ${inv.number}`);
    }
    if (isNew) filed++;
  }
  if (problems.length) return { ...summary, status: 'needs_review', reason: problems.join('; '), invoices: done, filed };
  return { ...summary, status: filed ? 'filed' : 'duplicate', reason: result.reason, invoices: done, filed };
}
