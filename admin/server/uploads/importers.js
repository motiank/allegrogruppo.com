// Importers for the kinds the "Upload files" page writes itself (handler "server").
// Each one runs in a single transaction and returns counts for the result screen.
import { getDbPool } from "../sources/dbpool.js";
import { loadWorkbook } from "./workbook.js";
import { parseTabitDetailed, parseBankHapoalim } from "./parsers.js";

const CHUNK = 500;

const inTransaction = async (fn) => {
  const pool = await getDbPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

const bulk = async (conn, sql, rows) => {
  let affected = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const [res] = await conn.query(sql, [rows.slice(i, i + CHUNK)]);
    affected += res.affectedRows || 0;
  }
  return affected;
};

// Tabit detailed report → tabit_shifts. Replaces the month's rows of every employee in the file
// (other employees of the same branch/month stay, so two partial reports can be uploaded).
export const importTabitDetailed = async (buffer, { rest, uploadId }) =>
  saveTabitDetailed(parseTabitDetailed(await loadWorkbook(buffer)), { rest, uploadId });

// The same for a report already read ({ month, employees, skipped }) — the Excel file or the Tabit Shift API.
// wholeMonth (the Tabit Shift API: every app of the branch, the full month) replaces ALL the branch's rows of the
// month, so a person renamed or removed in Tabit does not stay under the old name (אלה רוחב → אלה מרחב, 2026-10).
// An empty report never clears the month.
export const saveTabitDetailed = async (parsed, { rest, uploadId, wholeMonth = false }) => {
  if (!parsed.month) throw new Error("the month of the report was not found");
  const month = parsed.month;
  return inTransaction(async (conn) => {
    let replaced = 0;
    const rows = [];
    if (wholeMonth && parsed.employees.length) {
      const [del] = await conn.execute("DELETE FROM tabit_shifts WHERE rest = :rest AND month = :month", { rest, month });
      replaced += del.affectedRows || 0;
    }
    for (const e of parsed.employees) {
      const [del] = await conn.execute("DELETE FROM tabit_shifts WHERE rest = :rest AND month = :month AND employee_name = :name", {
        rest,
        month,
        name: e.name,
      });
      replaced += del.affectedRows || 0;
      for (const s of e.shifts) {
        rows.push([rest, month, e.name, e.clockId, s.work_date, s.block_no, s.role, s.clock_in, s.clock_out, s.note, uploadId]);
      }
    }
    const inserted = await bulk(
      conn,
      "INSERT INTO tabit_shifts (rest, month, employee_name, clock_id, work_date, block_no, role, clock_in, clock_out, note, upload_id) VALUES ?",
      rows,
    );
    const noClockOut = rows.filter((r) => r[7] && !r[8]).length;
    return {
      month,
      employees: parsed.employees.length,
      shifts: inserted,
      replacedOldRows: replaced,
      shiftsWithoutClockOut: noClockOut,
      skippedSheets: parsed.skipped,
    };
  });
};

// The Tabit Shift API reports of one branch and month ([{ app, report }]) → tabit_shift_reports, one row per
// Tabit app; a new fetch replaces the row. The payroll reads its hours, tip and השלמה from here.
export const saveTabitShiftReports = async (reports, { rest, month, uploadId }) => {
  const pool = await getDbPool();
  for (const { app, report } of reports) {
    const body = JSON.stringify({ data: report?.data || [], errors: report?.errors || null });
    await pool.execute(
      `INSERT INTO tabit_shift_reports (rest, month, app_id, report, employees, upload_id)
       VALUES (:rest, :month, :app, :body, :employees, :uploadId)
       ON DUPLICATE KEY UPDATE report = VALUES(report), employees = VALUES(employees), upload_id = VALUES(upload_id), fetched_at = CURRENT_TIMESTAMP`,
      { rest, month, app: Number(app), body, employees: (report?.data || []).length, uploadId: uploadId ?? null },
    );
  }
  return reports.length;
};

// A week's work plan of one branch (all its Tabit apps) → tabit_rota: replaces the branch's rows of that week.
// keepBefore (YYYY-MM-DD, Israel's today): days before it keep the plan already stored (the plan as it was before the
// day, owner 2026-10-30 — Tabit's plan is edited after the day to match who came); a past day with nothing stored yet
// for that Tabit app is still added. Without keepBefore the whole week is replaced.
export const saveTabitRota = async (rows, { rest, weekStart, keepBefore = null }) =>
  inTransaction(async (conn) => {
    const kept = new Set();
    if (keepBefore) {
      const [old] = await conn.execute(
        "SELECT DISTINCT app_id, DATE_FORMAT(work_date, '%Y-%m-%d') AS d FROM tabit_rota WHERE rest = :rest AND week_start = :weekStart AND work_date < :keepBefore",
        { rest, weekStart, keepBefore },
      );
      for (const r of old) kept.add(`${r.app_id}|${r.d}`);
    }
    const [del] = await conn.execute(
      `DELETE FROM tabit_rota WHERE rest = :rest AND week_start = :weekStart${keepBefore ? " AND work_date >= :keepBefore" : ""}`,
      { rest, weekStart, keepBefore },
    );
    const write = rows.filter((r) => !kept.has(`${r.app_id}|${String(r.work_date).slice(0, 10)}`));
    const cols = ["rest", "week_start", "app_id", "rota_id", "published", "cell_id", "work_date", "shift_name", "role_name", "slot_order",
      "employee_name", "tabit_employee_id", "clock_id", "planned_start", "planned_end", "manual_start", "manual_end", "notes"];
    const inserted = write.length ? await bulk(conn, `INSERT INTO tabit_rota (${cols.join(", ")}) VALUES ?`, write.map((r) => cols.map((c) => r[c] ?? null))) : 0;
    return { replacedOldRows: del.affectedRows || 0, slots: inserted, keptPastSlots: rows.length - write.length, ...(keepBefore ? { keptDaysBefore: keepBefore } : {}) };
  });

// Bank Hapoalim transactions → bank_transactions. Rows already stored are skipped.
export const importBankHapoalim = async (buffer, { uploadId }) => {
  const wb = await loadWorkbook(buffer);
  const parsed = parseBankHapoalim(wb.worksheets.find((w) => w.rowCount > 0));
  if (parsed.error) throw new Error(parsed.error);
  if (!parsed.account) throw new Error("account number not found");
  const rows = parsed.rows.map((r) => [
    "hapoalim",
    r.account,
    r.tx_date,
    r.action_code,
    r.action,
    r.details ? r.details.slice(0, 500) : null,
    r.reference,
    r.bundle,
    r.debit,
    r.credit,
    r.balance,
    r.note,
    r.row_key,
    uploadId,
  ]);
  return inTransaction(async (conn) => {
    const inserted = await bulk(
      conn,
      `INSERT IGNORE INTO bank_transactions (bank, account, tx_date, action_code, action, details, reference, bundle, debit, credit,
         balance, note, row_key, upload_id) VALUES ?`,
      rows,
    );
    return { account: parsed.account, from: parsed.from, to: parsed.to, rows: rows.length, newRows: inserted, alreadyStored: rows.length - inserted };
  });
};
