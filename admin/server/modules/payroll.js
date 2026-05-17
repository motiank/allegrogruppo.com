import express from "express";
import multer from "multer";
import { createRequire } from "module";
import { executeSql } from "../sources/dbpool.js";

const require = createRequire(import.meta.url);
const {
  extractEmployees,
} = require("../../../payroll-summary/payroll_summary.js");
const ExcelJS = require("exceljs");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 50,
  },
});

const parseUpload = upload.array("files");

const matchKey = (e) => {
  if (e.mic_nmbr) return `mic:${String(e.mic_nmbr).trim()}`;
  if (e.ID_nmbr) return `id:${String(e.ID_nmbr).trim()}`;
  return `name:${String(e.name || "").trim()}`;
};

async function fetchExistingKeys(rest) {
  if (!rest) return new Set();
  const [rows] = await executeSql(
    "SELECT mic_nmbr, ID_nmbr, name FROM employees WHERE rest = :rest",
    { rest },
  );
  const set = new Set();
  for (const r of rows || []) {
    set.add(
      matchKey({ mic_nmbr: r.mic_nmbr, ID_nmbr: r.ID_nmbr, name: r.name }),
    );
  }
  return set;
}

async function resolveEmployeeId(rest, emp) {
  if (emp.mic_nmbr) {
    const [rows] = await executeSql(
      "SELECT employee_id FROM employees WHERE rest = :rest AND mic_nmbr = :mic LIMIT 1",
      { rest, mic: String(emp.mic_nmbr).trim() },
    );
    if (rows && rows[0]) return rows[0].employee_id;
  }
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
        const newOnly = employees.filter((e) => !existingKeys.has(matchKey(e)));

        const newRows = newOnly.map((e) => ({
          rest,
          mic_nmbr: e.mic_nmbr,
          name: e.name,
          ID_nmbr: e.ID_nmbr,
          roles: e.roles,
          payroll_data: e.payroll_data,
        }));

        const allRows = employees.map((e) => ({
          rest,
          mic_nmbr: e.mic_nmbr,
          name: e.name,
          ID_nmbr: e.ID_nmbr,
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
      const errors = [];
      for (const emp of list) {
        const rest = (emp.rest || "").trim();
        const name = (emp.name || "").trim();
        if (!rest || !name) {
          errors.push({ name, issue: "missing rest or name" });
          continue;
        }
        const rolesJson = JSON.stringify(
          Array.isArray(emp.roles)
            ? emp.roles
                .filter((r) => r && r.role)
                .map((r) => ({
                  role: String(r.role).trim(),
                  wage: r.wage === "" || r.wage == null ? null : Number(r.wage),
                }))
            : [],
        );
        const globalVal =
          emp.global === "" || emp.global == null ? null : Number(emp.global);
        const hourlyWageVal =
          emp.hourly_wage === "" || emp.hourly_wage == null
            ? null
            : Number(emp.hourly_wage);
        const wageType =
          emp.wage_type === "gross" || emp.wage_type === "net"
            ? emp.wage_type
            : null;
        const travelVal =
          emp.travel === "" || emp.travel == null ? null : Number(emp.travel);
        try {
          await executeSql(
            `INSERT INTO employees (rest, mic_nmbr, name, ID_nmbr, roles, t101, \`global\`, hourly_wage, wage_type, travel, contractor)
             VALUES (:rest, :mic_nmbr, :name, :ID_nmbr, CAST(:roles AS JSON), :t101, :gbl, :hw, :wt, :tr, :ctr)`,
            {
              rest,
              mic_nmbr: emp.mic_nmbr || null,
              name,
              ID_nmbr: emp.ID_nmbr || null,
              roles: rolesJson,
              t101: emp.t101 ? 1 : 0,
              gbl: globalVal,
              hw: hourlyWageVal,
              wt: wageType,
              tr: travelVal,
              ctr: emp.contractor ? 1 : 0,
            },
          );
          inserted += 1;
        } catch (e) {
          errors.push({ name, issue: e.message || "insert failed" });
        }
      }

      res.json({ inserted, attempted: list.length, errors });
    } catch (err) {
      console.error("payroll/employees error:", err);
      res.status(500).json({ error: err.message || "save failed" });
    }
  });

  router.post("/wages", async (req, res) => {
    try {
      const rest = String(req.body?.rest || "").trim();
      if (!rest) return res.status(400).json({ error: "missing rest" });
      const [rows] = await executeSql(
        "SELECT employee_id, mic_nmbr, ID_nmbr, name, roles, `global`, hourly_wage, wage_type, travel, contractor FROM employees WHERE rest = :rest",
        { rest },
      );
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
        out.push({
          employee_id: r.employee_id,
          mic_nmbr: r.mic_nmbr,
          ID_nmbr: r.ID_nmbr,
          name: r.name,
          roles: Array.isArray(roles) ? roles : [],
          global: r.global == null ? null : Number(r.global),
          hourly_wage: r.hourly_wage == null ? null : Number(r.hourly_wage),
          wage_type: r.wage_type || null,
          travel: r.travel == null ? null : Number(r.travel),
          contractor: !!r.contractor,
        });
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
        const rolesJson = JSON.stringify(
          Array.isArray(emp.roles)
            ? emp.roles
                .filter((r) => r && r.role)
                .map((r) => ({
                  role: String(r.role).trim(),
                  wage: r.wage === "" || r.wage == null ? null : Number(r.wage),
                }))
            : [],
        );
        const globalVal =
          emp.global === "" || emp.global == null ? null : Number(emp.global);
        const hourlyWageVal =
          emp.hourly_wage === "" || emp.hourly_wage == null
            ? null
            : Number(emp.hourly_wage);
        const wageType =
          emp.wage_type === "gross" || emp.wage_type === "net"
            ? emp.wage_type
            : null;
        const travelVal =
          emp.travel === "" || emp.travel == null ? null : Number(emp.travel);
        try {
          const [result] = await executeSql(
            `UPDATE employees
             SET roles = CAST(:roles AS JSON),
                 \`global\` = :gbl,
                 hourly_wage = :hw,
                 wage_type = :wt,
                 travel = :tr,
                 contractor = :ctr
             WHERE employee_id = :id`,
            {
              id,
              roles: rolesJson,
              gbl: globalVal,
              hw: hourlyWageVal,
              wt: wageType,
              tr: travelVal,
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
                e.mic_nmbr, e.ID_nmbr, e.name
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
          mic_nmbr: r.mic_nmbr,
          ID_nmbr: r.ID_nmbr,
          name: r.name,
          payroll_data: pd,
          role_extras: hasWrapper ? raw.role_extras || {} : {},
          workdays: hasWrapper ? (raw.workdays ?? null) : null,
          global: hasWrapper ? (raw.global ?? null) : null,
          netGross: hasWrapper ? (raw.netGross ?? null) : null,
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
            mic_nmbr: emp.mic_nmbr,
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
      const isFlagged = (emp) =>
        flagged.has(String(emp.name || "").trim()) ||
        (emp.mic_nmbr && flagged.has(String(emp.mic_nmbr).trim()));

      const wb = new ExcelJS.Workbook();
      wb.creator = "allegro-payroll";
      wb.created = new Date();
      const ws = wb.addWorksheet("Payroll_Summary", {
        views: [{ state: "frozen", ySplit: 1, rightToLeft: true }],
      });
      ws.columns = [
        { header: "שם", key: "name", width: 22 },
        { header: "מספר עובד", key: "mic", width: 12 },
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
        `IFERROR(IF(OR(IFERROR(J${r},0)>0,IFERROR(K${r},0)>0),` +
        `IF(ISNUMBER(J${r}),J${r},0)+IF(ISNUMBER(K${r}),K${r},0),` +
        `(IF(ISNUMBER(F${r}),F${r},0)+IF(ISNUMBER(G${r}),G${r},0)*1.25+IF(ISNUMBER(H${r}),H${r},0)*1.5)*IF(ISNUMBER(D${r}),D${r},0)),0)`;

      const MIN_HOURLY_WAGE = 34.42;
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
            mic: isFirst ? emp.mic_nmbr || "" : "",
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

  return router;
};

export { Router };
