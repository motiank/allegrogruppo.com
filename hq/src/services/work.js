// Headquarters work: tasks, customer inquiries and reviews, the overviews.
import { q, one, err, audit, ymd, inList, todayLocal } from '../db.js';
import { assertLocation } from '../access.js';
import { addDays } from '../lib/recommend.js';
import { salesSummary } from './analytics.js';

// ---------------------------------------------------------------- tasks

const shapeTask = (r) => ({
  id: r.id,
  locationId: r.location_id,
  locationName: r.location_name ?? null,
  title: r.title,
  description: r.description,
  owner: r.owner_username,
  dueDate: ymd(r.due_date),
  status: r.status,
  sourceKind: r.source_kind,
  sourceRef: r.source_ref,
  isDemo: !!r.is_demo,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function listTasks(access, { locationIds, status, owner, overdue }) {
  const l = inList('l', locationIds);
  const where = [`(t.location_id IN (${l.sql})${access.isAdmin ? ' OR t.location_id IS NULL' : ''})`];
  const params = { ...l.params };
  if (status) {
    const st = String(status).split(',').filter((s) => ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'].includes(s));
    if (st.length) where.push(`t.status IN (${st.map((s) => `'${s}'`).join(',')})`);
  }
  if (owner) {
    where.push('t.owner_username = :o');
    params.o = owner;
  }
  if (overdue) {
    where.push(`t.status IN ('OPEN','IN_PROGRESS') AND t.due_date < :today`);
    params.today = todayLocal();
  }
  const rows = await q(
    `SELECT t.*, loc.name AS location_name FROM joya_tasks t LEFT JOIN joya_locations loc ON loc.id = t.location_id WHERE ${where.join(' AND ')}
      ORDER BY FIELD(t.status,'OPEN','IN_PROGRESS','DONE','CANCELLED'), t.due_date IS NULL, t.due_date, t.id DESC LIMIT 300`,
    params,
  );
  return rows.map(shapeTask);
}

export async function saveTask(access, { id, locationId = null, title, description = null, owner = null, dueDate = null, status = 'OPEN', sourceKind = 'MANUAL', sourceRef = null }) {
  if (locationId != null) assertLocation(access, locationId);
  else if (!access.isAdmin) throw err('BAD_REQUEST', 'choose a location');
  if (!String(title || '').trim()) throw err('BAD_REQUEST', 'a task needs a title');
  if (!['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'].includes(status)) throw err('BAD_REQUEST', 'bad status');
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw err('BAD_REQUEST', 'due date must be YYYY-MM-DD');
  const p = { id, l: locationId, t: String(title).trim(), d: description, o: owner || null, due: dueDate || null, s: status, sk: sourceKind, sr: sourceRef, by: access.username };
  if (id) {
    const prev = await one(`SELECT location_id FROM joya_tasks WHERE id=:id`, { id });
    if (!prev) throw err('NOT_FOUND', 'task not found');
    if (prev.location_id != null) assertLocation(access, prev.location_id);
    else if (!access.isAdmin) throw err('FORBIDDEN', 'chain-level task');
    await q(`UPDATE joya_tasks SET location_id=:l, title=:t, description=:d, owner_username=:o, due_date=:due, status=:s WHERE id=:id`, p);
  } else {
    id = (await q(`INSERT INTO joya_tasks (location_id, title, description, owner_username, due_date, status, source_kind, source_ref, created_by) VALUES (:l, :t, :d, :o, :due, :s, :sk, :sr, :by)`, p)).insertId;
  }
  await audit(access.username, 'TASK_SAVED', 'task', id, locationId, { title, owner, dueDate, status, sourceKind, sourceRef });
  return shapeTask(await one(`SELECT t.*, loc.name AS location_name FROM joya_tasks t LEFT JOIN joya_locations loc ON loc.id = t.location_id WHERE t.id=:id`, { id }));
}

// ---------------------------------------------------------------- inquiries and reviews

const shapeInquiry = (r) => ({
  id: r.id,
  source: r.source,
  kind: r.kind,
  locationId: r.location_id,
  locationName: r.location_name ?? null,
  author: r.author_name,
  content: r.content,
  rating: r.rating,
  receivedAt: r.received_at,
  externalRef: r.external_ref,
  status: r.status,
  owner: r.owner_username,
  draft: r.draft_response,
  draftBy: r.draft_by,
  responseApprovedBy: r.response_approved_by,
  responseApprovedAt: r.response_approved_at,
  respondedBy: r.responded_by,
  respondedAt: r.responded_at,
  enteredVia: r.entered_via,
  isDemo: !!r.is_demo,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

export async function listInquiries(access, { locationIds, status }) {
  const l = inList('l', locationIds);
  const st = status ? String(status).split(',').filter((s) => ['NEW', 'IN_PROGRESS', 'DRAFT_READY', 'RESPONDED', 'CLOSED'].includes(s)) : null;
  const rows = await q(
    `SELECT i.*, loc.name AS location_name FROM joya_inquiries i LEFT JOIN joya_locations loc ON loc.id = i.location_id
      WHERE (i.location_id IN (${l.sql})${access.isAdmin ? ' OR i.location_id IS NULL' : ''}) ${st?.length ? `AND i.status IN (${st.map((s) => `'${s}'`).join(',')})` : ''}
      ORDER BY FIELD(i.status,'NEW','IN_PROGRESS','DRAFT_READY','RESPONDED','CLOSED'), COALESCE(i.received_at, i.created_at) DESC LIMIT 300`,
    l.params,
  );
  return rows.map(shapeInquiry);
}

export async function getInquiry(access, id) {
  const r = await one(`SELECT i.*, loc.name AS location_name FROM joya_inquiries i LEFT JOIN joya_locations loc ON loc.id = i.location_id WHERE i.id=:id`, { id });
  if (!r) throw err('NOT_FOUND', 'not found');
  if (r.location_id != null) assertLocation(access, r.location_id);
  else if (!access.isAdmin) throw err('FORBIDDEN', 'chain-level item');
  return shapeInquiry(r);
}

export async function saveInquiry(access, input) {
  const { id, source, kind, locationId = null, author = null, content, rating = null, receivedAt = null, externalRef = null, owner = null } = input;
  if (!['INSTAGRAM', 'GOOGLE', 'OTHER'].includes(source)) throw err('BAD_REQUEST', 'source must be INSTAGRAM, GOOGLE or OTHER');
  if (!['REVIEW', 'MESSAGE', 'COMMENT'].includes(kind)) throw err('BAD_REQUEST', 'kind must be REVIEW, MESSAGE or COMMENT');
  if (!String(content || '').trim()) throw err('BAD_REQUEST', 'content is required');
  if (rating != null && rating !== '' && !(Number(rating) >= 1 && Number(rating) <= 5)) throw err('BAD_REQUEST', 'rating 1..5');
  if (locationId != null) assertLocation(access, locationId);
  else if (!access.isAdmin) throw err('BAD_REQUEST', 'choose a location');
  const p = { id, s: source, k: kind, l: locationId, a: author, c: String(content).trim(), r: rating === '' || rating == null ? null : Number(rating), at: receivedAt ? String(receivedAt).replace('T', ' ').slice(0, 19) : null, x: externalRef, o: owner, by: access.username };
  if (id) {
    await getInquiry(access, id);
    await q(`UPDATE joya_inquiries SET source=:s, kind=:k, location_id=:l, author_name=:a, content=:c, rating=:r, received_at=:at, external_ref=:x, owner_username=:o WHERE id=:id`, p);
  } else {
    p.id = (await q(`INSERT INTO joya_inquiries (source, kind, location_id, author_name, content, rating, received_at, external_ref, owner_username, created_by, entered_via) VALUES (:s, :k, :l, :a, :c, :r, :at, :x, :o, :by, 'MANUAL')`, p)).insertId;
  }
  await audit(access.username, 'INQUIRY_SAVED', 'inquiry', p.id, locationId, { source, kind });
  return getInquiry(access, p.id);
}

/**
 * Status changes. Nothing is ever sent to Instagram or Google from here:
 *   draft        save a draft reply (by a person or the AI)
 *   approve      a person approves the draft text
 *   responded    a person says they posted the reply on the platform themselves
 */
export async function inquiryAction(access, id, { action, draft, owner, note }) {
  const cur = await getInquiry(access, id);
  if (action === 'draft') {
    if (!String(draft || '').trim()) throw err('BAD_REQUEST', 'the draft is empty');
    await q(`UPDATE joya_inquiries SET draft_response=:d, draft_by=:u, status='DRAFT_READY', response_approved_by=NULL, response_approved_at=NULL WHERE id=:id`, { d: String(draft).trim(), u: access.username, id });
  } else if (action === 'approve') {
    if (!cur.draft) throw err('BAD_REQUEST', 'there is no draft to approve');
    await q(`UPDATE joya_inquiries SET response_approved_by=:u, response_approved_at=NOW() WHERE id=:id`, { u: access.username, id });
  } else if (action === 'responded') {
    await q(`UPDATE joya_inquiries SET status='RESPONDED', responded_by=:u, responded_at=NOW() WHERE id=:id`, { u: access.username, id });
  } else if (action === 'assign') {
    await q(`UPDATE joya_inquiries SET owner_username=:o, status=IF(status='NEW','IN_PROGRESS',status) WHERE id=:id`, { o: owner || null, id });
  } else if (['close', 'reopen', 'start'].includes(action)) {
    const s = { close: 'CLOSED', reopen: 'IN_PROGRESS', start: 'IN_PROGRESS' }[action];
    await q(`UPDATE joya_inquiries SET status=:s WHERE id=:id`, { s, id });
  } else throw err('BAD_REQUEST', 'unknown action');
  await audit(access.username, 'INQUIRY_' + String(action).toUpperCase(), 'inquiry', id, cur.locationId, { note: note || null });
  return getInquiry(access, id);
}

// ---------------------------------------------------------------- overview

/** What waits for a decision, per location. */
export async function pending(access, locationIds) {
  if (!locationIds.length) return [];
  const ids = locationIds.map(Number).join(',');
  const today = todayLocal();
  const rows = await q(
    `SELECT l.id AS location_id, l.name,
       (SELECT COUNT(*) FROM joya_order_lists o WHERE o.location_id=l.id AND o.status='DRAFT') AS draft_lists,
       (SELECT COUNT(*) FROM joya_order_lists o WHERE o.location_id=l.id AND o.status='APPROVED') AS approved_not_ordered,
       (SELECT COUNT(*) FROM joya_staffing_plans p WHERE p.location_id=l.id AND p.status='DRAFT') AS draft_plans,
       (SELECT COUNT(*) FROM joya_payroll_issues i WHERE i.location_id=l.id AND i.status='OPEN') AS open_payroll_issues,
       (SELECT COUNT(*) FROM joya_inquiries q WHERE q.location_id=l.id AND q.status IN ('NEW','IN_PROGRESS','DRAFT_READY')) AS open_inquiries,
       (SELECT COUNT(*) FROM joya_tasks t WHERE t.location_id=l.id AND t.status IN ('OPEN','IN_PROGRESS') AND t.due_date < :today) AS overdue_tasks,
       (SELECT COUNT(*) FROM joya_tasks t WHERE t.location_id=l.id AND t.status IN ('OPEN','IN_PROGRESS')) AS open_tasks,
       (SELECT COUNT(*) FROM joya_shortages s WHERE s.location_id=l.id AND s.reported_date >= :week) AS shortages_7d
     FROM joya_locations l WHERE l.id IN (${ids}) ORDER BY l.name`,
    { today, week: addDays(today, -7) },
  );
  return rows.map((r) => ({
    locationId: r.location_id,
    name: r.name,
    draftLists: Number(r.draft_lists),
    approvedNotOrdered: Number(r.approved_not_ordered),
    draftPlans: Number(r.draft_plans),
    openPayrollIssues: Number(r.open_payroll_issues),
    openInquiries: Number(r.open_inquiries),
    overdueTasks: Number(r.overdue_tasks),
    openTasks: Number(r.open_tasks),
    shortages7d: Number(r.shortages_7d),
  }));
}

export async function overview(access, locationIds, { days = 7 } = {}) {
  const today = todayLocal();
  const to = addDays(today, -1);
  const from = addDays(to, -(Number(days) - 1));
  const [sales, pend] = await Promise.all([salesSummary(locationIds, from, to), pending(access, locationIds)]);
  return { today, sales, pending: pend };
}
