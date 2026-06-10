import express from "express";
import multer from "multer";
import { createRequire } from "module";
import { executeSql, getDbPool } from "../sources/dbpool.js";
import MicpImportXL from "./MicpImportXL.js";
import ShikImportXL from "./ShikImportXL.js";
import {
  normalizeRoleWage,
  normalizeRoles,
  isValidWageType,
  effectiveHourlyRate,
} from "../../../shared/wage.js";

const require = createRequire(import.meta.url);

// Normalize a money value to a DECIMAL-safe string (avoid JS Number float
// drift on the way to MySQL DECIMAL columns). Returns null when not a number.
const toDecimalString = (v) => {
  if (v === "" || v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return s;
};

// Serialize a roles array to the compound JSON stored in employees.roles:
// [{ role, new_wage_type, wage }]. Accepts the legacy bare-number format on
// input (normalizeRoleWage upgrades it) so a save migrates the row in place.
const serializeRoles = (roles) =>
  JSON.stringify(
    (Array.isArray(roles) ? roles : [])
      .filter((r) => r && r.role)
      .map((r) => {
        const n = normalizeRoleWage(r);
        return {
          role: String(n.role).trim(),
          new_wage_type: isValidWageType(n.new_wage_type)
            ? n.new_wage_type
            : null,
          wage: toDecimalString(n.wage),
        };
      }),
  );
const {
  extractEmployees,
} = require("../../../payroll-summary/payroll_summary.js");
const ExcelJS = require("exceljs");
const RESTAURANTS = require("../../../shared/restaurants.json");

const RESTAURANT_GROUPS = RESTAURANTS.restaurants || [];

// Find the mic_company code for a given branch id. Returns "" if not mapped.
const micCompanyForBranch = (branchId) => {
  for (const g of RESTAURANT_GROUPS) {
    if (!g.mic_company) continue;
    if ((g.branches || []).some((b) => b.id === branchId)) return g.mic_company;
  }
  return "";
};

// Global working days for a YYYY-MM. Returns null if not configured.
const workingDaysFor = (month) => {
  const v = RESTAURANTS.working_days?.[month];
  return Number.isFinite(Number(v)) ? Number(v) : null;
};

// Global working hours for a YYYY-MM. Returns null if not configured.
const workingHoursFor = (month) => {
  const v = RESTAURANTS.working_hours?.[month];
  return Number.isFinite(Number(v)) ? Number(v) : null;
};

// payroll_soft (e.g. "mic" / "shik") for a given branch id. Returns null if
// the group has no payroll_soft set or the branch isn't found.
const payrollSoftForBranch = (branchId) => {
  for (const g of RESTAURANT_GROUPS) {
    if ((g.branches || []).some((b) => b.id === branchId))
      return g.payroll_soft || null;
  }
  return null;
};

// Build the per-employee row shape consumed by both MicpImportXL and
// ShikImportXL. Pulled out of /export-micpal so the two exporters share the
// same calculated fields (hourlyWage, hours buckets, bonus, travel, …) and
// only differ on output format.
//
// ctx: { empByName, micpalByIdNmbr, stdDays, stdHours, minHourlyWage }.
export const buildExportRow = (emp, ctx) => {
  const empByName = ctx.empByName || new Map();
  const micpalByIdNmbr = ctx.micpalByIdNmbr || new Map();
  const stdDays = ctx.stdDays;
  const stdHours = ctx.stdHours;
  const MIN_HOURLY_WAGE = Number(ctx.minHourlyWage) || 35.4;

  const payroll = emp.payroll_data || {};
  // Tips and completion (השלמה) are intentionally NOT exported in either
  // format, so they are not accumulated here.
  let h100 = 0,
    h125 = 0,
    h150 = 0,
    shabbat = 0,
    holiday = 0;
  for (const [, payload] of Object.entries(payroll)) {
    const hours = (payload && payload.hours) || [];
    h100 += Number(hours[0] || 0);
    h125 += Number(hours[1] || 0);
    h150 += Number(hours[2] || 0);
    shabbat += Number(hours[3] || 0);
    holiday += Number(hours[4] || 0);
  }
  const name = (emp.name || "").trim();
  const dbEmp = empByName.get(name) || {};
  const idNmbr = dbEmp.ID_nmbr
    ? String(dbEmp.ID_nmbr).trim()
    : emp.ID_nmbr
      ? String(emp.ID_nmbr).trim()
      : "";
  const newWageType = dbEmp.new_wage_type || null;
  const rawWageVal = dbEmp.wage != null ? Number(dbEmp.wage) : null;
  // -1 is the "minimum wage" sentinel — resolve it to the national minimum.
  const wageVal = rawWageVal === -1 ? MIN_HOURLY_WAGE : rawWageVal;

  let hourlyWage = null;
  // hourly_* (gross AND net) is paid at the wage rate. net-ness is conveyed
  // only by the net flag (below) — there is NO reduced rate. hourly_min_* is
  // paid at the national minimum, with the gap topped up via a bonus.
  if (newWageType && newWageType.startsWith("hourly_min_")) {
    hourlyWage = MIN_HOURLY_WAGE;
  } else if (newWageType && newWageType.startsWith("hourly_")) {
    hourlyWage = wageVal;
  }
  let bonus = "";
  if (
    newWageType &&
    newWageType.startsWith("hourly_min_") &&
    wageVal != null &&
    wageVal > 0
  ) {
    const hoursFactor = h100 + h125 * 1.25 + h150 * 1.5;
    bonus = (wageVal - MIN_HOURLY_WAGE) * hoursFactor;
  }
  const netFlag = newWageType && newWageType.endsWith("_net") ? "נ" : "";
  const isGlobal = !!newWageType && newWageType.startsWith("global_");
  const amount = isGlobal && wageVal != null ? wageVal : "";

  // Actual attendance for the Shiklulit recordType=4 employment-data rows.
  // Kept separate from the paid 100/125/150 bands above ("actual" ≠ "paid"):
  //   • actualWorkDays  = number of distinct worked dates (work_dates).
  //   • actualWorkHours = total clocked hours (daily_hours, derived from
  //     entry/exit times), which already excludes absence-only rows since
  //     those carry no punches. Rounded to 2 decimals like the other exported
  //     numeric values.
  // null (not 0) signals "source absent → cannot calculate" so the exporter
  // can raise a clear validation error instead of emitting a bogus 0.
  const workDates = Array.isArray(emp.work_dates) ? emp.work_dates : null;
  const dailyHours =
    emp.daily_hours && typeof emp.daily_hours === "object"
      ? emp.daily_hours
      : null;
  const actualWorkDays =
    workDates != null
      ? workDates.length
      : dailyHours != null
        ? Object.keys(dailyHours).length
        : null;
  const actualWorkHours =
    dailyHours != null
      ? Math.round(
          Object.values(dailyHours).reduce((s, v) => s + (Number(v) || 0), 0) *
            100,
        ) / 100
      : null;

  const dailyTravel =
    dbEmp.travel != null
      ? Number(dbEmp.travel)
      : emp.travel != null && emp.travel !== ""
        ? Number(emp.travel)
        : null;
  const maxTravel =
    dbEmp.maxTravel != null
      ? Number(dbEmp.maxTravel)
      : emp.maxTravel != null && emp.maxTravel !== ""
        ? Number(emp.maxTravel)
        : null;
  const workdays = emp.workdays != null ? Number(emp.workdays) : 0;
  let travelAmount = "";
  if (maxTravel != null) {
    if (dailyTravel == null || dailyTravel * workdays > maxTravel) {
      travelAmount = maxTravel;
    } else {
      travelAmount = dailyTravel * workdays;
    }
  } else if (dailyTravel != null) {
    travelAmount = dailyTravel * workdays;
  }

  // Per-role base/OT breakdown for the Shiklulit exporter. Each role carries its
  // OWN effective hourly rate (falling back to the employee default when the role
  // has no wage) plus its hours from payroll_data. The exporter maps each to the
  // right base component code: 1 (rate == employee default), 31 (other rate),
  // 33 (role "מתלמד"). The Micpal exporter ignores this field.
  const roleBreakdown = [];
  if (!isGlobal) {
    const rolesByName = dbEmp.rolesByName || {};
    for (const [role, payload] of Object.entries(payroll)) {
      const hrs = (payload && payload.hours) || [];
      const rh100 = Number(hrs[0] || 0);
      const rh125 = Number(hrs[1] || 0);
      const rh150 = Number(hrs[2] || 0);
      if (rh100 === 0 && rh125 === 0 && rh150 === 0) continue;
      let rate = effectiveHourlyRate(rolesByName[role], {
        minHourlyWage: MIN_HOURLY_WAGE,
      });
      if (rate == null) rate = hourlyWage; // fall back to employee default
      roleBreakdown.push({
        role,
        rate: rate ?? null,
        h100: rh100,
        h125: rh125,
        h150: rh150,
      });
    }
  }

  // מפרעה (advance) is no longer exported (it was being read as tips in the
  // Shiklulit import) — neither the computed hourly_min advance nor the stored
  // manual value is emitted to either export file.

  return {
    name,
    keyName: idNmbr ? micpalByIdNmbr.get(idNmbr) || "" : "",
    ID_nmbr: idNmbr,
    isGlobal,
    // קבלן (contractor) employees are excluded from the export entirely.
    contractor: !!dbEmp.contractor,
    new_wage_type: newWageType,
    // employee default effective hourly rate, used by the Shiklulit exporter to
    // decide which roles map to base component code 1 vs 31.
    defaultWage: hourlyWage,
    roleBreakdown,
    vacation: "",
    hourlyWage: isGlobal ? "" : (hourlyWage ?? ""),
    workdays: isGlobal ? "" : workdays || "",
    workdaysRaw: workdays || 0,
    // recordType=4 attendance (see derivation above). Consumed by the
    // Shiklulit exporter; the Micpal exporter ignores these fields.
    actualWorkDays,
    actualWorkHours,
    hours100: isGlobal ? "" : h100 || "",
    wage125: !isGlobal && hourlyWage != null ? hourlyWage * 1.25 : "",
    hours125: isGlobal ? "" : h125 || "",
    wage150: !isGlobal && hourlyWage != null ? hourlyWage * 1.5 : "",
    hours150: isGlobal ? "" : h150 || "",
    hoursSum: isGlobal ? "" : h100 + h125 + h150 || "",
    shabbat: isGlobal ? "" : shabbat || "",
    holiday: isGlobal ? "" : holiday || "",
    net: netFlag,
    travel: travelAmount,
    // השלמה (completion) is intentionally excluded from the export — always
    // blank. The Micpal exporter keeps the column but emits no value; tips are
    // likewise never exported.
    completion: "",
    bonus,
    amount,
    standardDays: stdDays ?? "",
    standardHours: stdHours ?? "",
  };
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 50,
  },
});

const parseUpload = upload.array("files");

// Normalize a name for comparison: strip Hebrew geresh, bidi/zero-width
// control characters, apostrophe-family glyphs, then NFC-normalize, trim,
// and collapse whitespace.  Mirrors the client-side normalization in
// Shifts.js so server-side matching (attach-phones, extract dedup) agrees
// with what the user sees in the wizard.
const normName = (s) =>
  String(s == null ? "" : s)
    .replace(/[​-‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/[׳'‘’‚‛`´ʹʻ-ʿ]/g, "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ");

// Build the set of identity keys for a single employee record. A row is
// considered "the same employee" if any of its keys intersects another's.
// Both an ID-based key and a name-based key are emitted when available, so
// that a DB row stored only by name still matches an xlsx row that now has
// an ID (and vice versa).
const matchKeysOf = (e) => {
  const out = new Set();
  const idn = String(e.ID_nmbr == null ? "" : e.ID_nmbr).trim();
  const nm = normName(e.name);
  if (idn) out.add(`id:${idn}`);
  if (nm) out.add(`name:${nm}`);
  return out;
};

// Back-compat single-key helper for callers that just need any one key.
const matchKey = (e) => {
  const keys = matchKeysOf(e);
  return keys.values().next().value || `name:`;
};

async function fetchExistingKeys(rest) {
  if (!rest) return new Set();
  const [rows] = await executeSql(
    "SELECT ID_nmbr, name FROM employees WHERE rest = :rest",
    { rest },
  );
  const set = new Set();
  for (const r of rows || []) {
    for (const k of matchKeysOf({ ID_nmbr: r.ID_nmbr, name: r.name })) {
      set.add(k);
    }
  }
  return set;
}

async function resolveEmployeeId(rest, emp) {
  if (emp.ID_nmbr) {
    const [rows] = await executeSql(
      "SELECT employee_id FROM employees WHERE rest = :rest AND ID_nmbr = :id LIMIT 1",
      { rest, id: String(emp.ID_nmbr).trim() },
    );
    if (rows && rows[0]) return rows[0].employee_id;
  }
  if (emp.name) {
    const [rows] = await executeSql(
      "SELECT employee_id FROM employees WHERE rest = :rest AND name = :name LIMIT 1",
      { rest, name: String(emp.name).trim() },
    );
    if (rows && rows[0]) return rows[0].employee_id;
  }
  return null;
}

const Router = () => {
  const router = express.Router();

  router.post("/extract", (req, res) => {
    parseUpload(req, res, async (uploadErr) => {
      if (uploadErr) {
        return res
          .status(400)
          .json({ error: uploadErr.message || "upload failed" });
      }
      try {
        const rest = (req.body && req.body.rest) || "";
        const uploaded = req.files || [];
        if (uploaded.length === 0) {
          return res.status(400).json({ error: "No files uploaded" });
        }
        const items = uploaded
          .filter((f) => /\.xlsx$/i.test(f.originalname))
          .map((f) => ({ filename: f.originalname, buffer: f.buffer }));

        if (items.length === 0) {
          return res
            .status(400)
            .json({ error: "No .xlsx files found in upload" });
        }

        const { employees, exceptions, month, shiftIssues } =
          await extractEmployees(items);

        const existingKeys = await fetchExistingKeys(rest);
        const newOnly = employees.filter((e) => {
          for (const k of matchKeysOf(e)) {
            if (existingKeys.has(k)) return false;
          }
          return true;
        });

        const newRows = newOnly.map((e) => ({
          rest,
          name: e.name,
          ID_nmbr: e.ID_nmbr,
          clockId: e.clockId ?? null,
          roles: e.roles,
          payroll_data: e.payroll_data,
        }));

        const allRows = employees.map((e) => ({
          rest,
          name: e.name,
          ID_nmbr: e.ID_nmbr,
          clockId: e.clockId ?? null,
          roles: e.roles,
          payroll_data: e.payroll_data,
          role_extras: e.role_extras || {},
          workdays: e.workdays,
          global: e.global,
          netGross: e.netGross,
          work_dates: Array.isArray(e.work_dates) ? e.work_dates : [],
          daily_breakdown:
            e.daily_breakdown && typeof e.daily_breakdown === "object"
              ? e.daily_breakdown
              : {},
          daily_hours:
            e.daily_hours && typeof e.daily_hours === "object"
              ? e.daily_hours
              : {},
        }));

        res.json({
          employees: newRows,
          allEmployees: allRows,
          month,
          exceptions,
          shiftIssues: shiftIssues || [],
          processed: items.length,
          totalExtracted: employees.length,
          alreadyExisting: employees.length - newOnly.length,
        });
      } catch (err) {
        console.error("payroll/extract error:", err);
        res.status(500).json({ error: err.message || "extraction failed" });
      }
    });
  });

  router.post("/employees", async (req, res) => {
    try {
      const list = Array.isArray(req.body?.employees) ? req.body.employees : [];
      if (list.length === 0) {
        return res.status(400).json({ error: "No employees in request body" });
      }

      let inserted = 0;
      let updated = 0;
      const errors = [];
      for (const emp of list) {
        const rest = (emp.rest || "").trim();
        const name = (emp.name || "").trim();
        if (!rest || !name) {
          errors.push({ name, issue: "missing rest or name" });
          continue;
        }
        const rolesJson = serializeRoles(emp.roles);
        // Prefer the modern compound wage ({ new_wage_type, wage }) and derive
        // the legacy global / hourly_wage / wage_type columns from it (same
        // mapping as /employees/update). Fall back to the legacy fields when the
        // compound type is absent, so older callers keep working.
        const newWageType = isValidWageType(emp.new_wage_type)
          ? emp.new_wage_type
          : null;
        let wageVal = null;
        let globalVal = null;
        let hourlyWageVal = null;
        let wageType = "gross";
        if (newWageType) {
          wageVal = toDecimalString(emp.wage);
          wageType = newWageType.endsWith("_net") ? "net" : "gross";
          if (newWageType.startsWith("global_")) {
            globalVal = wageVal;
          } else if (newWageType.startsWith("hourly_min_")) {
            hourlyWageVal = "-1";
          } else {
            hourlyWageVal = wageVal;
          }
        } else {
          globalVal =
            emp.global === "" || emp.global == null ? null : Number(emp.global);
          hourlyWageVal =
            emp.hourly_wage === "" || emp.hourly_wage == null
              ? null
              : Number(emp.hourly_wage);
          wageType = emp.wage_type === "net" ? "net" : "gross";
        }
        const travelVal =
          emp.travel === "" || emp.travel == null ? null : Number(emp.travel);
        const maxTravelVal =
          emp.maxTravel === "" || emp.maxTravel == null
            ? null
            : Number(emp.maxTravel);
        const phoneVal = emp.phone ? String(emp.phone).trim() || null : null;
        const companyVal = emp.company
          ? String(emp.company).trim() || null
          : null;
        const idNmbr = emp.ID_nmbr || null;
        try {
          const existingId = await resolveEmployeeId(rest, emp);
          if (existingId) {
            // On a duplicate match the caller may pass `newName` to overwrite
            // the stored name (the row is still resolved by the original name).
            const newNameVal =
              emp.newName != null && String(emp.newName).trim()
                ? String(emp.newName).trim()
                : null;
            const sets = [];
            if (newNameVal) sets.push("name = :newName");
            if (phoneVal) sets.push("phone = :phone");
            if (idNmbr) sets.push("ID_nmbr = :ID_nmbr");
            if (companyVal) sets.push("company = :company");
            if (rolesJson !== "[]") sets.push("roles = CAST(:roles AS JSON)");
            if (sets.length === 0) {
              updated += 1;
            } else {
              const [result] = await executeSql(
                `UPDATE employees SET ${sets.join(", ")} WHERE employee_id = :id`,
                {
                  id: existingId,
                  newName: newNameVal,
                  phone: phoneVal,
                  ID_nmbr: idNmbr,
                  company: companyVal,
                  roles: rolesJson,
                },
              );
              if (result && result.affectedRows >= 1) updated += 1;
            }
          } else {
            await executeSql(
              `INSERT INTO employees (rest, company, name, ID_nmbr, phone, roles, t101, \`global\`, hourly_wage, wage_type, new_wage_type, wage, travel, maxTravel, contractor)
               VALUES (:rest, :company, :name, :ID_nmbr, :phone, CAST(:roles AS JSON), :t101, :gbl, :hw, :wt, :nwt, :wage, :tr, :mtr, :ctr)`,
              {
                rest,
                company: companyVal,
                name,
                ID_nmbr: idNmbr,
                phone: phoneVal,
                roles: rolesJson,
                t101: emp.t101 ? 1 : 0,
                gbl: globalVal,
                hw: hourlyWageVal,
                wt: wageType,
                nwt: newWageType,
                wage: wageVal,
                tr: travelVal,
                mtr: maxTravelVal,
                ctr: emp.contractor ? 1 : 0,
              },
            );
            inserted += 1;
          }
        } catch (e) {
          errors.push({ name, issue: e.message || "upsert failed" });
        }
      }

      res.json({ inserted, updated, attempted: list.length, errors });
    } catch (err) {
      console.error("payroll/employees error:", err);
      res.status(500).json({ error: err.message || "save failed" });
    }
  });

  router.post("/wages", async (req, res) => {
    try {
      const rest = String(req.body?.rest || "").trim();
      if (!rest) return res.status(400).json({ error: "missing rest" });
      // scope=all returns every row with active+duplicate status fields
      // (used by the Employees admin page to drive filter dropdowns).
      // Default keeps the active+non-duplicate behavior expected by the
      // payroll wizard.
      const scope = String(req.body?.scope || "").trim();
      const sql =
        scope === "all"
          ? "SELECT employee_id, company, ID_nmbr, phone, name, roles, `global`, hourly_wage, wage_type, new_wage_type, wage, travel, maxTravel, contractor, active, duplicate FROM employees WHERE rest = :rest"
          : "SELECT employee_id, company, ID_nmbr, phone, name, roles, `global`, hourly_wage, wage_type, new_wage_type, wage, travel, maxTravel, contractor FROM employees WHERE rest = :rest AND active = 1 AND duplicate IS NULL";
      const [rows] = await executeSql(sql, { rest });

      // Payroll-software employee number (מס עובד) keyed by ID_nmbr. Loaded
      // separately (not joined) because employees.ID_nmbr and
      // payroll_soft_ix.ID_nmbr use different collations — same approach the
      // export route uses.
      const [keyRows] = await executeSql(
        "SELECT keyName, ID_nmbr FROM payroll_soft_ix WHERE ID_nmbr IS NOT NULL",
        {},
      );
      const empNumberByIdNmbr = new Map();
      for (const k of keyRows || []) {
        if (k.ID_nmbr != null)
          empNumberByIdNmbr.set(String(k.ID_nmbr).trim(), k.keyName);
      }
      const out = [];
      for (const r of rows || []) {
        let roles = [];
        if (r.roles) {
          try {
            roles = typeof r.roles === "string" ? JSON.parse(r.roles) : r.roles;
          } catch {
            roles = [];
          }
        }
        const asDecimalString = (v) => (v == null ? null : String(v));
        const entry = {
          employee_id: r.employee_id,
          company: r.company || null,
          ID_nmbr: r.ID_nmbr,
          // Payroll-software employee number (מס עובד), from payroll_soft_ix.
          empNumber:
            r.ID_nmbr != null
              ? (empNumberByIdNmbr.get(String(r.ID_nmbr).trim()) ?? null)
              : null,
          phone: r.phone || null,
          name: r.name,
          // Normalize legacy bare-number role wages to the compound
          // { role, new_wage_type, wage } shape so the client always sees one
          // format (old plain number → hourly_gross).
          roles: normalizeRoles(roles),
          global: asDecimalString(r.global),
          hourly_wage: asDecimalString(r.hourly_wage),
          wage_type: r.wage_type || null,
          new_wage_type: r.new_wage_type || null,
          wage: asDecimalString(r.wage),
          travel: asDecimalString(r.travel),
          maxTravel: asDecimalString(r.maxTravel),
          contractor: !!r.contractor,
        };
        if (scope === "all") {
          entry.active = r.active == null ? true : !!Number(r.active);
          entry.duplicate = r.duplicate == null ? null : Number(r.duplicate);
        }
        out.push(entry);
      }
      res.json({ employees: out });
    } catch (err) {
      console.error("payroll/wages error:", err);
      res.status(500).json({ error: err.message || "wages lookup failed" });
    }
  });

  router.post("/employees/update", async (req, res) => {
    try {
      const list = Array.isArray(req.body?.employees) ? req.body.employees : [];
      if (list.length === 0) {
        return res.status(400).json({ error: "No employees in request body" });
      }
      let updated = 0;
      const errors = [];
      for (const emp of list) {
        const id = Number(emp.employee_id);
        if (!Number.isFinite(id)) {
          errors.push({ name: emp.name, issue: "missing employee_id" });
          continue;
        }
        // Persist roles in the compound { role, new_wage_type, wage } format,
        // upgrading any legacy bare-number entries in the process.
        const rolesJson = serializeRoles(emp.roles);
        const newWageType = isValidWageType(emp.new_wage_type)
          ? emp.new_wage_type
          : null;
        const wageVal = toDecimalString(emp.wage);
        // Derive legacy columns (global / hourly_wage / wage_type) from the
        // new compound type + wage so older readers keep working.
        let globalVal = null;
        let hourlyWageVal = null;
        let wageType = null;
        if (newWageType) {
          wageType = newWageType.endsWith("_net") ? "net" : "gross";
          if (newWageType.startsWith("global_")) {
            globalVal = wageVal;
          } else if (newWageType.startsWith("hourly_min_")) {
            hourlyWageVal = "-1";
          } else {
            hourlyWageVal = wageVal;
          }
        }
        const travelVal = toDecimalString(emp.travel);
        const maxTravelVal = toDecimalString(emp.maxTravel);
        try {
          const companyVal =
            emp.company != null ? String(emp.company).trim() || null : null;
          const [result] = await executeSql(
            `UPDATE employees
             SET company = :company,
                 roles = CAST(:roles AS JSON),
                 \`global\` = :gbl,
                 hourly_wage = :hw,
                 wage_type = :wt,
                 new_wage_type = :nwt,
                 wage = :wage,
                 travel = :tr,
                 maxTravel = :mtr,
                 contractor = :ctr
             WHERE employee_id = :id`,
            {
              id,
              company: companyVal,
              roles: rolesJson,
              gbl: globalVal,
              hw: hourlyWageVal,
              wt: wageType,
              nwt: newWageType,
              wage: wageVal,
              tr: travelVal,
              mtr: maxTravelVal,
              ctr: emp.contractor ? 1 : 0,
            },
          );
          if (result && result.affectedRows >= 1) updated += 1;
          else errors.push({ name: emp.name, issue: "no row updated" });
        } catch (e) {
          errors.push({ name: emp.name, issue: e.message || "update failed" });
        }
      }
      res.json({ updated, attempted: list.length, errors });
    } catch (err) {
      console.error("payroll/employees/update error:", err);
      res.status(500).json({ error: err.message || "update failed" });
    }
  });

  router.post("/employees/duplicate-with", async (req, res) => {
    try {
      const id = Number(req.body?.employee_id);
      const dupOf = Number(req.body?.duplicate_of);
      if (!Number.isFinite(id) || !Number.isFinite(dupOf)) {
        return res
          .status(400)
          .json({ error: "missing employee_id or duplicate_of" });
      }
      if (id === dupOf) {
        return res
          .status(400)
          .json({ error: "employee cannot be a duplicate of itself" });
      }
      const [result] = await executeSql(
        "UPDATE employees SET duplicate = :dupOf WHERE employee_id = :id",
        { id, dupOf },
      );
      if (!result || result.affectedRows < 1) {
        return res.status(404).json({ error: "employee not found" });
      }
      res.json({ employee_id: id, duplicate: dupOf });
    } catch (err) {
      console.error("payroll/employees/duplicate-with error:", err);
      res
        .status(500)
        .json({ error: err.message || "mark-as-duplicate failed" });
    }
  });

  // Parse a Tabit-style employee xlsx and return the entries. No DB writes —
  // used by the wizard's "Employee data" step which attaches phones to the
  // in-memory new-employee list before commit.
  const parseEmpXlsx = upload.single("file");
  router.post("/employees/parse-phone-xlsx", (req, res) => {
    parseEmpXlsx(req, res, async (uploadErr) => {
      if (uploadErr) {
        return res
          .status(400)
          .json({ error: uploadErr.message || "upload failed" });
      }
      try {
        const f = req.file;
        if (!f || !f.buffer) {
          return res.status(400).json({ error: "no file uploaded" });
        }
        if (!/\.xlsx$/i.test(f.originalname || "")) {
          return res.status(400).json({ error: "expected an .xlsx file" });
        }
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(f.buffer);
        const sheet = wb.worksheets[0];
        if (!sheet || sheet.rowCount < 2) {
          return res.status(400).json({ error: "empty workbook" });
        }
        const HEADERS = {
          username: ["שם משתמש"],
          active: ["פעיל"],
          name: ["שם פרטי", "שם מלא"],
          family: ["שם משפחה"],
          phone: ["טלפון נייד", "טלפון", "נייד", "פלאפון", "מספר טלפון"],
          id: ["מספר זהות", "תעודת זהות", 'ת"ז', "ת.ז.", "תז"],
          clockId: ["מזהה שעון"],
        };
        const norm = (s) => String(s == null ? "" : s).trim();
        const cellText = (c) => {
          if (c == null) return "";
          const v = c.value;
          if (v == null) return "";
          if (typeof v === "object") {
            if (typeof v.text === "string") return v.text;
            if (v.richText) return v.richText.map((p) => p.text || "").join("");
            if (v.result != null) return String(v.result);
          }
          return String(v);
        };
        const scoreHeaderRow = (rowIdx) => {
          let hits = 0;
          sheet.getRow(rowIdx).eachCell({ includeEmpty: false }, (cell) => {
            const t = norm(cellText(cell));
            for (const labels of Object.values(HEADERS)) {
              if (labels.some((l) => t === l)) hits += 1;
            }
          });
          return hits;
        };
        let headerRowIdx = 1;
        let best = 0;
        for (let r = 1; r <= Math.min(sheet.rowCount, 15); r++) {
          const h = scoreHeaderRow(r);
          if (h > best) {
            best = h;
            headerRowIdx = r;
          }
        }
        const cols = {};
        sheet
          .getRow(headerRowIdx)
          .eachCell({ includeEmpty: false }, (cell, col) => {
            const t = norm(cellText(cell));
            for (const [key, labels] of Object.entries(HEADERS)) {
              if (cols[key]) continue;
              if (labels.some((l) => t === l || t.includes(l))) cols[key] = col;
            }
          });
        if (!cols.phone) {
          return res.status(400).json({
            error: "no phone column found (טלפון נייד / טלפון / נייד)",
          });
        }
        const cleanPhone = (s) => norm(s).replace(/[^\d+]/g, "");
        const entries = [];
        for (let r = headerRowIdx + 1; r <= sheet.rowCount; r++) {
          const row = sheet.getRow(r);
          const activeRaw = cols.active
            ? norm(cellText(row.getCell(cols.active)))
            : "";
          const phone = cleanPhone(cellText(row.getCell(cols.phone)));
          if (!phone) continue;
          const first = cols.name ? norm(cellText(row.getCell(cols.name))) : "";
          const family = cols.family
            ? norm(cellText(row.getCell(cols.family)))
            : "";
          const ID_nmbr = cols.id ? norm(cellText(row.getCell(cols.id))) : "";
          const clockId = cols.clockId
            ? norm(cellText(row.getCell(cols.clockId)))
            : "";
          entries.push({
            name: first,
            family,
            phone,
            ID_nmbr: ID_nmbr || null,
            clockId: clockId || null,
            active: !activeRaw || activeRaw === "פעיל",
          });
        }
        res.json({
          file: f.originalname,
          headerRow: headerRowIdx,
          entries,
          scannedRows: sheet.rowCount - headerRowIdx,
        });
      } catch (err) {
        console.error("payroll/employees/parse-phone-xlsx error:", err);
        res.status(500).json({ error: err.message || "parse failed" });
      }
    });
  });

  const parseAttachPhones = upload.single("file");
  router.post("/employees/attach-phones", (req, res) => {
    parseAttachPhones(req, res, async (uploadErr) => {
      if (uploadErr) {
        return res
          .status(400)
          .json({ error: uploadErr.message || "upload failed" });
      }
      try {
        const rest = String(req.body?.rest || "").trim();
        if (!rest) return res.status(400).json({ error: "missing rest" });
        const f = req.file;
        if (!f || !f.buffer) {
          return res.status(400).json({ error: "no file uploaded" });
        }
        if (!/\.xlsx$/i.test(f.originalname || "")) {
          return res.status(400).json({ error: "expected an .xlsx file" });
        }
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(f.buffer);
        const sheet = wb.worksheets[0];
        if (!sheet || sheet.rowCount < 2) {
          return res.status(400).json({ error: "empty workbook" });
        }

        // Matches the Tabit-style "רשימת עובדים" export: a title row at the
        // top, an empty row, then the real header row (typically row 4) with
        // columns: שם משתמש, קבוצה, פעיל, שם פרטי, שם משפחה, טלפון נייד, …
        const HEADERS = {
          username: ["שם משתמש"],
          active: ["פעיל"],
          name: ["שם פרטי", "שם מלא"],
          family: ["שם משפחה"],
          phone: ["טלפון נייד", "טלפון", "נייד", "פלאפון", "מספר טלפון"],
          id: ["מספר זהות", "תעודת זהות", 'ת"ז', "ת.ז.", "תז"],
        };
        const norm = (s) => String(s == null ? "" : s).trim();
        const cellText = (c) => {
          if (c == null) return "";
          const v = c.value;
          if (v == null) return "";
          if (typeof v === "object") {
            if (typeof v.text === "string") return v.text;
            if (v.richText) return v.richText.map((p) => p.text || "").join("");
            if (v.result != null) return String(v.result);
          }
          return String(v);
        };

        // Find the header row: first row in the top 15 that contains either
        // "שם פרטי" or "טלפון נייד" exactly.
        const scoreHeaderRow = (rowIdx) => {
          let hits = 0;
          sheet.getRow(rowIdx).eachCell({ includeEmpty: false }, (cell) => {
            const t = norm(cellText(cell));
            for (const labels of Object.values(HEADERS)) {
              if (labels.some((l) => t === l)) hits += 1;
            }
          });
          return hits;
        };
        let headerRowIdx = 1;
        let best = 0;
        for (let r = 1; r <= Math.min(sheet.rowCount, 15); r++) {
          const h = scoreHeaderRow(r);
          if (h > best) {
            best = h;
            headerRowIdx = r;
          }
        }
        const cols = {};
        sheet
          .getRow(headerRowIdx)
          .eachCell({ includeEmpty: false }, (cell, col) => {
            const t = norm(cellText(cell));
            for (const [key, labels] of Object.entries(HEADERS)) {
              if (cols[key]) continue;
              if (labels.some((l) => t === l || t.includes(l))) cols[key] = col;
            }
          });
        if (!cols.phone) {
          return res.status(400).json({
            error: "no phone column found (טלפון נייד / טלפון / נייד)",
          });
        }
        if (!cols.name && !cols.id) {
          return res.status(400).json({ error: "no name or ID column found" });
        }

        // Load this restaurant's employees once and build lookup maps.
        const [empRows] = await executeSql(
          "SELECT employee_id, name, ID_nmbr FROM employees WHERE rest = :rest AND active = 1 AND duplicate IS NULL",
          { rest },
        );
        const byId = new Map();
        const byName = new Map();
        for (const r of empRows || []) {
          if (r.ID_nmbr) byId.set(String(r.ID_nmbr).trim(), r.employee_id);
          if (r.name) byName.set(normName(r.name), r.employee_id);
        }

        // Strip non-digits from phone (Tabit exports often have spaces/dashes).
        const cleanPhone = (s) => norm(s).replace(/[^\d+]/g, "");

        let updated = 0;
        let unmatched = 0;
        let skipped = 0;
        const errors = [];
        const unmatchedNames = [];
        for (let r = headerRowIdx + 1; r <= sheet.rowCount; r++) {
          const row = sheet.getRow(r);
          // Skip rows that aren't real records — e.g. the active column says
          // anything other than "פעיל" (active). Inactive employees in Tabit
          // shouldn't have their phone written into our employees table.
          if (cols.active) {
            const a = norm(cellText(row.getCell(cols.active)));
            if (a && a !== "פעיל") {
              skipped += 1;
              continue;
            }
          }
          const phone = cleanPhone(cellText(row.getCell(cols.phone)));
          if (!phone) {
            skipped += 1;
            continue;
          }
          let employee_id = null;
          if (cols.id) {
            const idn = norm(cellText(row.getCell(cols.id)));
            if (idn && byId.has(idn)) employee_id = byId.get(idn);
          }
          if (!employee_id && (cols.name || cols.family)) {
            const first = cols.name
              ? norm(cellText(row.getCell(cols.name)))
              : "";
            const fam = cols.family
              ? norm(cellText(row.getCell(cols.family)))
              : "";
            for (const candidate of [
              `${first} ${fam}`,
              `${fam} ${first}`,
              first,
              fam,
            ]) {
              const key = normName(candidate);
              if (key && byName.has(key)) {
                employee_id = byName.get(key);
                break;
              }
            }
            if (!employee_id) {
              unmatchedNames.push(`${first} ${fam}`.trim());
            }
          }
          if (!employee_id) {
            unmatched += 1;
            continue;
          }
          try {
            const [result] = await executeSql(
              "UPDATE employees SET phone = :phone WHERE employee_id = :id",
              { id: employee_id, phone },
            );
            if (result && result.affectedRows >= 1) updated += 1;
          } catch (e) {
            errors.push({ row: r, employee_id, issue: e.message });
          }
        }

        res.json({
          file: f.originalname,
          updated,
          unmatched,
          skipped,
          unmatchedNames,
          errors,
          headerRow: headerRowIdx,
          scannedRows: sheet.rowCount - headerRowIdx,
        });
      } catch (err) {
        console.error("payroll/employees/attach-phones error:", err);
        res.status(500).json({ error: err.message || "attach failed" });
      }
    });
  });

  router.post("/micpal/list", async (req, res) => {
    try {
      // Filter the index by the restaurant's company so matching only sees
      // employees that belong to the same payroll-software company.
      const rest = String(req.body?.rest || "").trim();
      const company = rest ? micCompanyForBranch(rest) : "";
      const sql = company
        ? "SELECT keyName, name, family, ID_nmbr, company FROM payroll_soft_ix WHERE company = :company"
        : "SELECT keyName, name, family, ID_nmbr, company FROM payroll_soft_ix";
      const [rows] = await executeSql(sql, company ? { company } : {});
      res.json({ rows: rows || [], company: company || null });
    } catch (err) {
      console.error("payroll/micpal/list error:", err);
      res.status(500).json({ error: err.message || "micpal list failed" });
    }
  });

  router.post("/employees/set-id-nmbr", async (req, res) => {
    try {
      const list = Array.isArray(req.body?.updates) ? req.body.updates : [];
      if (list.length === 0) {
        return res.status(400).json({ error: "no updates in body" });
      }
      let updated = 0;
      const errors = [];
      for (const u of list) {
        const id = Number(u.employee_id);
        const idNmbr = String(u.ID_nmbr || "").trim();
        if (!Number.isFinite(id) || !idNmbr) {
          errors.push({
            employee_id: u.employee_id,
            issue: "missing employee_id or ID_nmbr",
          });
          continue;
        }
        try {
          const [result] = await executeSql(
            "UPDATE employees SET ID_nmbr = :idNmbr WHERE employee_id = :id",
            { id, idNmbr },
          );
          if (result && result.affectedRows >= 1) updated += 1;
          else errors.push({ employee_id: id, issue: "no row updated" });
        } catch (e) {
          errors.push({ employee_id: id, issue: e.message || "update failed" });
        }
      }
      res.json({ updated, attempted: list.length, errors });
    } catch (err) {
      console.error("payroll/employees/set-id-nmbr error:", err);
      res.status(500).json({ error: err.message || "update failed" });
    }
  });

  router.post("/employees/deactivate", async (req, res) => {
    try {
      const id = Number(req.body?.employee_id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: "missing employee_id" });
      }
      const [result] = await executeSql(
        "UPDATE employees SET active = 0 WHERE employee_id = :id",
        { id },
      );
      if (!result || result.affectedRows < 1) {
        return res.status(404).json({ error: "employee not found" });
      }
      res.json({ employee_id: id, active: false });
    } catch (err) {
      console.error("payroll/employees/deactivate error:", err);
      res.status(500).json({ error: err.message || "deactivate failed" });
    }
  });

  // Sync the `micpal` table from a Micpal xlsx export uploaded by the
  // user via a file picker in the Employees page.
  const parseMicpalUpload = upload.single("file");
  // Shared cell readers used by both Micpal and Siklulit parsers.
  const _norm = (s) => String(s == null ? "" : s).trim();
  const _cellText = (c) => {
    if (c == null) return "";
    const v = c.value;
    if (v == null) return "";
    if (typeof v === "object") {
      if (typeof v.text === "string") return v.text;
      if (v.richText) return v.richText.map((p) => p.text || "").join("");
      if (v.result != null) return String(v.result);
    }
    return String(v);
  };

  // Micpal index file: headers in row 1, data row 2+. No per-file company.
  // Returns { items, scannedRows, skipped, company } or { error }.
  const parseMicpalSheet = (sheet) => {
    const HEADERS = {
      keyName: ["מספר עובד"],
      name: ["שם פרטי"],
      family: ["שם משפחה"],
      ID_nmbr: ["מספר זהות", "תעודת זהות", 'ת"ז', "ת.ז.", "תז"],
      passport: ["מספר דרכון", "דרכון"],
    };
    const cols = {};
    sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNum) => {
      const t = _norm(_cellText(cell));
      for (const [key, labels] of Object.entries(HEADERS)) {
        if (cols[key]) continue;
        if (labels.some((l) => t === l || t.includes(l))) cols[key] = colNum;
      }
    });
    if (!cols.keyName) {
      return { error: 'header "מספר עובד" not found in row 1 (Micpal format)' };
    }
    let skipped = 0;
    const items = [];
    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const keyName = _norm(_cellText(row.getCell(cols.keyName)));
      if (!keyName) {
        skipped += 1;
        continue;
      }
      // מספר זהות; treat blank OR all-zeros ("0") as missing — foreign workers
      // carry "0" here and their real number lives in מספר דרכון (passport).
      const rawId = cols.ID_nmbr
        ? _norm(_cellText(row.getCell(cols.ID_nmbr)))
        : "";
      const idNmbr = rawId && !/^0+$/.test(rawId) ? rawId : null;
      const passport = cols.passport
        ? _norm(_cellText(row.getCell(cols.passport))) || null
        : null;
      items.push([
        keyName,
        keyName,
        cols.name ? _norm(_cellText(row.getCell(cols.name))) || null : null,
        cols.family ? _norm(_cellText(row.getCell(cols.family))) || null : null,
        idNmbr || passport,
      ]);
    }
    return {
      items,
      scannedRows: sheet.rowCount - 1,
      skipped,
      company: null,
    };
  };

  // Siklulit (שיקלולית) employee index file: header row 7, data 8+.
  // A1 reads "חברה NNN: <label>"; "באמצעות \"שיקלולית" appears in row 5.
  // Returns { items, scannedRows, skipped, company } or { error }.
  const parseSiklulitSheet = (sheet) => {
    if (sheet.rowCount < 8) {
      return { error: "Siklulit file is too short (need headers in row 7)" };
    }
    const a1 = _norm(_cellText(sheet.getRow(1).getCell(1)));
    const r5 = _norm(_cellText(sheet.getRow(5).getCell(1)));
    if (!/שיקלולית/.test(`${a1} ${r5}`)) {
      return { error: 'not a Siklulit file (missing "שיקלולית" marker)' };
    }
    const companyMatch = a1.match(/חברה\s+(\d+)/);
    const company = companyMatch ? companyMatch[1] : null;

    const HEADERS = {
      keyName: ["מספר עובד"],
      ID_nmbr: ["מספר זהות", "תעודת זהות", 'ת"ז', "ת.ז.", "תז"],
      passport: ["מספר דרכון", "דרכון"],
      family: ["שם משפחה"],
      name: ["שם פרטי"],
    };
    const cols = {};
    sheet.getRow(7).eachCell({ includeEmpty: false }, (cell, colNum) => {
      const t = _norm(_cellText(cell));
      for (const [key, labels] of Object.entries(HEADERS)) {
        if (cols[key]) continue;
        if (labels.some((l) => t === l || t.includes(l))) cols[key] = colNum;
      }
    });
    if (!cols.keyName) {
      return {
        error: 'header "מספר עובד" not found in row 7 (Siklulit format)',
      };
    }
    let skipped = 0;
    const items = [];
    for (let r = 8; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const keyName = _norm(_cellText(row.getCell(cols.keyName)));
      if (!keyName) {
        skipped += 1;
        continue;
      }
      // מספר זהות; treat blank OR all-zeros ("0") as missing — foreign workers
      // carry "0" here and their real number lives in מספר דרכון (passport).
      const rawId = cols.ID_nmbr
        ? _norm(_cellText(row.getCell(cols.ID_nmbr)))
        : "";
      const idNmbr = rawId && !/^0+$/.test(rawId) ? rawId : null;
      const passport = cols.passport
        ? _norm(_cellText(row.getCell(cols.passport))) || null
        : null;
      items.push([
        keyName,
        keyName,
        cols.name ? _norm(_cellText(row.getCell(cols.name))) || null : null,
        cols.family ? _norm(_cellText(row.getCell(cols.family))) || null : null,
        idNmbr || passport,
      ]);
    }
    return {
      items,
      scannedRows: sheet.rowCount - 7,
      skipped,
      company,
    };
  };

  router.post("/micpal/sync", (req, res) => {
    parseMicpalUpload(req, res, async (uploadErr) => {
      if (uploadErr) {
        return res
          .status(400)
          .json({ error: uploadErr.message || "upload failed" });
      }
      try {
        const f = req.file;
        if (!f || !f.buffer) {
          return res.status(400).json({ error: "no file uploaded" });
        }
        if (!/\.xlsx$/i.test(f.originalname || "")) {
          return res.status(400).json({ error: "expected an .xlsx file" });
        }
        const rest = String(req.body?.rest || "").trim();
        if (!rest) {
          return res
            .status(400)
            .json({ error: "missing rest — select a restaurant first" });
        }
        const payrollSoft = payrollSoftForBranch(rest);
        if (!payrollSoft) {
          return res.status(400).json({
            error: `no payroll_soft configured for restaurant ${rest}`,
          });
        }
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(f.buffer);
        const sheet = wb.worksheets[0];
        if (!sheet || sheet.rowCount < 2) {
          return res.status(400).json({ error: "empty workbook" });
        }

        let parsed;
        if (payrollSoft === "shik") parsed = parseSiklulitSheet(sheet);
        else if (payrollSoft === "mic") parsed = parseMicpalSheet(sheet);
        else
          return res
            .status(400)
            .json({ error: `unsupported payroll_soft "${payrollSoft}"` });
        if (parsed.error) {
          return res.status(400).json({ error: parsed.error });
        }
        const { items, scannedRows, skipped, company: parsedCompany } = parsed;
        // Micpal files don't carry a company in-sheet — fall back to the
        // mic_company configured for this restaurant in shared/restaurants.json.
        const company = parsedCompany || micCompanyForBranch(rest) || null;

        // One INSERT per ~2000 rows — handful of statements at most, stays
        // safely under MySQL's max_allowed_packet (default 64MB).
        let upserted = 0;
        const errors = [];
        const CHUNK = 2000;
        const pool = getDbPool();

        const [[{ cnt: countBefore }]] = await pool.query(
          "SELECT COUNT(*) AS cnt FROM payroll_soft_ix",
        );
        const [createResult] = await pool.query(
          "SHOW CREATE TABLE payroll_soft_ix",
        );
        console.log(`micpal table DDL:`, createResult[0]?.["Create Table"]);
        console.log(
          `micpal sync: ${items.length} items to upsert, ${countBefore} rows in table before`,
        );
        // Log sample items and check for duplicate keyNames
        const keySet = new Set();
        let dupCount = 0;
        for (const it of items) {
          if (keySet.has(it[0])) dupCount++;
          keySet.add(it[0]);
        }
        console.log(
          `micpal sync: unique keyNames in file: ${keySet.size}, duplicates: ${dupCount}`,
        );
        console.log(`micpal sync: first 5 items:`, items.slice(0, 5));
        console.log(`micpal sync: last 5 items:`, items.slice(-5));

        for (let i = 0; i < items.length; i += CHUNK) {
          const chunk = items.slice(i, i + CHUNK);
          const placeholders = chunk.map(() => "(?,?,?,?,?,?)").join(",");
          // Inject the file-level company into each row.
          const flat = [];
          for (const it of chunk) {
            flat.push(it[0], it[1], company, it[2], it[3], it[4]);
          }
          try {
            // Upsert collides on UNIQUE KEY uniq_company_keyName (company,
            // keyName): a re-imported employee UPDATES their row (incl. a
            // changed ID_nmbr) rather than inserting a duplicate. (The old
            // unique on (ID_nmbr, mic_nmbr, company) inserted dups whenever an
            // ID changed, e.g. "0" -> passport.)
            const [result] = await pool.query(
              `INSERT INTO payroll_soft_ix (keyName, mic_nmbr, company, name, family, ID_nmbr)
               VALUES ${placeholders} AS new_vals
               ON DUPLICATE KEY UPDATE
                 mic_nmbr = new_vals.mic_nmbr,
                 company = COALESCE(new_vals.company, payroll_soft_ix.company),
                 name = new_vals.name,
                 family = new_vals.family,
                 ID_nmbr = new_vals.ID_nmbr`,
              flat,
            );
            console.log(
              `micpal sync chunk ${i}-${i + chunk.length}: affectedRows=${result.affectedRows}, changedRows=${result.changedRows}, insertId=${result.insertId}, info=${result.info}`,
            );
            const [warnings] = await pool.query("SHOW WARNINGS");
            if (warnings.length > 0) {
              console.log(`micpal sync warnings:`, warnings);
            }
            upserted += chunk.length;
          } catch (e) {
            errors.push({
              chunkStart: i,
              chunkSize: chunk.length,
              issue: e.message || "bulk upsert failed",
            });
          }
        }

        const [[{ cnt: countAfter }]] = await pool.query(
          "SELECT COUNT(*) AS cnt FROM payroll_soft_ix",
        );
        console.log(
          `micpal sync: ${countAfter} rows in table after (was ${countBefore})`,
        );
        if (countAfter === countBefore) {
          console.log(
            "micpal sync: WARNING — row count unchanged! Checking overlap...",
          );
          const [[{ overlap }]] = await pool.query(
            `SELECT COUNT(*) AS overlap FROM payroll_soft_ix WHERE keyName IN (${items.map(() => "?").join(",")})`,
            items.map((it) => it[0]),
          );
          console.log(
            `micpal sync: ${overlap} of ${items.length} file keyNames already exist in table`,
          );
          const fileKeys = new Set(items.map((it) => it[0]));
          const [existingRows] = await pool.query(
            "SELECT keyName FROM payroll_soft_ix",
          );
          const dbKeys = new Set(existingRows.map((r) => r.keyName));
          const missingFromDb = [...fileKeys].filter((k) => !dbKeys.has(k));
          console.log(
            `micpal sync: ${missingFromDb.length} keyNames in file but NOT in table:`,
            missingFromDb,
          );
          // Check for ID_nmbr collisions among the missing keys
          const missingItems = items.filter((it) =>
            missingFromDb.includes(it[0]),
          );
          const missingIdNmbrs = missingItems.map((it) => ({
            keyName: it[0],
            name: it[2],
            family: it[3],
            ID_nmbr: it[4],
          }));
          console.log(
            `micpal sync: missing keyNames with their data:`,
            missingIdNmbrs,
          );
        }

        res.json({
          file: f.originalname,
          upserted,
          skipped,
          errors,
          scannedRows,
          payrollSoft,
          company,
        });
      } catch (err) {
        console.error("payroll/micpal/sync error:", err);
        res.status(500).json({ error: err.message || "micpal sync failed" });
      }
    });
  });

  router.post("/payrolls", async (req, res) => {
    try {
      const rest = String(req.body?.rest || "").trim();
      if (!rest) return res.status(400).json({ error: "missing rest" });
      const [rows] = await executeSql(
        `SELECT month, MAX(updated_at) AS updated_at
           FROM payroll
          WHERE rest = :rest
          GROUP BY month
          ORDER BY month DESC`,
        { rest },
      );
      const months = (rows || [])
        .map((r) => String(r.month || "").trim())
        .filter(Boolean);
      res.json({ months });
    } catch (err) {
      console.error("payroll/payrolls error:", err);
      res.status(500).json({ error: err.message || "payrolls list failed" });
    }
  });

  router.post("/payroll-load", async (req, res) => {
    try {
      const rest = String(req.body?.rest || "").trim();
      const month = String(req.body?.month || "").trim();
      if (!rest) return res.status(400).json({ error: "missing rest" });
      if (!/^\d{4}-\d{2}$/.test(month))
        return res.status(400).json({ error: "month must be YYYY-MM" });

      const [rows] = await executeSql(
        `SELECT p.employee_id, p.payroll_data,
                e.ID_nmbr, e.name
           FROM payroll p
           JOIN employees e ON e.employee_id = p.employee_id
          WHERE p.rest = :rest AND p.month = :month`,
        { rest, month },
      );

      const employees = (rows || []).map((r) => {
        let raw = r.payroll_data;
        if (typeof raw === "string") {
          try {
            raw = JSON.parse(raw);
          } catch {
            raw = {};
          }
        }
        const hasWrapper =
          raw && typeof raw === "object" && "payroll_data" in raw;
        const pd = hasWrapper ? raw.payroll_data || {} : raw || {};
        return {
          ID_nmbr: r.ID_nmbr,
          name: r.name,
          payroll_data: pd,
          role_extras: hasWrapper ? raw.role_extras || {} : {},
          workdays: hasWrapper ? (raw.workdays ?? null) : null,
          global: hasWrapper ? (raw.global ?? null) : null,
          netGross: hasWrapper ? (raw.netGross ?? null) : null,
          in_advance: hasWrapper ? (raw.in_advance ?? null) : null,
          work_dates:
            hasWrapper && Array.isArray(raw.work_dates) ? raw.work_dates : [],
          daily_breakdown:
            hasWrapper &&
            raw.daily_breakdown &&
            typeof raw.daily_breakdown === "object"
              ? raw.daily_breakdown
              : {},
          daily_hours:
            hasWrapper && raw.daily_hours && typeof raw.daily_hours === "object"
              ? raw.daily_hours
              : {},
        };
      });

      res.json({ rest, month, employees });
    } catch (err) {
      console.error("payroll/payroll-load error:", err);
      res.status(500).json({ error: err.message || "payroll load failed" });
    }
  });

  router.post("/payroll-data", async (req, res) => {
    try {
      const rest = String(req.body?.rest || "").trim();
      const month = String(req.body?.month || "").trim();
      const list = Array.isArray(req.body?.employees) ? req.body.employees : [];
      if (!rest) return res.status(400).json({ error: "missing rest" });
      if (!/^\d{4}-\d{2}$/.test(month))
        return res.status(400).json({ error: "month must be YYYY-MM" });
      if (list.length === 0)
        return res.status(400).json({ error: "No employees in request body" });

      let inserted = 0;
      const errors = [];
      const unresolved = [];
      for (const emp of list) {
        const employee_id = await resolveEmployeeId(rest, emp);
        if (!employee_id) {
          unresolved.push({
            name: emp.name,
            ID_nmbr: emp.ID_nmbr,
          });
          continue;
        }
        const wrapped = {
          payroll_data: emp.payroll_data || {},
          role_extras: emp.role_extras || {},
          workdays: emp.workdays ?? null,
          global: emp.global ?? null,
          netGross: emp.netGross ?? null,
          // מפרעה — manual/script-filled advance, persisted on the payroll row.
          in_advance: emp.in_advance ?? null,
          work_dates: Array.isArray(emp.work_dates) ? emp.work_dates : [],
          daily_breakdown:
            emp.daily_breakdown && typeof emp.daily_breakdown === "object"
              ? emp.daily_breakdown
              : {},
          daily_hours:
            emp.daily_hours && typeof emp.daily_hours === "object"
              ? emp.daily_hours
              : {},
        };
        const payrollJson = JSON.stringify(wrapped);
        try {
          await executeSql(
            `INSERT INTO payroll (rest, month, employee_id, payroll_data)
             VALUES (:rest, :month, :employee_id, CAST(:payroll AS JSON))
             ON DUPLICATE KEY UPDATE
               payroll_data = CAST(:payroll AS JSON)`,
            {
              rest,
              month,
              employee_id,
              payroll: payrollJson,
            },
          );
          inserted += 1;
        } catch (e) {
          errors.push({
            name: emp.name,
            employee_id,
            issue: e.message || "insert failed",
          });
        }
      }

      res.json({
        inserted,
        attempted: list.length,
        unresolved,
        errors,
        rest,
        month,
      });
    } catch (err) {
      console.error("payroll/payroll-data error:", err);
      res.status(500).json({ error: err.message || "save failed" });
    }
  });

  router.post("/labor-cost-summary", async (req, res) => {
    try {
      const rest = String(req.body?.rest || "").trim();
      const month = String(req.body?.month || "").trim();
      if (!rest) return res.status(400).json({ error: "missing rest" });
      if (!/^\d{4}-\d{2}$/.test(month))
        return res.status(400).json({ error: "month must be YYYY-MM" });

      const [rows] = await executeSql(
        `SELECT DATE(ts) AS date,
                SUM(COALESCE(total, 0))      AS total,
                MAX(labor_cost)              AS labor_cost
           FROM allegro.bcom_cash
          WHERE branchId = :rest
            AND DATE(ts) >= :start
            AND DATE(ts) <  :next
          GROUP BY DATE(ts)
          ORDER BY DATE(ts)`,
        {
          rest,
          start: `${month}-01`,
          next: (() => {
            const [y, m] = month.split("-").map((n) => parseInt(n, 10));
            const ny = m === 12 ? y + 1 : y;
            const nm = m === 12 ? 1 : m + 1;
            return `${ny}-${String(nm).padStart(2, "0")}-01`;
          })(),
        },
      );

      const items = (rows || []).map((r) => {
        const d =
          r.date instanceof Date
            ? r.date.toISOString().slice(0, 10)
            : String(r.date);
        const total = Number(r.total) || 0;
        const labor_cost = r.labor_cost == null ? null : Number(r.labor_cost);
        const percentage =
          labor_cost != null && total > 0
            ? Math.round((labor_cost / total) * 10000) / 100
            : null;
        return { date: d, total, labor_cost, percentage };
      });

      const totals = items.reduce(
        (acc, it) => {
          acc.total += it.total || 0;
          if (it.labor_cost != null) acc.labor_cost += it.labor_cost;
          return acc;
        },
        { total: 0, labor_cost: 0 },
      );
      totals.percentage =
        totals.total > 0
          ? Math.round((totals.labor_cost / totals.total) * 10000) / 100
          : null;

      res.json({ rest, month, items, totals });
    } catch (err) {
      console.error("payroll/labor-cost-summary error:", err);
      res
        .status(500)
        .json({ error: err.message || "labor cost summary failed" });
    }
  });

  router.post("/labor-cost", async (req, res) => {
    try {
      const rest = String(req.body?.rest || "").trim();
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      if (!rest) return res.status(400).json({ error: "missing rest" });
      console.log(`payroll/labor-cost: rest=${rest} items=${items.length}`);

      let updated = 0;
      const errors = [];
      for (const it of items) {
        const date = String(it?.date || "").trim();
        const cost = Number(it?.labor_cost);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          errors.push({ date, issue: "invalid date" });
          continue;
        }
        if (!Number.isFinite(cost)) {
          errors.push({ date, issue: "invalid labor_cost" });
          continue;
        }
        try {
          const [result] = await executeSql(
            `UPDATE allegro.bcom_cash
                SET labor_cost = :cost
              WHERE branchId = :rest
                AND DATE(ts) = :date`,
            { rest, date, cost },
          );
          updated += (result && result.affectedRows) || 0;
        } catch (e) {
          errors.push({ date, issue: e.message || "update failed" });
        }
      }
      res.json({ rest, updated, attempted: items.length, errors });
    } catch (err) {
      console.error("payroll/labor-cost error:", err);
      res.status(500).json({ error: err.message || "labor cost save failed" });
    }
  });

  router.post("/export-xlsx", async (req, res) => {
    try {
      const rest = String(req.body?.rest || "").trim();
      const month = String(req.body?.month || "").trim();
      const restLabel = String(req.body?.restLabel || rest);
      const list = Array.isArray(req.body?.employees) ? req.body.employees : [];
      if (list.length === 0) {
        return res.status(400).json({ error: "No employees in body" });
      }
      const flagged = new Set(
        (Array.isArray(req.body?.flaggedEmployees)
          ? req.body.flaggedEmployees
          : []
        )
          .map((s) => String(s || "").trim())
          .filter(Boolean),
      );
      const isFlagged = (emp) => flagged.has(String(emp.name || "").trim());

      const wb = new ExcelJS.Workbook();
      wb.creator = "allegro-payroll";
      wb.created = new Date();
      const ws = wb.addWorksheet("Payroll_Summary", {
        views: [{ state: "frozen", ySplit: 1, rightToLeft: true }],
      });
      ws.columns = [
        { header: "שם", key: "name", width: 22 },
        { header: "תפקיד", key: "role", width: 14 },
        { header: "שכר שעתי", key: "rate", width: 12 },
        { header: "ימי עבודה", key: "workdays", width: 10 },
        { header: "שעות 100%", key: "h100", width: 12 },
        { header: "שעות 125%", key: "h125", width: 12 },
        { header: "שעות 150%", key: "h150", width: 12 },
        { header: "נטו/ברוטו", key: "netGross", width: 12 },
        { header: "טיפ", key: "tip", width: 12 },
        { header: "השלמה", key: "completion", width: 12 },
        { header: "השלמה ידני", key: "manualCompletion", width: 12 },
        { header: "נסיעות", key: "travel", width: 12 },
        { header: "עובד גלובאלי", key: "global", width: 14 },
        { header: 'סה"כ', key: "total", width: 14 },
      ];
      ws.getRow(1).font = { bold: true };

      // Formula mirrors the frontend rule:
      //   • If tip (J) or completion (K) is present > 0, the row total IS
      //     tip + completion (they REPLACE the hourly calc).
      //   • Otherwise the row total is the hourly calc:
      //     (F + G*1.25 + H*1.5) * D
      // Manual completion (L) and travel (M) are displayed but never summed.
      const totalFormula = (r) =>
        `IFERROR(IF(OR(IFERROR(I${r},0)>0,IFERROR(J${r},0)>0),` +
        `IF(ISNUMBER(I${r}),I${r},0)+IF(ISNUMBER(J${r}),J${r},0),` +
        `(IF(ISNUMBER(E${r}),E${r},0)+IF(ISNUMBER(F${r}),F${r},0)*1.25+IF(ISNUMBER(G${r}),G${r},0)*1.5)*IF(ISNUMBER(C${r}),C${r},0)),0)`;

      const MIN_HOURLY_WAGE = Number(process.env.MIN_HOURLY_WAGE) || 35.4;
      const wageTypeLabel = (t) =>
        t === "gross" ? "ברוטו" : t === "net" ? "נטו" : "";
      const resolveWage = (emp, role) => {
        const wages = emp.wages || {};
        let w = wages[role];
        if (w == null) w = emp.hourly_wage;
        if (w == null) return null;
        if (Number(w) === -1) return MIN_HOURLY_WAGE;
        return Number(w);
      };

      let nextRow = 2;
      let grandTotal = 0;
      for (const emp of list) {
        const payroll = emp.payroll_data || {};
        const extras = emp.role_extras || {};
        const roleEntries = Object.entries(payroll);
        const globalAmount =
          emp.global_amount != null && Number(emp.global_amount) > 0
            ? Number(emp.global_amount)
            : null;
        const empWageType = emp.wage_type || null;
        const empTravel = emp.travel != null ? Number(emp.travel) : null;
        const empFlagged = isFlagged(emp);

        const roleRows = roleEntries.map(([role, payload]) => {
          const hours = (payload && payload.hours) || [];
          const wage = resolveWage(emp, role);
          const tip = Number((payload && payload.tip) || 0);
          const completion = Number((payload && payload.completion) || 0);
          const h100 = Number(hours[0] || 0);
          const h125 = Number(hours[1] || 0);
          const h150 = Number(hours[2] || 0);

          const hasTipOrCompletion = tip !== 0 || completion !== 0;
          let computed = null;
          let missing = false;
          if (globalAmount != null) {
            computed = null; // global handled at employee level
          } else if (hasTipOrCompletion) {
            // tip + completion REPLACE the hourly calc.
            computed = tip + completion;
          } else if (wage == null) {
            computed = null;
            missing = true;
          } else {
            computed = (h100 + h125 * 1.25 + h150 * 1.5) * wage;
          }

          return {
            role,
            h100: h100 || null,
            h125: h125 || null,
            h150: h150 || null,
            wage,
            tip: tip || null,
            completion: completion || null,
            manualCompletion:
              Number((extras[role] && extras[role].manualCompletion) || 0) ||
              null,
            travel: Number((extras[role] && extras[role].travel) || 0) || null,
            computedTotal: computed,
            missing,
          };
        });

        if (globalAmount != null && roleRows.length > 0) {
          roleRows[0].computedTotal = globalAmount;
        }

        const blockRows = [...roleRows];
        if (roleRows.length > 1 && globalAmount == null) {
          const sum = (k) =>
            roleRows.reduce((s, r) => s + (Number(r[k]) || 0), 0) || null;
          blockRows.push({
            role: 'סה"כ',
            h100: sum("h100"),
            h125: sum("h125"),
            h150: sum("h150"),
            wage: null,
            tip: sum("tip"),
            completion: sum("completion"),
            manualCompletion: sum("manualCompletion"),
            travel: sum("travel"),
            computedTotal: roleRows.reduce(
              (s, r) => s + (Number(r.computedTotal) || 0),
              0,
            ),
            isTotal: true,
          });
        }

        if (blockRows.length === 0) {
          blockRows.push({
            role: "",
            h100: null,
            h125: null,
            h150: null,
            wage: null,
            tip: null,
            completion: null,
            manualCompletion: null,
            travel: null,
            computedTotal: globalAmount,
          });
        }

        blockRows.forEach((r, idx) => {
          const rowNum = nextRow++;
          const isFirst = idx === 0;

          // Total cell strategy:
          //   • global salary or missing wage → fixed numeric (or blank)
          //   • normal row → live formula (so editing wage/hours updates total)
          //   • per-employee total row → fixed numeric (sum of role totals)
          let totalCell;
          if (r.isTotal) {
            totalCell = r.computedTotal;
          } else if (globalAmount != null) {
            totalCell = isFirst ? globalAmount : null;
          } else if (r.missing) {
            totalCell = null;
          } else {
            totalCell = { formula: totalFormula(rowNum) };
          }

          const added = ws.addRow({
            name: isFirst ? emp.name || "" : "",
            role: r.role || "",
            rate: r.wage,
            workdays: isFirst ? (emp.workdays ?? null) : null,
            h100: r.h100,
            h125: r.h125,
            h150: r.h150,
            netGross: isFirst ? wageTypeLabel(empWageType) : "",
            tip: r.tip,
            completion: r.completion,
            manualCompletion: r.manualCompletion,
            travel: isFirst && empTravel != null ? empTravel : r.travel,
            global: isFirst && emp.global ? "כן" : "",
            total: totalCell,
          });

          if (r.isTotal) {
            added.font = { bold: true };
            added.eachCell((cell) => {
              cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FFE6E6E6" },
              };
            });
          }
          if (r.missing) {
            // Light yellow to flag rows with missing wage and no global.
            added.eachCell((cell) => {
              cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FFFFF3CD" },
              };
            });
          }
          if (empFlagged) {
            added.eachCell((cell) => {
              cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FFFFCDD2" },
              };
            });
          }

          // Accumulate grand total from per-role rows only (avoids double
          // counting the per-employee subtotal row).
          if (!r.isTotal && typeof r.computedTotal === "number") {
            grandTotal += r.computedTotal;
          }
        });
      }

      // Final grand-total row.
      const grandRowNum = nextRow++;
      const grandRow = ws.addRow({
        name: 'סה"כ כללי',
        total: grandTotal,
      });
      grandRow.font = { bold: true, size: 12 };
      grandRow.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFD0E8FF" },
        };
      });
      ws.mergeCells(`A${grandRowNum}:N${grandRowNum}`);

      ws.getColumn("E").numFmt = "0";
      ["F", "G", "H"].forEach((c) => (ws.getColumn(c).numFmt = "0.00"));
      ["D", "J", "K", "L", "M", "O"].forEach(
        (c) => (ws.getColumn(c).numFmt = "#,##0.00"),
      );

      const buf = await wb.xlsx.writeBuffer();
      const safeRest = restLabel.replace(/[^\w֐-׿.-]+/g, "_");
      const filename = `payroll_summary_${safeRest || rest || "rest"}_${month || "month"}.xlsx`;
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(filename)}"`,
      );
      res.send(Buffer.from(buf));
    } catch (err) {
      console.error("payroll/export-xlsx error:", err);
      res.status(500).json({ error: err.message || "export failed" });
    }
  });

  router.post("/export-micpal", async (req, res) => {
    try {
      const rest = String(req.body?.rest || "").trim();
      const month = String(req.body?.month || "").trim();
      // A2 in the Micpal xlsx is the mic_company code, looked up by branch id
      // from shared/restaurants.json. Falls back to the optional body field.
      const company =
        micCompanyForBranch(rest) || String(req.body?.company || "").trim();
      const restLabel = String(req.body?.restLabel || rest);
      // Standard working days/hours for this branch+month from
      // shared/restaurants.json. תקן שעות = 8 × תקן ימים.
      const stdDays = workingDaysFor(month);
      const stdHours = workingHoursFor(month);
      const list = Array.isArray(req.body?.employees) ? req.body.employees : [];
      if (list.length === 0) {
        return res.status(400).json({ error: "No employees in body" });
      }

      // Load employee records from DB (ID_nmbr, travel, maxTravel, per-role
      // wages, contractor flag)
      const [empRows] = await executeSql(
        "SELECT name, ID_nmbr, travel, maxTravel, hourly_wage, wage_type, new_wage_type, wage, roles, contractor FROM employees WHERE rest = :rest AND active = 1 AND duplicate IS NULL",
        { rest },
      );
      const empByName = new Map();
      for (const e of empRows || []) {
        if (!e.name) continue;
        // Parse + normalize the per-role wages into a { role: { new_wage_type,
        // wage } } map so buildExportRow can resolve each role's own rate.
        let roles = [];
        if (e.roles) {
          try {
            roles = typeof e.roles === "string" ? JSON.parse(e.roles) : e.roles;
          } catch {
            roles = [];
          }
        }
        const rolesByName = {};
        for (const r of normalizeRoles(roles)) {
          if (r && r.role) rolesByName[String(r.role).trim()] = r;
        }
        e.rolesByName = rolesByName;
        empByName.set(String(e.name).trim(), e);
      }

      // Load micpal keyName mapping by ID_nmbr
      const [micpalRows] = await executeSql(
        "SELECT keyName, ID_nmbr FROM payroll_soft_ix WHERE ID_nmbr IS NOT NULL",
        {},
      );
      const micpalByIdNmbr = new Map();
      for (const m of micpalRows || []) {
        if (m.ID_nmbr) micpalByIdNmbr.set(String(m.ID_nmbr).trim(), m.keyName);
      }

      const [y, m] = month.split("-");
      const monthInt = m ? String(Number(m)) : "";
      const ctx = {
        empByName,
        micpalByIdNmbr,
        stdDays,
        stdHours,
        minHourlyWage: Number(process.env.MIN_HOURLY_WAGE) || 35.4,
      };
      const employees = list.map((emp) => buildExportRow(emp, ctx));

      // Split: קבלן (contractor) employees are skipped entirely; rows missing a
      // payroll-soft employee number (מס עובד) are reported back to the UI
      // instead of being written to the xlsx.
      const exportable = [];
      const missing = [];
      const skippedContractors = [];
      for (const row of employees) {
        if (row.contractor) {
          skippedContractors.push({
            name: row.name || "",
            ID_nmbr: row.ID_nmbr || "",
          });
        } else if (!row.keyName) {
          missing.push({ name: row.name || "", ID_nmbr: row.ID_nmbr || "" });
        } else {
          exportable.push(row);
        }
      }

      // Dispatch by the restaurant's payroll software.
      const payrollSoft = payrollSoftForBranch(rest) || "mic";
      const safeRest = restLabel.replace(/[^\w֐-׿.-]+/g, "_");
      let buf;
      let filename;
      if (payrollSoft === "shik") {
        const shikRows = exportable.map((r) => ({
          ...r,
          employeeNumber: Number(r.keyName),
        }));
        const xl = new ShikImportXL({ year: y || "", month: monthInt });
        buf = await xl.generate(shikRows);
        filename = `siklulit_import_${safeRest}_${month || "month"}.xlsx`;
      } else {
        const xl = new MicpImportXL({
          company,
          year: y || "",
          month: monthInt,
        });
        buf = await xl.generate(exportable);
        filename = `micpal_import_${safeRest}_${month || "month"}.xlsx`;
      }
      res.json({
        filename,
        xlsxBase64: Buffer.from(buf).toString("base64"),
        payrollSoft,
        missing,
        skippedContractors,
        exported: exportable.length,
      });
    } catch (err) {
      console.error("payroll/export-micpal error:", err);
      res.status(500).json({ error: err.message || "micpal export failed" });
    }
  });

  return router;
};

export { Router };
