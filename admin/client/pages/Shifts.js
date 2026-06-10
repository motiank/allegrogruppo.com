import React, {
  useState,
  useMemo,
  useRef,
  useCallback,
  useEffect,
} from "react";
import axios from "axios";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import { useTheme } from "../context/ThemeContext";
import {
  RESTAURANT_GROUPS,
  filterRestaurantGroups,
} from "../constants/restaurants";
import useCurrentUser from "../hooks/useCurrentUser";
import WageDialog from "../components/WageDialog";
import EmployeeWageTable from "../components/EmployeeWageTable";
import {
  normalizeRoleWage,
  effectiveHourlyRate,
} from "../../../shared/wage.js";

const STEPS = [
  { id: 1, label: "Select restaurant" },
  { id: 2, label: "Add shift files" },
  { id: 3, label: "Employee data" },
  { id: 4, label: "New employees" },
  { id: 5, label: "Full payroll" },
];

const formatBytes = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

const fmtNum = (n, decimals = 2) => {
  if (n == null || n === "") return "";
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return v.toFixed(decimals).replace(/\.?0+$/, "") || "0";
};

// National minimum hourly wage — used as a substitute when an employee's
// configured hourly wage is the special marker -1.
const MIN_HOURLY_WAGE = Number(import.meta.env.VITE_MIN_HOURLY_WAGE) || 35.4;

// Total break hours for an employee: 0.5h for each day whose total paid hours
// (h100+h125+h150) exceed 7. Prefers the server-computed `emp.breaks`; falls
// back to recomputing from the persisted daily_breakdown (e.g. payroll loaded
// from DB). Mirrors the deduction in payroll_summary.js extractEmployees().
const computeBreaks = (emp) => {
  if (emp && typeof emp.breaks === "number") return emp.breaks;
  const bd = emp && emp.daily_breakdown;
  if (!bd || typeof bd !== "object") return 0;
  let total = 0;
  for (const entries of Object.values(bd)) {
    let dayTotal = 0;
    for (const e of entries || []) {
      dayTotal +=
        (Number(e.h100) || 0) + (Number(e.h125) || 0) + (Number(e.h150) || 0);
    }
    if (dayTotal > 7) total += 0.5;
  }
  return total;
};

// Per-role break hours for an employee: same 0.5h/day rule, but attributed to
// the role with the most hours that day (the employee works one role per day,
// so this is exact). Returns a Map<role, hours>. Mirrors the breakByRole
// attribution in payroll_summary.js extractEmployees().
const computeBreaksByRole = (emp) => {
  const map = new Map();
  const bd = emp && emp.daily_breakdown;
  if (!bd || typeof bd !== "object") return map;
  for (const entries of Object.values(bd)) {
    let dayTotal = 0;
    const dayRoleHours = new Map();
    for (const e of entries || []) {
      const h =
        (Number(e.h100) || 0) + (Number(e.h125) || 0) + (Number(e.h150) || 0);
      dayTotal += h;
      if (e.role) dayRoleHours.set(e.role, (dayRoleHours.get(e.role) || 0) + h);
    }
    if (dayTotal <= 7) continue;
    let topRole = null;
    let topHours = -1;
    for (const [role, h] of dayRoleHours) {
      if (h > topHours) {
        topHours = h;
        topRole = role;
      }
    }
    if (topRole != null) map.set(topRole, (map.get(topRole) || 0) + 0.5);
  }
  return map;
};

// Build a per-employee record map keyed by ID_nmbr / name.
// Each entry: { roles: { role: { new_wage_type, wage } }, hourly_wage, ... }
const buildWageMap = (employeesFromDb) => {
  const map = new Map();
  for (const e of employeesFromDb || []) {
    const roleWage = {};
    for (const r of e.roles || []) {
      // Store the compound { new_wage_type, wage } per role (normalizing any
      // legacy bare number) so the calc can apply per-role wage-type rules.
      if (r && r.role) roleWage[r.role] = normalizeRoleWage(r);
    }
    const rec = {
      roles: roleWage,
      empNumber: e.empNumber == null ? null : e.empNumber,
      // Employee-level compound wage — used as the fallback when a role has no
      // wage type of its own (e.g. a min-wage employee with untyped roles).
      new_wage_type: e.new_wage_type || null,
      wage: e.wage == null || e.wage === "" ? null : Number(e.wage),
      hourly_wage: e.hourly_wage == null ? null : Number(e.hourly_wage),
      wage_type: e.wage_type || null,
      global: e.global == null ? null : Number(e.global),
      travel: e.travel == null ? null : Number(e.travel),
      maxTravel: e.maxTravel == null ? null : Number(e.maxTravel),
      contractor: !!e.contractor,
    };
    if (e.ID_nmbr) map.set(`id:${String(e.ID_nmbr).trim()}`, rec);
    if (e.name) map.set(`name:${String(e.name).trim()}`, rec);
  }
  return map;
};

const lookupEmpData = (wageMap, emp) => {
  const candidates = [];
  if (emp.ID_nmbr) candidates.push(`id:${String(emp.ID_nmbr).trim()}`);
  if (emp.name) candidates.push(`name:${String(emp.name).trim()}`);
  for (const k of candidates) {
    if (wageMap.has(k)) return wageMap.get(k);
  }
  return null;
};

// Normalize a roles value into a list of trimmed role-name strings. Extracted
// employees carry roles as plain strings (allEmployees) or as { role, wage }
// objects (newEmployees / DB), so accept both shapes.
const roleNamesOf = (roles) =>
  (Array.isArray(roles) ? roles : [])
    .map((r) => (typeof r === "string" ? r : r && r.role))
    .map((s) => String(s == null ? "" : s).trim())
    .filter(Boolean);

// Reduce a name to its base identity for matching: drop a leading "*" marker
// and any trailing " - <role/branch>" suffix that the Tabit detailed-report
// format bakes into the employee name (e.g. "אסף מזרחי - מלצר/ברמן" → "אסף מזרחי").
// A dash only counts as a separator when it has whitespace on at least one
// side, so genuinely hyphenated names (e.g. "בר-כוכבא") are left intact.
const baseName = (s) => {
  let t = String(s == null ? "" : s)
    .replace(/^\*+\s*/, "")
    .trim();
  const m = t.match(/\s+-\s*|\s*-\s+/);
  if (m) t = t.slice(0, m.index);
  return t.trim();
};

// Merge role names seen in the shift files into an employee's existing DB roles.
// Existing roles (their wage type AND amount) are preserved verbatim; only roles
// that are new to this employee are appended, with no wage so nothing is
// overwritten. Returns { roles: [{ role, new_wage_type, wage }], added, changed }.
const mergeRoles = (dbRoles, shiftRoleNames) => {
  const merged = [];
  const seen = new Set();
  for (const r of dbRoles || []) {
    const name = r && r.role ? String(r.role).trim() : "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    // Keep the stored wage type + amount exactly as-is — untouched.
    merged.push({
      role: name,
      new_wage_type: r.new_wage_type ?? null,
      wage: r.wage ?? null,
    });
  }
  const added = [];
  for (const name of shiftRoleNames) {
    if (seen.has(name)) continue;
    seen.add(name);
    merged.push({ role: name, new_wage_type: null, wage: null });
    added.push(name);
  }
  return { roles: merged, added, changed: added.length > 0 };
};

// Wage resolution per spec:
//   1. role-level compound wage from employees.roles JSON — its new_wage_type
//      drives the rate (hourly_min → minimum, hourly_net → reduced rate, …)
//   2. fallback: employees.hourly_wage (legacy column, -1 → minimum)
const resolveHourlyWage = (empData, role) => {
  const roleEntry = empData?.roles?.[role];
  if (roleEntry) {
    const rate = effectiveHourlyRate(roleEntry, {
      minHourlyWage: MIN_HOURLY_WAGE,
    });
    if (rate != null) return rate;
  }
  const wage = empData?.hourly_wage;
  if (wage == null) return null;
  if (Number(wage) === -1) return MIN_HOURLY_WAGE;
  return Number(wage);
};

// Hebrew label for wage_type ENUM
const wageTypeLabel = (t) =>
  t === "gross" ? "ברוטו" : t === "net" ? "נטו" : "";

const Shifts = () => {
  const { theme } = useTheme();
  const { user } = useCurrentUser();
  const allowedRestaurants = useMemo(
    () => (Array.isArray(user?.restaurants) ? user.restaurants : null),
    [user],
  );
  const availableGroups = useMemo(
    () => filterRestaurantGroups(allowedRestaurants),
    [allowedRestaurants],
  );
  const flatAvailable = useMemo(
    () => availableGroups.flatMap((g) => g.items),
    [availableGroups],
  );
  const [step, setStep] = useState(1);

  // Step 1
  const [selectedRestaurant, setSelectedRestaurant] = useState("");

  useEffect(() => {
    if (
      allowedRestaurants &&
      allowedRestaurants.length > 0 &&
      flatAvailable.length === 1 &&
      !selectedRestaurant
    ) {
      setSelectedRestaurant(flatAvailable[0].value);
    }
  }, [allowedRestaurants, flatAvailable, selectedRestaurant]);

  // Step 1 — past-payroll selection
  const [payrollOptions, setPayrollOptions] = useState([]);
  const [loadingPayrolls, setLoadingPayrolls] = useState(false);
  const [selectedPayroll, setSelectedPayroll] = useState("new");
  const [loadingExistingPayroll, setLoadingExistingPayroll] = useState(false);
  const [loadPayrollError, setLoadPayrollError] = useState(null);

  // True only when the current allEmployees came from a fresh xlsx
  // upload (runExtract). Used to gate the daily labor cost calculation
  // so a payroll-load doesn't trigger it.
  const [freshExtract, setFreshExtract] = useState(false);

  // Labor-cost summary dialog (shown after a successful save).
  const [showLaborDialog, setShowLaborDialog] = useState(false);
  const [laborSummary, setLaborSummary] = useState(null);
  const [loadingLaborSummary, setLoadingLaborSummary] = useState(false);
  const [laborSummaryError, setLaborSummaryError] = useState(null);

  // Step 2
  const [files, setFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);
  const fileKeyRef = useRef(0);

  // Step 2 → 3 (extract)
  const [processing, setProcessing] = useState(false);
  const [extractError, setExtractError] = useState(null);

  // Step 3 — Employee data upload (attach phones); supports multiple .xlsx
  // files dropped/selected at once. Each file is posted independently to the
  // attach-phones endpoint and the results are aggregated.
  const empDataFileRef = useRef(null);
  const empDataKeyRef = useRef(0);
  const payrollWrapRef = useRef(null);
  const [empDataFiles, setEmpDataFiles] = useState([]);
  const [empDataIsDragging, setEmpDataIsDragging] = useState(false);
  const [empDataUploading, setEmpDataUploading] = useState(false);
  const [empDataResults, setEmpDataResults] = useState([]); // one per file
  const [empDataError, setEmpDataError] = useState(null);

  const addEmpDataFiles = useCallback((incoming) => {
    if (!incoming || incoming.length === 0) return;
    const next = Array.from(incoming)
      .filter((f) => /\.xlsx$/i.test(f.name))
      .map((file) => ({ key: ++empDataKeyRef.current, file }));
    if (next.length === 0) return;
    setEmpDataFiles((prev) => [...prev, ...next]);
    setEmpDataResults([]);
    setEmpDataError(null);
  }, []);
  const handleEmpDataFileInput = (e) => {
    addEmpDataFiles(e.target.files);
    e.target.value = "";
  };
  const handleEmpDataDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setEmpDataIsDragging(false);
    addEmpDataFiles(e.dataTransfer.files);
  };
  const handleEmpDataDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!empDataIsDragging) setEmpDataIsDragging(true);
  };
  const handleEmpDataDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (empDataIsDragging) setEmpDataIsDragging(false);
  };
  const removeEmpDataFile = (key) => {
    setEmpDataFiles((prev) => prev.filter((f) => f.key !== key));
  };

  useEffect(() => {
    if (empDataFiles.length > 0 && !empDataUploading && selectedRestaurant) {
      runEmpDataAttach();
    }
  }, [empDataFiles]);

  const runEmpDataAttach = async () => {
    if (empDataUploading) return;
    if (!selectedRestaurant) {
      setEmpDataError("No restaurant selected");
      return;
    }
    if (empDataFiles.length === 0) return;
    setEmpDataUploading(true);
    setEmpDataError(null);
    setEmpDataResults([]);

    const fileResults = [];
    const phoneByName = new Map();
    try {
      for (const { file } of empDataFiles) {
        const fd = new FormData();
        fd.append("file", file, file.name);
        try {
          const res = await axios.post(
            "/admin/payroll/employees/parse-phone-xlsx",
            fd,
            { withCredentials: true },
          );
          const entries = res.data?.entries || [];
          let kept = 0;
          let dropped = 0;
          for (const e of entries) {
            if (!e.active) {
              dropped += 1;
              continue;
            }
            if (!e.phone) {
              dropped += 1;
              continue;
            }
            const first = (e.name || "").trim();
            const fam = (e.family || "").trim();
            const full = `${first} ${fam}`.trim();
            if (!full) {
              dropped += 1;
              continue;
            }
            phoneByName.set(full, e.phone);
            if (first && fam) phoneByName.set(`${fam} ${first}`, e.phone);
            kept += 1;
          }
          fileResults.push({
            file: file.name,
            parsed: entries.length,
            kept,
            dropped,
            headerRow: res.data?.headerRow,
          });
        } catch (err) {
          fileResults.push({
            file: file.name,
            error: err.response?.data?.error || err.message || "Parse failed",
          });
        }
      }

      const phoneFor = (name) => {
        const n = (name || "").trim();
        return phoneByName.get(n) || null;
      };

      let matchedNew = 0;
      let matchedExisting = 0;
      const unmatchedNew = [];
      const unmatchedExisting = [];

      const nextNewEmployees = newEmployees.map((e) => {
        const p = phoneFor(e.name);
        if (p) {
          matchedNew += 1;
          return { ...e, phone: p };
        }
        unmatchedNew.push(e.name || "(no name)");
        return e;
      });
      const nextAllEmployees = allEmployees.map((e) => {
        const p = phoneFor(e.name);
        if (p) {
          matchedExisting += 1;
          return { ...e, phone: p };
        }
        unmatchedExisting.push(e.name || "(no name)");
        return e;
      });

      setNewEmployees(nextNewEmployees);
      setAllEmployees(nextAllEmployees);
      setDiffSummary(null);
      setDiffSummary(null);

      // Also persist phones to DB directly for existing employees.
      let dbUpdated = 0;
      for (const { file } of empDataFiles) {
        try {
          const fd2 = new FormData();
          fd2.append("rest", selectedRestaurant);
          fd2.append("file", file, file.name);
          const r2 = await axios.post(
            "/admin/payroll/employees/attach-phones",
            fd2,
            { withCredentials: true },
          );
          dbUpdated += r2.data?.updated || 0;
        } catch (_) {}
      }

      setEmpDataResults([
        ...fileResults,
        {
          file: "__summary__",
          summary: true,
          matchedNew,
          matchedExisting,
          unmatchedNew,
          unmatchedExisting,
          dbUpdated,
        },
      ]);
    } finally {
      setEmpDataUploading(false);
    }
  };

  // Step 3
  const [newEmployees, setNewEmployees] = useState([]); // with {role,wage} forms
  const [allEmployees, setAllEmployees] = useState([]);
  const [month, setMonth] = useState("");
  const [exceptions, setExceptions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);
  const [saveError, setSaveError] = useState(null);

  // Step 4
  const [loadingWages, setLoadingWages] = useState(false);
  const [wageMap, setWageMap] = useState(new Map());
  const [savingPayroll, setSavingPayroll] = useState(false);
  const [payrollResult, setPayrollResult] = useState(null);
  const [payrollError, setPayrollError] = useState(null);
  const [downloadingXlsx, setDownloadingXlsx] = useState(false);
  const [downloadError, setDownloadError] = useState(null);
  // After a Micpal XL download: employees that were skipped because no
  // Micpal keyName (מס עובד) was found for them.
  const [micpalMissing, setMicpalMissing] = useState(null);
  // Employees marked קבלן (contractor) — skipped in the export, shown for info.
  const [skippedContractors, setSkippedContractors] = useState(null);
  const [warningsExpanded, setWarningsExpanded] = useState(false);

  // Shift validation
  const [shiftIssues, setShiftIssues] = useState([]);
  const [shiftIssuesAcknowledged, setShiftIssuesAcknowledged] = useState(false);

  const selectedLabel = useMemo(() => {
    for (const group of RESTAURANT_GROUPS) {
      const m = group.items.find((i) => i.value === selectedRestaurant);
      if (m) return `${group.label} — ${m.label}`;
    }
    return "";
  }, [selectedRestaurant]);

  const employeesAllSaved =
    saveResult != null &&
    (saveResult.inserted || 0) + (saveResult.updated || 0) ===
      saveResult.attempted;

  const noNewEmployees = newEmployees && newEmployees.length === 0;

  const flaggedNames = useMemo(() => {
    const s = new Set();
    for (const i of shiftIssues || []) {
      if (i.employee) s.add(i.employee);
    }
    return s;
  }, [shiftIssues]);
  const isEmpFlagged = (emp) => flaggedNames.has(emp.name);

  // ---------- Load list of stored payrolls for this restaurant ----------
  useEffect(() => {
    if (!selectedRestaurant) {
      setPayrollOptions([]);
      setSelectedPayroll("new");
      return;
    }
    let cancelled = false;
    setLoadingPayrolls(true);
    setLoadPayrollError(null);
    axios
      .post(
        "/admin/payroll/payrolls",
        { rest: selectedRestaurant },
        { withCredentials: true },
      )
      .then((res) => {
        if (cancelled) return;
        setPayrollOptions(
          Array.isArray(res.data?.months) ? res.data.months : [],
        );
        setSelectedPayroll("new");
      })
      .catch(() => {
        if (cancelled) return;
        setPayrollOptions([]);
        setSelectedPayroll("new");
      })
      .finally(() => {
        if (!cancelled) setLoadingPayrolls(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRestaurant]);

  // ---------- Reset helpers ----------
  const resetFromStep2 = () => {
    setFreshExtract(false);
    setNewEmployees([]);
    setAllEmployees([]);
    setMonth("");
    setExceptions([]);
    setSaveResult(null);
    setSaveError(null);
    setDiffSummary(null);
    setExtractError(null);
    setWageMap(new Map());
    setPayrollResult(null);
    setPayrollError(null);
    setShiftIssues([]);
    setShiftIssuesAcknowledged(false);
  };

  // ---------- Step 2 file handling ----------
  const addFiles = useCallback((incoming) => {
    if (!incoming || incoming.length === 0) return;
    const next = Array.from(incoming).map((file) => ({
      key: ++fileKeyRef.current,
      file,
    }));
    setFiles((prev) => [...prev, ...next]);
    resetFromStep2();
  }, []);

  const handleFileInput = (e) => {
    addFiles(e.target.files);
    e.target.value = "";
  };
  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    addFiles(e.dataTransfer.files);
  };
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };
  const removeFile = (key) => {
    setFiles((prev) => prev.filter((f) => f.key !== key));
    resetFromStep2();
  };

  // ---------- Extract: step 2 → 3 ----------
  const runExtract = async () => {
    if (files.length === 0 || processing) return false;
    setProcessing(true);
    setExtractError(null);
    try {
      const fd = new FormData();
      fd.append("rest", selectedRestaurant);
      files.forEach(({ file }) => fd.append("files", file, file.name));
      const res = await axios.post("/admin/payroll/extract", fd, {
        withCredentials: true,
        headers: { "Content-Type": "multipart/form-data" },
      });
      const fresh = (res.data.employees || []).map((e) => ({
        ...e,
        new_wage_type: "",
        wage: "",
        travel: "",
        maxTravel: "",
        contractor: false,
        roles: (e.roles || []).map((role) => ({
          role,
          new_wage_type: "",
          wage: "",
        })),
      }));
      setNewEmployees(fresh);
      setAllEmployees(res.data.allEmployees || []);
      setFreshExtract(true);
      setMonth(res.data.month || "");
      setExceptions(res.data.exceptions || []);
      setShiftIssues(res.data.shiftIssues || []);
      setShiftIssuesAcknowledged(false);
      setSaveResult(null);
      setSaveError(null);
      setDiffSummary(null);
      return true;
    } catch (err) {
      console.error("extract error:", err);
      setExtractError(
        err.response?.data?.error || err.message || "Extraction failed",
      );
      return false;
    } finally {
      setProcessing(false);
    }
  };

  // ---------- Step 3: edit wage + update ----------
  // Wage-editing target for the shared WageDialog: { empIdx } for the
  // employee-level wage, { empIdx, roleIdx } for a per-role wage.
  const [wageDialog, setWageDialog] = useState(null);
  // Open row-actions (⋮) menu, keyed by the new-employee index.
  const [menuOpenFor, setMenuOpenFor] = useState(null);

  useEffect(() => {
    if (menuOpenFor == null) return;
    const close = () => setMenuOpenFor(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpenFor]);

  const updateRoleWage = (empIdx, roleIdx, { new_wage_type, wage }) => {
    setNewEmployees((prev) => {
      const next = prev.slice();
      const emp = { ...next[empIdx] };
      emp.roles = emp.roles.slice();
      emp.roles[roleIdx] = { ...emp.roles[roleIdx], new_wage_type, wage };
      next[empIdx] = emp;
      return next;
    });
  };

  const updateWageFields = (empIdx, { new_wage_type, wage }) => {
    setNewEmployees((prev) => {
      const next = prev.slice();
      next[empIdx] = { ...next[empIdx], new_wage_type, wage };
      return next;
    });
  };

  const updateTravel = (empIdx, val) => {
    setNewEmployees((prev) => {
      const next = prev.slice();
      next[empIdx] = { ...next[empIdx], travel: val };
      return next;
    });
  };

  const updateMaxTravel = (empIdx, val) => {
    setNewEmployees((prev) => {
      const next = prev.slice();
      next[empIdx] = { ...next[empIdx], maxTravel: val };
      return next;
    });
  };

  const toggleContractor = (empIdx) => {
    setNewEmployees((prev) => {
      const next = prev.slice();
      next[empIdx] = {
        ...next[empIdx],
        contractor: !next[empIdx].contractor,
      };
      return next;
    });
  };

  // Remove a not-yet-saved new employee from the local list (by identity, since
  // new rows have no employee_id yet).
  const removeNewEmployee = (emp) => {
    setNewEmployees((prev) => prev.filter((e) => e !== emp));
    setMenuOpenFor(null);
  };

  const [diffSummary, setDiffSummary] = useState(null);

  const buildDiff = useCallback(async () => {
    if (!selectedRestaurant) return [];
    const dbRes = await axios.post(
      "/admin/payroll/wages",
      { rest: selectedRestaurant, scope: "all" },
      { withCredentials: true },
    );
    const dbByName = new Map();
    // Secondary index by base name (suffix/asterisk stripped). Only used as a
    // fallback when the exact name doesn't match, and only when the base name
    // is unambiguous (exactly one DB row), so we never merge into the wrong
    // person.
    const dbByBase = new Map();
    for (const e of dbRes.data?.employees || []) {
      dbByName.set((e.name || "").trim(), e);
      const base = baseName(e.name);
      if (base) {
        if (dbByBase.has(base)) dbByBase.set(base, null); // ambiguous → disable
        else dbByBase.set(base, e);
      }
    }

    const inserts = [];
    const updates = [];
    let existing = 0;
    let roleUpdates = 0;
    const seen = new Set();

    // allEmployees has shift data + phones (merged in Step 3)
    for (const emp of [...newEmployees, ...allEmployees]) {
      const name = (emp.name || "").trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      let db = dbByName.get(name);
      // Fallback: match on the base name when an exact match fails (handles the
      // Tabit " - <role>" name suffix drifting between exports).
      if (!db) {
        const base = baseName(name);
        if (base) db = dbByBase.get(base) || undefined;
      }
      if (!db) {
        // Don't create a DB row from phone-less shift data — only insert a brand
        // new employee when we actually have a phone for them.
        if (!emp.phone) continue;
        inserts.push({
          rest: selectedRestaurant,
          name,
          ID_nmbr: emp.ID_nmbr || null,
          phone: emp.phone || null,
          roles: emp.roles || [],
          new_wage_type: emp.new_wage_type,
          wage: emp.wage,
          travel: emp.travel,
          maxTravel: emp.maxTravel,
          contractor: !!emp.contractor,
          t101: false,
        });
      } else {
        const needsPhone = emp.phone && !db.phone;
        const needsId = emp.ID_nmbr && !db.ID_nmbr;
        // On a duplicate match, overwrite the stored name with the raw shift
        // name (handles names that drifted between exports).
        const needsName = !!name && name !== (db.name || "").trim();
        // Merge any new roles from the shift file into the existing DB roles,
        // keeping all stored wages untouched. Only flag an update when the
        // role set actually grew.
        const { roles: mergedRoles, changed: rolesChanged } = mergeRoles(
          db.roles,
          roleNamesOf(emp.roles),
        );
        if (rolesChanged) roleUpdates += 1;
        if (needsPhone || needsId || rolesChanged || needsName) {
          updates.push({
            rest: selectedRestaurant,
            // Use the DB row's own name so the server resolves the right row
            // even when we matched via the base-name fallback (the shift-file
            // name may carry a suffix the stored name doesn't).
            name: db.name || name,
            // Raw shift name to write onto the matched row, so a drifted name
            // gets updated to the latest export's name.
            newName: name,
            ID_nmbr: emp.ID_nmbr || db.ID_nmbr || null,
            phone: emp.phone || db.phone || null,
            // Only send roles when they changed, so existing rows keep their
            // stored roles/wages when the update is phone/ID-only.
            ...(rolesChanged ? { roles: mergedRoles } : {}),
          });
        } else {
          existing += 1;
        }
      }
    }

    const sample = [...newEmployees, ...allEmployees].slice(0, 3);
    console.log("[buildDiff]", {
      newEmp: newEmployees.length,
      allEmp: allEmployees.length,
      dbEmp: dbByName.size,
      samplePhones: sample.map((e) => ({ name: e.name, phone: e.phone })),
      inserts: inserts.length,
      updates: updates.length,
      roleUpdates,
      existing,
    });
    setDiffSummary({
      inserts: inserts.length,
      updates: updates.length,
      roleUpdates,
      existing,
    });
    return [...inserts, ...updates];
  }, [selectedRestaurant, newEmployees, allEmployees]);

  // Auto-run diff when entering Step 4 or when allEmployees changes (e.g. phones merged)
  useEffect(() => {
    if (step === 4 && allEmployees.length > 0 && !saveResult) {
      buildDiff().catch((err) => console.error("auto-diff error:", err));
    }
  }, [step, allEmployees, saveResult, buildDiff]);

  const handleSaveEmployees = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const toUpsert = await buildDiff();
      if (toUpsert.length === 0) {
        setSaveResult({ inserted: 0, updated: 0, attempted: 0, errors: [] });
        return;
      }
      const res = await axios.post(
        "/admin/payroll/employees",
        { employees: toUpsert },
        { withCredentials: true },
      );
      setSaveResult(res.data);
    } catch (err) {
      console.error("save error:", err);
      setSaveError(err.response?.data?.error || err.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // ---------- Step 1: load an existing stored payroll, jump to step 3 ----------
  const loadExistingPayroll = async (mo) => {
    if (!selectedRestaurant || !mo || loadingExistingPayroll) return;
    setLoadingExistingPayroll(true);
    setLoadPayrollError(null);
    setExtractError(null);
    try {
      const res = await axios.post(
        "/admin/payroll/payroll-load",
        { rest: selectedRestaurant, month: mo },
        { withCredentials: true },
      );
      const list = Array.isArray(res.data?.employees) ? res.data.employees : [];
      setNewEmployees([]);
      setAllEmployees(list);
      setFreshExtract(false);
      setMonth(res.data?.month || mo);
      setExceptions([]);
      setShiftIssues([]);
      setShiftIssuesAcknowledged(false);
      setSaveResult({ inserted: 0, attempted: 0, errors: [] });
      setSaveError(null);
      setFiles([]);
      setPayrollResult(null);
      setPayrollError(null);
      await loadWages();
      setStep(3);
    } catch (err) {
      console.error("payroll-load error:", err);
      setLoadPayrollError(
        err.response?.data?.error || err.message || "Failed to load payroll",
      );
    } finally {
      setLoadingExistingPayroll(false);
    }
  };

  const handleSelectPayroll = (val) => {
    setSelectedPayroll(val);
    if (val === "new") {
      // Continue normal flow — user proceeds to step 2 manually.
      return;
    }
    loadExistingPayroll(val);
  };

  // ---------- Step 3 → 4: load wages from DB ----------
  const loadWages = async () => {
    setLoadingWages(true);
    try {
      const res = await axios.post(
        "/admin/payroll/wages",
        { rest: selectedRestaurant },
        { withCredentials: true },
      );
      setWageMap(buildWageMap(res.data.employees || []));
    } catch (err) {
      console.error("wages load error:", err);
      setWageMap(new Map());
    } finally {
      setLoadingWages(false);
    }
  };

  // Daily labor cost per restaurant.
  //
  // Primary path — emp.daily_breakdown (per-row entries pulled from the
  // xlsx data section):
  //   for each date entry {role, h100, h125, h150, tip, completion}:
  //     if tip+completion present → daily contribution = tip + completion
  //     else                       → (h100 + h125*1.25 + h150*1.5) * rate
  //   where `rate` is resolveHourlyWage(empData, role) — same rule the
  //   step-4 table uses, so daily sums reconcile with monthly totals.
  //
  // Global employees: distribute the monthly global amount evenly across
  // the dates they actually worked (no per-hour rate is meaningful).
  //
  // Fallback for older stored payrolls (no daily_breakdown saved): split
  // the employee's monthly total evenly across work_dates.
  const computeDailyLaborCost = () => {
    const byDate = new Map();
    const add = (date, amount) => {
      if (!date || !Number.isFinite(amount) || amount === 0) return;
      byDate.set(date, (byDate.get(date) || 0) + amount);
    };

    for (const emp of allEmployees) {
      const empData = lookupEmpData(wageMap, emp);
      const globalAmount =
        empData && empData.global != null && Number(empData.global) > 0
          ? Number(empData.global)
          : null;
      const breakdown =
        emp.daily_breakdown && typeof emp.daily_breakdown === "object"
          ? emp.daily_breakdown
          : null;
      const breakdownDates = breakdown ? Object.keys(breakdown) : [];

      if (globalAmount != null) {
        const dates =
          breakdownDates.length > 0
            ? breakdownDates
            : Array.isArray(emp.work_dates)
              ? emp.work_dates
              : [];
        if (dates.length === 0) continue;
        const perDay = globalAmount / dates.length;
        for (const d of dates) add(d, perDay);
        continue;
      }

      if (breakdownDates.length > 0) {
        for (const date of breakdownDates) {
          const entries = breakdown[date] || [];
          for (const e of entries) {
            const tip = Number(e.tip || 0);
            const completion = Number(e.completion || 0);
            if (tip !== 0 || completion !== 0) {
              add(date, tip + completion);
              continue;
            }
            const wage = resolveHourlyWage(empData, e.role);
            if (wage == null) continue;
            const cost =
              ((Number(e.h100) || 0) +
                (Number(e.h125) || 0) * 1.25 +
                (Number(e.h150) || 0) * 1.5) *
              wage;
            add(date, cost);
          }
        }
        continue;
      }

      // Fallback A: per-day raw hours (from entry/exit times). Allocate
      // the monthly total proportionally to each day's hours, so a long
      // day gets proportionally more cost and the daily sum equals the
      // monthly total exactly.
      const dailyHours =
        emp.daily_hours && typeof emp.daily_hours === "object"
          ? emp.daily_hours
          : null;
      const dailyHoursDates = dailyHours ? Object.keys(dailyHours) : [];

      // Monthly total (matches the step-4 per-employee total).
      let monthly = 0;
      for (const [role, payload] of Object.entries(emp.payroll_data || {})) {
        const hours = (payload && payload.hours) || [];
        const [h100 = 0, h125 = 0, h150 = 0] = hours;
        const tip = Number((payload && payload.tip) || 0);
        const completion = Number((payload && payload.completion) || 0);
        if (tip !== 0 || completion !== 0) {
          monthly += tip + completion;
          continue;
        }
        const wage = resolveHourlyWage(empData, role);
        if (wage == null) continue;
        monthly +=
          ((Number(h100) || 0) +
            (Number(h125) || 0) * 1.25 +
            (Number(h150) || 0) * 1.5) *
          wage;
      }

      if (monthly > 0 && dailyHoursDates.length > 0) {
        let totalHours = 0;
        for (const d of dailyHoursDates) {
          totalHours += Number(dailyHours[d]) || 0;
        }
        if (totalHours > 0) {
          for (const d of dailyHoursDates) {
            const hrs = Number(dailyHours[d]) || 0;
            if (hrs <= 0) continue;
            add(d, monthly * (hrs / totalHours));
          }
          continue;
        }
      }

      // Fallback B: split monthly total evenly across known work_dates,
      // or across every calendar day of `month` if neither are present.
      let dates = Array.isArray(emp.work_dates) ? emp.work_dates : [];
      if (dates.length === 0 && /^\d{4}-\d{2}$/.test(month)) {
        const [y, m] = month.split("-").map((n) => parseInt(n, 10));
        const daysInMonth = new Date(y, m, 0).getDate();
        dates = [];
        for (let d = 1; d <= daysInMonth; d++) {
          dates.push(
            `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
          );
        }
      }
      if (dates.length === 0 || monthly === 0) continue;
      const perDay = monthly / dates.length;
      for (const d of dates) add(d, perDay);
    }

    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, cost]) => ({
        date,
        labor_cost: Math.round(cost * 100) / 100,
      }));
  };

  // ---------- Step 4: save payroll ----------
  const handleSavePayroll = async () => {
    if (savingPayroll) return;
    if (!month) {
      setPayrollError("month not detected from upload — cannot save payroll");
      return;
    }
    if (!allEmployees || allEmployees.length === 0) {
      setPayrollError("no extracted employees to save payroll for");
      return;
    }
    setSavingPayroll(true);
    setPayrollError(null);
    try {
      // 1. Compute daily labor cost — only when the payroll was just
      //    extracted from an xlsx upload. Loading an existing payroll
      //    from the dropdown skips this entirely.
      if (freshExtract) {
        const dailyItems = computeDailyLaborCost();
        console.log(
          `[labor-cost] computed ${dailyItems.length} day(s) for rest=${selectedRestaurant}`,
          dailyItems,
        );
        try {
          await axios.post(
            "/admin/payroll/labor-cost",
            { rest: selectedRestaurant, items: dailyItems },
            { withCredentials: true },
          );
        } catch (laborErr) {
          // Non-fatal — keep saving payroll, but surface a warning.
          console.error("labor-cost error:", laborErr);
          setPayrollError(
            "Warning: daily labor cost save failed (" +
              (laborErr.response?.data?.error || laborErr.message) +
              "). Continuing with payroll save…",
          );
        }
      } else {
        console.log(
          "[labor-cost] skipped — payroll loaded from DB (not a fresh xlsx extract)",
        );
      }

      // 2. Save the payroll itself.
      const payload = {
        rest: selectedRestaurant,
        month,
        employees: allEmployees.map((e) => ({
          name: e.name,
          ID_nmbr: e.ID_nmbr,
          payroll_data: e.payroll_data || {},
          role_extras: e.role_extras || {},
          workdays: e.workdays ?? null,
          global: e.global ?? null,
          netGross: e.netGross ?? null,
          in_advance: e.in_advance ?? null,
          work_dates: Array.isArray(e.work_dates) ? e.work_dates : [],
          daily_breakdown:
            e.daily_breakdown && typeof e.daily_breakdown === "object"
              ? e.daily_breakdown
              : {},
          daily_hours:
            e.daily_hours && typeof e.daily_hours === "object"
              ? e.daily_hours
              : {},
        })),
      };
      const res = await axios.post("/admin/payroll/payroll-data", payload, {
        withCredentials: true,
      });
      setPayrollResult(res.data);
      // 3. Fetch labor-cost summary and open the dialog.
      try {
        setLoadingLaborSummary(true);
        setLaborSummaryError(null);
        const sum = await axios.post(
          "/admin/payroll/labor-cost-summary",
          { rest: selectedRestaurant, month },
          { withCredentials: true },
        );
        setLaborSummary(sum.data || null);
      } catch (sumErr) {
        console.error("labor-cost-summary error:", sumErr);
        setLaborSummaryError(
          sumErr.response?.data?.error ||
            sumErr.message ||
            "Failed to load labor cost summary",
        );
        setLaborSummary(null);
      } finally {
        setLoadingLaborSummary(false);
        setShowLaborDialog(true);
      }
    } catch (err) {
      console.error("payroll-data error:", err);
      setPayrollError(
        err.response?.data?.error || err.message || "Payroll save failed",
      );
    } finally {
      setSavingPayroll(false);
    }
  };

  // ---------- Step 4: XL download ----------
  const handleDownloadXlsx = async () => {
    if (downloadingXlsx) return;
    if (!allEmployees || allEmployees.length === 0) {
      setDownloadError("no extracted employees to export");
      return;
    }
    setDownloadingXlsx(true);
    setDownloadError(null);
    try {
      const payload = {
        rest: selectedRestaurant,
        restLabel: selectedLabel,
        month,
        employees: allEmployees.map((e) => {
          const empData = lookupEmpData(wageMap, e);
          return {
            name: e.name,
            ID_nmbr: e.ID_nmbr,
            payroll_data: e.payroll_data || {},
            role_extras: e.role_extras || {},
            workdays: e.workdays,
            in_advance: e.in_advance ?? null, // מפרעה
            // Source for the Shiklulit recordType=4 actual-attendance rows:
            // work_dates → actual work days, daily_hours → actual work hours.
            work_dates: Array.isArray(e.work_dates) ? e.work_dates : [],
            daily_hours:
              e.daily_hours && typeof e.daily_hours === "object"
                ? e.daily_hours
                : {},
            hourly_wage: empData?.hourly_wage ?? null,
            wage_type: empData?.wage_type ?? null,
            travel: empData?.travel ?? null,
            maxTravel: empData?.maxTravel ?? null,
          };
        }),
      };
      const res = await axios.post("/admin/payroll/export-micpal", payload, {
        withCredentials: true,
      });
      const { xlsxBase64, filename, missing, skippedContractors: skipped } =
        res.data || {};
      if (xlsxBase64) {
        const binary = atob(xlsxBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename || `micpal_import_${month || "month"}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      if (Array.isArray(missing) && missing.length > 0) {
        setMicpalMissing(missing);
      }
      if (Array.isArray(skipped) && skipped.length > 0) {
        setSkippedContractors(skipped);
      }
    } catch (err) {
      console.error("export-micpal error:", err);
      setDownloadError(err.message || "download failed");
    } finally {
      setDownloadingXlsx(false);
    }
  };

  // ---------- Wizard navigation ----------
  const canAdvance = () => {
    if (step === 1) return !!selectedRestaurant;
    if (step === 2) return files.length > 0;
    if (step === 3) return true; // Employee data — optional, can skip
    if (step === 4) {
      if (shiftIssues.length > 0 && !shiftIssuesAcknowledged) return false;
      if (employeesAllSaved) return true;
      if (diffSummary && diffSummary.inserts === 0 && diffSummary.updates === 0)
        return true;
      return false;
    }
    return false;
  };

  const goNext = async () => {
    if (step === 1) {
      setStep(2);
    } else if (step === 2) {
      const ok = await runExtract();
      if (ok) setStep(3);
    } else if (step === 3) {
      if (empDataFiles.length > 0 && empDataResults.length === 0) {
        await runEmpDataAttach();
      }
      setStep(4);
    } else if (step === 4) {
      await handleSaveEmployees();
      await loadWages();
      setStep(5);
    }
  };
  const goBack = () => {
    if (step > 1) setStep(step - 1);
  };
  const goToStep = (target) => {
    if (target === step) return;
    if (target < step) {
      setStep(target);
      return;
    }
    if (target === 2 && selectedRestaurant) setStep(2);
    if (target === 3 && allEmployees.length > 0) setStep(3);
    if (target === 4 && allEmployees.length > 0) setStep(4);
    if (
      target === 5 &&
      (employeesAllSaved || noNewEmployees) &&
      allEmployees.length > 0
    )
      setStep(5);
  };

  // ---------- Step 4: build payroll table rows + warnings ----------
  const { rows: fullPayrollRows, warnings: payrollWarnings } = useMemo(() => {
    const rows = [];
    const warnings = [];
    let grandTotal = 0;

    for (const emp of allEmployees) {
      const empData = lookupEmpData(wageMap, emp);
      const globalAmount =
        empData && empData.global != null && Number(empData.global) > 0
          ? Number(empData.global)
          : null;
      const wageType = empData?.wage_type || null;
      const dailyTravel =
        empData && empData.travel != null ? Number(empData.travel) : null;
      const maxTravel =
        empData && empData.maxTravel != null ? Number(empData.maxTravel) : null;
      const wd = emp.workdays != null ? Number(emp.workdays) : 0;
      let empTravel = null;
      if (maxTravel != null) {
        if (dailyTravel == null || dailyTravel * wd > maxTravel) {
          empTravel = maxTravel;
        } else {
          empTravel = dailyTravel * wd;
        }
      } else if (dailyTravel != null) {
        empTravel = dailyTravel * wd;
      }
      const empBreaks = computeBreaks(emp);
      const breaksByRole = computeBreaksByRole(emp);
      // Payroll-software employee number (מס עובד) for the new table column.
      const empNumber = empData?.empNumber ?? null;
      // מפרעה (advance): for an employee with any hourly_min role it is computed
      // (mirrors the export) and overrides the stored value; otherwise the
      // stored/manual value is shown.
      //   advance = Σ(hourly_min roles) (h100 + h125*1.25 + h150*1.5) * wage
      //             * 0.95 − total completion.
      let empInAdvance = emp.in_advance ?? null;
      {
        let minGross = 0;
        let hasMin = false;
        let comp = 0;
        for (const [role, payload] of Object.entries(emp.payroll_data || {})) {
          comp += Number(payload && payload.completion) || 0;
          const rw = empData?.roles?.[role];
          // Role wage type/amount, falling back to the employee-level wage.
          const t = (rw && rw.new_wage_type) || empData?.new_wage_type;
          if (!t || !t.startsWith("hourly_min_")) continue;
          hasMin = true;
          const hrs = (payload && payload.hours) || [];
          const weighted =
            (Number(hrs[0]) || 0) +
            (Number(hrs[1]) || 0) * 1.25 +
            (Number(hrs[2]) || 0) * 1.5;
          let wage =
            rw && rw.wage != null && rw.wage !== ""
              ? Number(rw.wage)
              : (empData?.wage ?? 0);
          if (wage === -1) wage = MIN_HOURLY_WAGE;
          minGross += weighted * wage;
        }
        if (hasMin) {
          // Travel is added to the gross before the 95% factor.
          const travelSum = Number(empTravel) || 0;
          empInAdvance =
            Math.round(
              ((minGross + travelSum) * 0.95 - Math.max(0, comp)) * 100,
            ) / 100;
        }
      }

      const roleEntries = Object.entries(emp.payroll_data || {});

      const roleRows = roleEntries.map(([role, payload]) => {
        const hours = (payload && payload.hours) || [];
        const [h100 = 0, h125 = 0, h150 = 0] = hours;
        const tip = Number((payload && payload.tip) || 0);
        // Negative completion (השלמה) is clamped to 0 — matches the export.
        const completion = Math.max(
          0,
          Number((payload && payload.completion) || 0),
        );
        const wage = resolveHourlyWage(empData, role);
        const extras = (emp.role_extras && emp.role_extras[role]) || {};
        const hasTipOrCompletion = tip !== 0 || completion !== 0;

        let total = null;
        let warn = null;

        if (globalAmount != null) {
          // Global salary handled at the employee level — leave per-role
          // total empty; final salary is set on the first role row below.
          total = null;
        } else if (hasTipOrCompletion) {
          // tip + completion REPLACE the hourly calc — they ARE the wage.
          total = tip + completion;
        } else if (wage == null) {
          total = null;
          warn = `${emp.name || "(no name)"} / ${role}: missing hourly wage and not global`;
          warnings.push(warn);
        } else {
          total =
            ((Number(h100) || 0) +
              (Number(h125) || 0) * 1.25 +
              (Number(h150) || 0) * 1.5) *
            wage;
        }

        return {
          role,
          h100,
          h125,
          h150,
          wage,
          tip,
          completion,
          manualCompletion: extras.manualCompletion || 0,
          travel: extras.travel || 0,
          total,
          warn,
        };
      });

      if (globalAmount != null && roleRows.length > 0) {
        // Place the global salary on the first role row only.
        roleRows[0].total = globalAmount;
      }

      if (roleRows.length === 0) {
        rows.push({
          empKey: emp.name + "::empty",
          first: true,
          last: true,
          isTotal: false,
          empty: true,
          name: emp.name,
          empNumber,
          inAdvance: empInAdvance,
          workdays: emp.workdays,
          global: emp.global,
          wage_type: wageType,
          travel: empTravel,
          breaks: empBreaks,
          total: globalAmount,
        });
        if (globalAmount != null) grandTotal += globalAmount;
        continue;
      }

      roleRows.forEach((r, i) => {
        rows.push({
          empKey: emp.name + "::" + i,
          first: i === 0,
          last: i === roleRows.length - 1 && roleRows.length === 1,
          isTotal: false,
          name: emp.name,
          empNumber,
          inAdvance: empInAdvance,
          workdays: emp.workdays,
          global: emp.global,
          wage_type: wageType,
          travel: empTravel,
          breaks: breaksByRole.get(r.role) || null,
          ...r,
        });
        if (r.total != null) grandTotal += r.total;
      });

      // Per-employee subtotal row when multi-role and not global.
      if (roleRows.length > 1 && globalAmount == null) {
        const sum = (k) =>
          roleRows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
        rows.push({
          empKey: emp.name + "::total",
          first: false,
          last: true,
          isTotal: true,
          name: emp.name,
          role: 'סה"כ',
          h100: sum("h100"),
          h125: sum("h125"),
          h150: sum("h150"),
          tip: sum("tip"),
          completion: sum("completion"),
          manualCompletion: sum("manualCompletion"),
          travel: sum("travel"),
          wage_type: wageType,
          breaks: empBreaks,
          total: roleRows.reduce((s, r) => s + (Number(r.total) || 0), 0),
        });
      }
    }

    // Grand total row at the bottom.
    rows.push({
      empKey: "__grand_total__",
      first: false,
      last: true,
      isTotal: true,
      isGrandTotal: true,
      name: "",
      role: 'סה"כ כללי',
      total: grandTotal,
    });

    return { rows, warnings };
  }, [allEmployees, wageMap]);

  // Final-table filter: matches by employee name, employee number (מס' עובד),
  // or any of the employee's roles. Whole employee blocks are kept/dropped
  // together; the grand-total row is hidden while a filter is active.
  const [payrollSearch, setPayrollSearch] = useState("");
  // "Exportable only" — an employee is valid for export when it has a payroll
  // employee number (מס' עובד); the export drops the rest as "missing".
  const [exportableOnly, setExportableOnly] = useState(false);
  const displayedPayrollRows = useMemo(() => {
    const q = payrollSearch.trim().toLowerCase();
    if (!q && !exportableOnly) return fullPayrollRows;
    // Build per-employee haystack (name + מס' עובד + all roles) + export flag.
    const byEmp = new Map();
    for (const r of fullPayrollRows) {
      if (r.isGrandTotal) continue;
      const key = r.name || "";
      if (!byEmp.has(key)) byEmp.set(key, { hay: [key], empNumber: "" });
      const e = byEmp.get(key);
      if (r.empNumber != null && r.empNumber !== "") {
        e.hay.push(String(r.empNumber));
        e.empNumber = String(r.empNumber);
      }
      if (r.role) e.hay.push(String(r.role));
    }
    const matched = new Set();
    for (const [key, e] of byEmp) {
      const textOk = !q || e.hay.join(" ").toLowerCase().includes(q);
      const exportOk = !exportableOnly || e.empNumber !== "";
      if (textOk && exportOk) matched.add(key);
    }
    return fullPayrollRows.filter(
      (r) => !r.isGrandTotal && matched.has(r.name || ""),
    );
  }, [fullPayrollRows, payrollSearch, exportableOnly]);

  // RTL payroll table: when step 4 opens, scroll the wrapper to the inline-start
  // (right edge) so the sticky שם + תפקיד (role) columns are visible instead of
  // the far-left totals. Only on open — not on every wage edit — so it doesn't
  // yank the view back while the user is editing.
  useEffect(() => {
    if (step !== 4) return;
    const el = payrollWrapRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      // A large value clamps to the inline-start in RTL across browsers.
      el.scrollLeft = el.scrollWidth;
    });
    return () => cancelAnimationFrame(id);
  }, [step]);

  // ---------- Styles ----------
  const styles = {
    container: {
      width: "100%",
      minHeight: "calc(100vh - 100px)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "16px 12px",
    },
    stepper: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "12px",
      marginBottom: "20px",
      flexWrap: "wrap",
    },
    stepItem: {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      cursor: "pointer",
      userSelect: "none",
    },
    stepCircle: (state) => ({
      width: "28px",
      height: "28px",
      borderRadius: "50%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: 600,
      fontSize: "0.85rem",
      backgroundColor:
        state === "active"
          ? theme.active || "#2196f3"
          : state === "done"
            ? theme.success || "#43a047"
            : theme.surfaceSecondary || theme.surface,
      color:
        state === "active" || state === "done"
          ? "#ffffff"
          : theme.textSecondary,
      border: state === "todo" ? `1px solid ${theme.border}` : "none",
    }),
    stepLabel: (state) => ({
      fontSize: "0.85rem",
      fontWeight: state === "active" ? 600 : 500,
      color: state === "todo" ? theme.textSecondary : theme.text,
    }),
    stepDivider: {
      width: "30px",
      height: "1px",
      backgroundColor: theme.border,
    },
    body: {
      width: "100%",
      // Final step shows the wide payroll table — let it grow up to 90% of the
      // screen width; earlier steps stay at the comfortable reading width.
      maxWidth: step === 5 ? "90vw" : "1400px",
      flex: 1,
      display: "flex",
      flexDirection: "column",
      gap: "16px",
    },
    card: {
      padding: "20px",
      backgroundColor: theme.surface,
      border: `1px solid ${theme.border}`,
      borderRadius: "8px",
    },
    selectWrapper: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "8px",
    },
    label: {
      fontSize: "0.875rem",
      color: theme.textSecondary,
      fontWeight: 500,
    },
    select: {
      minWidth: "320px",
      padding: "10px 12px",
      fontSize: "1rem",
      border: `1px solid ${theme.border}`,
      borderRadius: "6px",
      backgroundColor: theme.surface,
      color: theme.text,
      cursor: "pointer",
      outline: "none",
    },
    dropZone: {
      border: `2px dashed ${isDragging ? theme.active || "#2196f3" : theme.border}`,
      borderRadius: "10px",
      backgroundColor: isDragging
        ? theme.activeBg || "rgba(33,150,243,0.08)"
        : theme.surface,
      padding: "40px 24px",
      textAlign: "center",
      cursor: "pointer",
      color: theme.textSecondary,
    },
    dropZoneTitle: {
      fontSize: "1rem",
      fontWeight: 500,
      color: theme.text,
      marginBottom: "8px",
    },
    dropZoneHint: {
      fontSize: "0.85rem",
      color: theme.textSecondary,
      marginBottom: "16px",
    },
    addBtn: {
      padding: "8px 16px",
      fontSize: "0.9rem",
      fontWeight: 500,
      border: `1px solid ${theme.border}`,
      borderRadius: "6px",
      backgroundColor: "transparent",
      color: theme.text,
      cursor: "pointer",
    },
    fileList: {
      listStyle: "none",
      margin: 0,
      padding: 0,
      display: "flex",
      flexDirection: "column",
      gap: "8px",
    },
    fileItem: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "10px 14px",
      border: `1px solid ${theme.border}`,
      borderRadius: "6px",
      backgroundColor: theme.surface,
      gap: "12px",
    },
    fileMeta: {
      display: "flex",
      flexDirection: "column",
      gap: "2px",
      overflow: "hidden",
    },
    fileName: {
      color: theme.text,
      fontSize: "0.9rem",
      fontWeight: 500,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
    fileSize: { color: theme.textSecondary, fontSize: "0.75rem" },
    deleteBtn: {
      background: "none",
      border: "none",
      cursor: "pointer",
      color: theme.error || "#e53935",
      fontSize: "0.85rem",
      fontWeight: 500,
      padding: "4px 8px",
      borderRadius: "4px",
    },
    nav: {
      display: "flex",
      justifyContent: "space-between",
      gap: "12px",
      marginTop: "8px",
    },
    primaryButton: {
      padding: "10px 20px",
      fontSize: "0.95rem",
      fontWeight: 600,
      border: "none",
      borderRadius: "6px",
      backgroundColor: theme.active || "#2196f3",
      color: "#ffffff",
      cursor: "pointer",
    },
    secondaryButton: {
      padding: "10px 20px",
      fontSize: "0.95rem",
      fontWeight: 500,
      border: `1px solid ${theme.border}`,
      borderRadius: "6px",
      backgroundColor: "transparent",
      color: theme.text,
      cursor: "pointer",
    },
    errorBox: {
      padding: "10px 12px",
      borderRadius: "6px",
      backgroundColor: theme.errorBg || "rgba(229,57,53,0.1)",
      color: theme.error || "#e53935",
      border: `1px solid ${theme.errorBorder || "#e53935"}`,
      fontSize: "0.9rem",
    },
    successBox: {
      padding: "10px 12px",
      borderRadius: "6px",
      backgroundColor: theme.successBg || "rgba(76,175,80,0.1)",
      color: theme.success || "#43a047",
      border: `1px solid ${theme.successBorder || "#43a047"}`,
      fontSize: "0.9rem",
    },
    tableWrap: { overflowX: "auto" },
    // Step-4: wrapper IS the scroll container for BOTH axes. Header sticks
    // to its top, name column sticks to its right edge.
    tableWrapStep4: {
      overflow: "auto",
      maxHeight: "calc(100vh - 220px)",
      border: `1px solid ${theme.border}`,
      borderRadius: "6px",
      position: "relative",
    },
    // border-collapse must be `separate` — sticky <th>/<td> cells don't
    // render their background with `collapse` in Chrome/Firefox.
    tableStep4: {
      width: "100%",
      borderCollapse: "separate",
      borderSpacing: 0,
      fontSize: "0.88rem",
      backgroundColor: theme.surface,
      direction: "rtl",
    },
    stickyTh: {
      position: "sticky",
      top: 0,
      zIndex: 2,
      backgroundColor: theme.surfaceSecondary || theme.surface,
      borderBottom: `1px solid ${theme.border}`,
    },
    stickyNameTh: {
      position: "sticky",
      top: 0,
      right: 0,
      zIndex: 3,
      backgroundColor: theme.surfaceSecondary || theme.surface,
      borderBottom: `1px solid ${theme.border}`,
      borderLeft: `1px solid ${theme.border}`,
      minWidth: "180px",
    },
    stickyNameCell: {
      position: "sticky",
      right: 0,
      zIndex: 1,
      backgroundColor: theme.surface,
      borderLeft: `1px solid ${theme.border}`,
      minWidth: "180px",
    },
    table: {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "0.88rem",
      backgroundColor: theme.surface,
      border: `1px solid ${theme.border}`,
      borderRadius: "6px",
      overflow: "hidden",
      direction: "rtl",
    },
    ltrTable: { direction: "ltr" },
    th: {
      padding: "8px 10px",
      textAlign: "right",
      borderBottom: `1px solid ${theme.border}`,
      color: theme.text,
      fontWeight: 600,
      backgroundColor: theme.surfaceSecondary || theme.surface,
      whiteSpace: "nowrap",
    },
    td: {
      padding: "6px 10px",
      borderBottom: `1px solid ${theme.border}`,
      color: theme.text,
      verticalAlign: "top",
      whiteSpace: "nowrap",
    },
    tdEmpBoundary: {
      padding: "6px 10px",
      borderBottom: `2px solid ${theme.border}`,
      color: theme.text,
      verticalAlign: "top",
      whiteSpace: "nowrap",
    },
    tdTotal: {
      padding: "6px 10px",
      borderBottom: `2px solid ${theme.border}`,
      color: theme.text,
      verticalAlign: "top",
      fontWeight: 600,
      backgroundColor: theme.surfaceSecondary || theme.surface,
      whiteSpace: "nowrap",
    },
    wageInput: {
      width: "110px",
      padding: "6px 8px",
      fontSize: "0.9rem",
      border: `1px solid ${theme.border}`,
      borderRadius: "4px",
      backgroundColor: theme.surface,
      color: theme.text,
      outline: "none",
    },
    toggleButton: {
      padding: "6px 10px",
      fontSize: "0.85rem",
      fontWeight: 600,
      border: `1px solid ${theme.border}`,
      borderRadius: "4px",
      backgroundColor: theme.surface,
      color: theme.text,
      cursor: "pointer",
      whiteSpace: "nowrap",
    },
    toggleButtonActive: {
      padding: "6px 10px",
      fontSize: "0.85rem",
      fontWeight: 600,
      border: `1px solid ${theme.active || "#2196f3"}`,
      borderRadius: "4px",
      backgroundColor: theme.active || "#2196f3",
      color: "#ffffff",
      cursor: "pointer",
      whiteSpace: "nowrap",
    },
    summary: { fontSize: "0.9rem", color: theme.textSecondary },
  };

  const handleRestart = () => {
    resetFromStep2();
    setFiles([]);
    setSelectedRestaurant("");
    setSelectedPayroll("new");
    setPayrollOptions([]);
    setLoadPayrollError(null);
    setStep(1);
  };

  // ---------- Renderers ----------
  const renderStepper = () => (
    <div style={styles.stepper}>
      {STEPS.map((s, i) => {
        const state = step === s.id ? "active" : step > s.id ? "done" : "todo";
        return (
          <React.Fragment key={s.id}>
            <div
              style={styles.stepItem}
              onClick={() => goToStep(s.id)}
              role="button"
              tabIndex={0}
            >
              <div style={styles.stepCircle(state)}>
                {state === "done" ? "✓" : s.id}
              </div>
              <div style={styles.stepLabel(state)}>{s.label}</div>
            </div>
            {i < STEPS.length - 1 && <div style={styles.stepDivider} />}
          </React.Fragment>
        );
      })}
      <button
        type="button"
        onClick={handleRestart}
        title="Restart — clear everything and go back to step 1"
        aria-label="Restart"
        style={{
          marginLeft: "16px",
          width: "32px",
          height: "32px",
          borderRadius: "50%",
          border: `1px solid ${theme.border}`,
          backgroundColor: theme.surface,
          color: theme.text,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "16px",
          lineHeight: 1,
        }}
      >
        ↻
      </button>
    </div>
  );

  const renderStep1 = () => (
    <div style={styles.card}>
      <div
        style={{
          display: "flex",
          gap: "24px",
          alignItems: "flex-end",
          flexWrap: "wrap",
        }}
      >
        <div style={styles.selectWrapper}>
          <label htmlFor="shift-restaurant-select" style={styles.label}>
            Select Restaurant
          </label>
          <select
            id="shift-restaurant-select"
            style={styles.select}
            value={selectedRestaurant}
            onChange={(e) => {
              setSelectedRestaurant(e.target.value);
              setFiles([]);
              resetFromStep2();
            }}
          >
            <option value="">-- Choose a restaurant --</option>
            {availableGroups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.items.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {selectedRestaurant && (
          <div style={styles.selectWrapper}>
            <label htmlFor="shift-payroll-select" style={styles.label}>
              Payroll
            </label>
            <select
              id="shift-payroll-select"
              style={styles.select}
              value={selectedPayroll}
              onChange={(e) => handleSelectPayroll(e.target.value)}
              disabled={loadingPayrolls || loadingExistingPayroll}
            >
              <option value="new">— New payroll —</option>
              {payrollOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {loadingExistingPayroll && (
        <div style={{ marginTop: "12px", color: theme.textSecondary }}>
          Loading payroll…
        </div>
      )}
      {loadPayrollError && (
        <div
          style={{
            marginTop: "12px",
            color: theme.error || "#e53935",
          }}
        >
          {loadPayrollError}
        </div>
      )}
    </div>
  );

  const renderStep2 = () => (
    <div style={styles.card}>
      <div style={{ marginBottom: "12px", color: theme.text }}>
        Restaurant: <strong>{selectedLabel}</strong>
      </div>
      <div
        style={styles.dropZone}
        onClick={() => fileInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDragEnter={handleDragOver}
        role="button"
        tabIndex={0}
      >
        <div style={styles.dropZoneTitle}>
          {isDragging ? "Drop files here" : "Drag & drop .xlsx files here"}
        </div>
        <div style={styles.dropZoneHint}>or</div>
        <button
          type="button"
          style={styles.addBtn}
          onClick={(e) => {
            e.stopPropagation();
            fileInputRef.current?.click();
          }}
        >
          Add file
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".xlsx"
          onChange={handleFileInput}
          style={{ display: "none" }}
        />
      </div>
      {files.length > 0 && (
        <ul style={{ ...styles.fileList, marginTop: "16px" }}>
          {files.map(({ key, file }) => (
            <li key={key} style={styles.fileItem}>
              <div style={styles.fileMeta}>
                <div style={styles.fileName} title={file.name}>
                  {file.name}
                </div>
                <div style={styles.fileSize}>{formatBytes(file.size)}</div>
              </div>
              <button
                type="button"
                style={styles.deleteBtn}
                onClick={() => removeFile(key)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      {extractError && (
        <div style={{ ...styles.errorBox, marginTop: "12px" }}>
          <strong>Error:</strong> {extractError}
        </div>
      )}
    </div>
  );

  const renderStep3 = () => (
    <div style={styles.card}>
      {shiftIssues.length > 0 && !shiftIssuesAcknowledged && (
        <div style={{ ...styles.errorBox, marginBottom: "12px" }}>
          <div style={{ fontWeight: 600, marginBottom: "6px" }}>
            ⚠️ {shiftIssues.length} incomplete shift
            {shiftIssues.length === 1 ? "" : "s"} (כניסה without יציאה or vice
            versa)
          </div>
          <div
            style={{
              maxHeight: "260px",
              overflowY: "auto",
              border: `1px solid ${theme.border}`,
              borderRadius: "4px",
              backgroundColor: theme.surface,
              color: theme.text,
              marginTop: "6px",
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "0.85rem",
              }}
            >
              <thead>
                <tr>
                  <th style={styles.th}>employee</th>
                  <th style={styles.th}>date</th>
                  <th style={styles.th}>role</th>
                  <th style={styles.th}>כניסה</th>
                  <th style={styles.th}>יציאה</th>
                  <th style={styles.th}>missing</th>
                </tr>
              </thead>
              <tbody>
                {shiftIssues.map((i, idx) => (
                  <tr key={idx}>
                    <td style={styles.td}>{i.employee || "—"}</td>
                    <td style={styles.td}>{i.date || "—"}</td>
                    <td style={styles.td}>{i.role || "—"}</td>
                    <td style={styles.td}>{i.entry || "—"}</td>
                    <td style={styles.td}>{i.exit || "—"}</td>
                    <td style={styles.td}>{i.missing}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div
            style={{
              display: "flex",
              gap: "8px",
              marginTop: "10px",
              justifyContent: "flex-end",
            }}
          >
            <button
              type="button"
              style={styles.secondaryButton}
              onClick={() => {
                setStep(2);
                resetFromStep2();
              }}
            >
              Reupload fixed files
            </button>
            <button
              type="button"
              style={styles.primaryButton}
              onClick={() => setShiftIssuesAcknowledged(true)}
            >
              Ignore and continue
            </button>
          </div>
        </div>
      )}

      <div style={styles.summary}>
        Restaurant:{" "}
        <strong style={{ color: theme.text }}>{selectedLabel}</strong>
        {" · "}
        {diffSummary ? (
          <span>
            <strong style={{ color: theme.text }}>{diffSummary.inserts}</strong>{" "}
            new ·{" "}
            <strong style={{ color: theme.text }}>{diffSummary.updates}</strong>{" "}
            to update
            {diffSummary.roleUpdates > 0 ? (
              <>
                {" "}
                (
                <strong style={{ color: theme.text }}>
                  {diffSummary.roleUpdates}
                </strong>{" "}
                role{diffSummary.roleUpdates === 1 ? "" : "s"})
              </>
            ) : null}{" "}
            ·{" "}
            <strong style={{ color: theme.text }}>
              {diffSummary.existing}
            </strong>{" "}
            unchanged
          </span>
        ) : noNewEmployees ? (
          <span>
            {allEmployees.length > 0 ? (
              <>
                <strong style={{ color: theme.text }}>
                  {allEmployees.length}
                </strong>{" "}
                employee{allEmployees.length === 1 ? "" : "s"} — click Update to
                compare with DB
              </>
            ) : (
              "No employees."
            )}
          </span>
        ) : (
          <>
            <strong style={{ color: theme.text }}>{newEmployees.length}</strong>{" "}
            new employee{newEmployees.length === 1 ? "" : "s"} to add
          </>
        )}
        {exceptions.length > 0 && ` · ${exceptions.length} exception(s)`}
        {month && ` · month ${month}`}
        {shiftIssuesAcknowledged && shiftIssues.length > 0 && (
          <>
            {" · "}
            <span style={{ color: theme.error || "#e53935" }}>
              ⚠️ {shiftIssues.length} incomplete shift
              {shiftIssues.length === 1 ? "" : "s"} ignored
            </span>
          </>
        )}
      </div>

      {newEmployees.length > 0 && (
        <div style={{ marginTop: "12px" }}>
          <EmployeeWageTable
            rows={newEmployees.map((emp, empIdx) => ({ emp, empIdx }))}
            onEditEmpWage={(empIdx) => setWageDialog({ empIdx })}
            onEditRoleWage={(empIdx, roleIdx) =>
              setWageDialog({ empIdx, roleIdx })
            }
            onUpdateTravel={updateTravel}
            onUpdateMaxTravel={updateMaxTravel}
            onToggleContractor={toggleContractor}
            actions={{
              keyOf: (emp) => emp,
              menuOpenFor,
              setMenuOpenFor,
              removingId: null,
              onRemove: removeNewEmployee,
              onDuplicate: null,
            }}
          />
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginTop: "12px",
        }}
      >
        <button
          type="button"
          style={{
            ...styles.primaryButton,
            opacity: saving ? 0.7 : 1,
            cursor: saving ? "wait" : "pointer",
          }}
          onClick={handleSaveEmployees}
          disabled={
            saving ||
            employeesAllSaved ||
            (diffSummary &&
              diffSummary.inserts === 0 &&
              diffSummary.updates === 0)
          }
        >
          {saving
            ? "Saving…"
            : employeesAllSaved
              ? "Saved"
              : diffSummary &&
                  diffSummary.inserts === 0 &&
                  diffSummary.updates === 0
                ? "Nothing to update"
                : "Update"}
        </button>
      </div>

      {saveError && (
        <div style={{ ...styles.errorBox, marginTop: "12px" }}>
          <strong>Error:</strong> {saveError}
        </div>
      )}
      {saveResult && (
        <div style={{ ...styles.successBox, marginTop: "12px" }}>
          Inserted <strong>{saveResult.inserted || 0}</strong>
          {saveResult.updated ? (
            <>
              , updated <strong>{saveResult.updated}</strong>
            </>
          ) : null}{" "}
          of {saveResult.attempted} employee
          {saveResult.attempted === 1 ? "" : "s"}
          {saveResult.errors && saveResult.errors.length > 0 && (
            <ul style={{ margin: "8px 0 0", paddingLeft: "20px" }}>
              {saveResult.errors.map((e, i) => (
                <li key={i}>
                  {e.name || "(no name)"}: {e.issue}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );

  const renderStep4 = () => (
    <div style={styles.card}>
      <div style={styles.summary}>
        Restaurant:{" "}
        <strong style={{ color: theme.text }}>{selectedLabel}</strong>
        {" · "}month{" "}
        <strong style={{ color: theme.text }}>{month || "(unknown)"}</strong>
        {" · "}
        <strong style={{ color: theme.text }}>
          {allEmployees.length}
        </strong>{" "}
        employee{allEmployees.length === 1 ? "" : "s"}
        {loadingWages && " · loading wages…"}
      </div>

      {payrollWarnings && payrollWarnings.length > 0 && (
        <div
          style={{
            ...styles.errorBox,
            backgroundColor: "rgba(255, 193, 7, 0.12)",
            color: theme.text,
            borderColor: "#ffc107",
            marginTop: "12px",
            padding: "8px 12px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              cursor: "pointer",
              fontWeight: 600,
            }}
            onClick={() => setWarningsExpanded((v) => !v)}
          >
            <span>
              ⚠️ {payrollWarnings.length} row
              {payrollWarnings.length === 1 ? "" : "s"} with missing hourly wage
              (not global) — total left blank
            </span>
            <span style={{ fontSize: "0.85rem" }}>
              {warningsExpanded ? "▲ hide" : "▼ show"}
            </span>
          </div>
          {warningsExpanded && (
            <ul style={{ margin: "8px 0 0", paddingLeft: "20px" }}>
              {payrollWarnings.slice(0, 50).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
              {payrollWarnings.length > 50 && (
                <li>… and {payrollWarnings.length - 50} more</li>
              )}
            </ul>
          )}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginTop: "12px",
        }}
      >
        <input
          type="search"
          value={payrollSearch}
          onChange={(ev) => setPayrollSearch(ev.target.value)}
          placeholder="סינון לפי שם, מס' עובד או תפקיד…"
          style={{
            ...styles.select,
            flex: "1 1 auto",
            maxWidth: "360px",
            cursor: "text",
            direction: "rtl",
          }}
        />
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "0.9rem",
            color: theme.text,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
          title="הצג רק עובדים בעלי מס' עובד (ניתנים לייצוא)"
        >
          <input
            type="checkbox"
            checked={exportableOnly}
            onChange={(ev) => setExportableOnly(ev.target.checked)}
          />
          ניתן לייצוא בלבד
        </label>
        {(payrollSearch.trim() || exportableOnly) && (
          <span style={{ fontSize: "0.85rem", color: theme.textSecondary }}>
            {
              new Set(
                displayedPayrollRows
                  .filter((r) => !r.isGrandTotal)
                  .map((r) => r.name),
              ).size
            }{" "}
            מתוך{" "}
            {
              new Set(
                fullPayrollRows
                  .filter((r) => !r.isGrandTotal)
                  .map((r) => r.name),
              ).size
            }{" "}
            עובדים
          </span>
        )}
      </div>

      <div
        ref={payrollWrapRef}
        style={{ ...styles.tableWrapStep4, marginTop: "12px" }}
      >
        <table style={styles.tableStep4}>
          <thead>
            <tr>
              <th style={{ ...styles.th, ...styles.stickyNameTh }}>שם</th>
              <th style={{ ...styles.th, ...styles.stickyTh }}>מס' עובד</th>
              <th style={{ ...styles.th, ...styles.stickyTh }}>תפקיד</th>
              <th style={{ ...styles.th, ...styles.stickyTh }}>שכר שעתי</th>
              <th style={{ ...styles.th, ...styles.stickyTh }}>ימי עבודה</th>
              <th style={{ ...styles.th, ...styles.stickyTh }}>שעות 100%</th>
              <th style={{ ...styles.th, ...styles.stickyTh }}>שעות 125%</th>
              <th style={{ ...styles.th, ...styles.stickyTh }}>שעות 150%</th>
              <th style={{ ...styles.th, ...styles.stickyTh }}>הפסקות</th>
              <th style={{ ...styles.th, ...styles.stickyTh }}>נטו/ברוטו</th>
              <th style={{ ...styles.th, ...styles.stickyTh }}>טיפ</th>
              <th style={{ ...styles.th, ...styles.stickyTh }}>השלמה</th>
              <th style={{ ...styles.th, ...styles.stickyTh }}>נסיעות</th>
              <th style={{ ...styles.th, ...styles.stickyTh }}>עובד גלובאלי</th>
              <th style={{ ...styles.th, ...styles.stickyTh }}>מפרעה</th>
              <th style={{ ...styles.th, ...styles.stickyTh }}>סה"כ</th>
            </tr>
          </thead>
          <tbody>
            {displayedPayrollRows.map((r, i) => {
              const baseCell = r.isGrandTotal
                ? { ...styles.tdTotal, fontWeight: 700, fontSize: "0.95rem" }
                : r.isTotal
                  ? styles.tdTotal
                  : r.last
                    ? styles.tdEmpBoundary
                    : styles.td;
              const cell = flaggedNames.has(r.name)
                ? { ...baseCell, backgroundColor: "#ffcdd2", color: "#000" }
                : r.warn
                  ? { ...baseCell, backgroundColor: "#fff3cd", color: "#000" }
                  : baseCell;
              // Sticky-name cell inherits the row's row-state bg color so it
              // doesn't show through-content from columns scrolling beneath.
              const nameCell = {
                ...cell,
                ...styles.stickyNameCell,
                backgroundColor:
                  cell.backgroundColor || styles.stickyNameCell.backgroundColor,
              };
              if (r.isGrandTotal) {
                return (
                  <tr key={r.empKey + i}>
                    <td style={nameCell} colSpan={15}>
                      {r.role}
                    </td>
                    <td style={cell}>{fmtNum(r.total)}</td>
                  </tr>
                );
              }
              return (
                <tr key={r.empKey + i}>
                  <td style={nameCell}>{r.first ? r.name : ""}</td>
                  <td style={cell}>{r.first ? (r.empNumber ?? "") : ""}</td>
                  <td style={cell}>{r.role || ""}</td>
                  <td style={cell}>
                    {r.isTotal ? "" : r.wage != null ? fmtNum(r.wage) : ""}
                  </td>
                  <td style={cell}>
                    {r.first && r.workdays != null ? r.workdays : ""}
                  </td>
                  <td style={cell}>{fmtNum(r.h100)}</td>
                  <td style={cell}>{fmtNum(r.h125)}</td>
                  <td style={cell}>{fmtNum(r.h150)}</td>
                  <td style={cell}>{r.breaks ? fmtNum(r.breaks) : ""}</td>
                  <td style={cell}>
                    {r.first ? wageTypeLabel(r.wage_type) : ""}
                  </td>
                  <td style={cell}>{fmtNum(r.tip)}</td>
                  <td style={cell}>{fmtNum(r.completion)}</td>
                  <td style={cell}>
                    {r.first && r.travel != null
                      ? fmtNum(r.travel)
                      : fmtNum(r.travel)}
                  </td>
                  <td style={cell}>{r.first && r.global ? "כן" : ""}</td>
                  <td style={cell}>
                    {r.first && r.inAdvance != null && r.inAdvance !== ""
                      ? fmtNum(r.inAdvance)
                      : ""}
                  </td>
                  <td style={cell}>{r.total == null ? "" : fmtNum(r.total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginTop: "12px",
        }}
      >
        <button
          type="button"
          style={{
            ...styles.secondaryButton,
            marginRight: "8px",
            opacity: downloadingXlsx ? 0.7 : 1,
            cursor: downloadingXlsx ? "wait" : "pointer",
          }}
          onClick={handleDownloadXlsx}
          disabled={downloadingXlsx || allEmployees.length === 0}
        >
          {downloadingXlsx ? "Building…" : "XL download"}
        </button>
        <button
          type="button"
          style={{
            ...styles.primaryButton,
            opacity: savingPayroll ? 0.7 : 1,
            cursor: savingPayroll ? "wait" : "pointer",
          }}
          onClick={handleSavePayroll}
          disabled={savingPayroll || !month}
          title={!month ? "month not detected" : ""}
        >
          {savingPayroll ? "Saving…" : "Save payroll"}
        </button>
      </div>

      {downloadError && (
        <div style={{ ...styles.errorBox, marginTop: "12px" }}>
          <strong>Error:</strong> {downloadError}
        </div>
      )}
      {payrollError && (
        <div style={{ ...styles.errorBox, marginTop: "12px" }}>
          <strong>Error:</strong> {payrollError}
        </div>
      )}
      {payrollResult && (
        <div style={{ ...styles.successBox, marginTop: "12px" }}>
          Saved payroll for <strong>{payrollResult.inserted}</strong> of{" "}
          {payrollResult.attempted} · {payrollResult.month} ·{" "}
          {payrollResult.rest}
          {payrollResult.unresolved && payrollResult.unresolved.length > 0 && (
            <div style={{ marginTop: "8px" }}>
              Unresolved (no matching employee):
              <ul style={{ margin: "4px 0 0", paddingLeft: "20px" }}>
                {payrollResult.unresolved.map((u, i) => (
                  <li key={i}>
                    {u.name || "(no name)"}
                    {u.ID_nmbr ? ` · ID ${u.ID_nmbr}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderStepEmployeeData = () => (
    <div style={styles.card}>
      <div style={{ fontWeight: 600, fontSize: "1.05rem", marginBottom: 6 }}>
        Employee data (optional)
      </div>
      <p style={{ color: theme.textSecondary, marginBottom: 12 }}>
        Upload the Tabit "רשימת עובדים" .xlsx files (or any sheet whose header
        row has שם פרטי, שם משפחה and טלפון נייד). Phones get attached to
        employees of the current restaurant, matched by name. Inactive rows
        (פעיל ≠ פעיל) are skipped. You can also skip the whole step.
      </p>
      <div
        style={styles.dropZone}
        onClick={() => empDataFileRef.current?.click()}
        onDrop={handleEmpDataDrop}
        onDragOver={handleEmpDataDragOver}
        onDragLeave={handleEmpDataDragLeave}
        onDragEnter={handleEmpDataDragOver}
        role="button"
        tabIndex={0}
      >
        <div style={styles.dropZoneTitle}>
          {empDataIsDragging
            ? "Drop files here"
            : "Drag & drop .xlsx files here"}
        </div>
        <div style={styles.dropZoneHint}>or</div>
        <button
          type="button"
          style={styles.addBtn}
          onClick={(e) => {
            e.stopPropagation();
            empDataFileRef.current?.click();
          }}
        >
          Add file
        </button>
        <input
          ref={empDataFileRef}
          type="file"
          multiple
          accept=".xlsx"
          onChange={handleEmpDataFileInput}
          style={{ display: "none" }}
        />
      </div>
      {empDataFiles.length > 0 && (
        <ul style={{ ...styles.fileList, marginTop: "16px" }}>
          {empDataFiles.map(({ key, file }) => (
            <li key={key} style={styles.fileItem}>
              <div style={styles.fileMeta}>
                <div style={styles.fileName} title={file.name}>
                  {file.name}
                </div>
                <div style={styles.fileSize}>{formatBytes(file.size)}</div>
              </div>
              <button
                type="button"
                style={styles.deleteBtn}
                onClick={() => removeEmpDataFile(key)}
                disabled={empDataUploading}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      {empDataUploading && (
        <div style={{ marginTop: 12, color: theme.textSecondary }}>
          Attaching {empDataFiles.length} file
          {empDataFiles.length === 1 ? "" : "s"}…
        </div>
      )}
      {empDataError && (
        <div style={{ ...styles.errorBox, marginTop: 12 }}>
          <strong>Error:</strong> {empDataError}
        </div>
      )}
      {empDataResults.length > 0 && (
        <div
          style={{
            marginTop: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {empDataResults.map((r, idx) => {
            if (r.error) {
              return (
                <div key={idx} style={styles.errorBox}>
                  <strong>{r.file}:</strong> {r.error}
                </div>
              );
            }
            if (r.summary) {
              return (
                <div key={idx} style={styles.successBox}>
                  Attached <strong>{r.matchedNew}</strong> phone
                  {r.matchedNew === 1 ? "" : "s"} to new employees ·{" "}
                  <strong>{r.matchedExisting}</strong> existing employee row
                  {r.matchedExisting === 1 ? "" : "s"} matched
                  {r.dbUpdated > 0 && (
                    <>
                      {" "}
                      · <strong>{r.dbUpdated}</strong> phone
                      {r.dbUpdated === 1 ? "" : "s"} saved to DB
                    </>
                  )}
                  {r.unmatchedNew && r.unmatchedNew.length > 0 && (
                    <details style={{ marginTop: 6 }}>
                      <summary style={{ cursor: "pointer" }}>
                        Unmatched new employees ({r.unmatchedNew.length})
                      </summary>
                      <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                        {r.unmatchedNew.slice(0, 100).map((n, i) => (
                          <li key={i}>{n}</li>
                        ))}
                        {r.unmatchedNew.length > 100 && (
                          <li>…and {r.unmatchedNew.length - 100} more</li>
                        )}
                      </ul>
                    </details>
                  )}
                  {r.unmatchedExisting && r.unmatchedExisting.length > 0 && (
                    <details style={{ marginTop: 6 }}>
                      <summary style={{ cursor: "pointer" }}>
                        Unmatched existing employees (
                        {r.unmatchedExisting.length})
                      </summary>
                      <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                        {r.unmatchedExisting.slice(0, 100).map((n, i) => (
                          <li key={i}>{n}</li>
                        ))}
                        {r.unmatchedExisting.length > 100 && (
                          <li>…and {r.unmatchedExisting.length - 100} more</li>
                        )}
                      </ul>
                    </details>
                  )}
                </div>
              );
            }
            return (
              <div key={idx} style={styles.successBox}>
                <strong>{r.file}</strong>: parsed {r.parsed} row
                {r.parsed === 1 ? "" : "s"} · kept {r.kept} · dropped{" "}
                {r.dropped || 0}
                {r.headerRow ? ` · header row ${r.headerRow}` : ""}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const stepRenderers = {
    1: renderStep1,
    2: renderStep2,
    3: renderStepEmployeeData,
    4: renderStep3,
    5: renderStep4,
  };

  const renderLaborDialog = () => {
    if (!showLaborDialog) return null;
    const [y, m] = (month || "").split("-").map((n) => parseInt(n, 10));
    const daysInMonth =
      Number.isFinite(y) && Number.isFinite(m)
        ? new Date(y, m, 0).getDate()
        : 31;
    const byDay = new Map();
    for (const it of laborSummary?.items || []) {
      const d = parseInt(String(it.date || "").slice(-2), 10);
      if (Number.isFinite(d)) byDay.set(d, it);
    }
    const chartData = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const it = byDay.get(d);
      chartData.push({
        day: d,
        percentage: it && it.percentage != null ? Number(it.percentage) : 0,
        labor_cost: it ? Number(it.labor_cost || 0) : 0,
        total: it ? Number(it.total || 0) : 0,
      });
    }
    const totals = laborSummary?.totals || {
      total: 0,
      labor_cost: 0,
      percentage: null,
    };
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0,0,0,0.55)",
          zIndex: 2100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
        }}
        onClick={() => setShowLaborDialog(false)}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            backgroundColor: theme.surface,
            color: theme.text,
            borderRadius: "10px",
            padding: "20px",
            width: "100%",
            maxWidth: "900px",
            maxHeight: "90vh",
            overflowY: "auto",
            boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "12px",
            }}
          >
            <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>
              Labor cost · {selectedLabel || ""} · {month || ""}
            </div>
            <button
              type="button"
              onClick={() => setShowLaborDialog(false)}
              aria-label="Close"
              style={{
                background: "none",
                border: "none",
                color: theme.text,
                cursor: "pointer",
                fontSize: "1.4rem",
                lineHeight: 1,
                padding: "2px 8px",
              }}
            >
              ×
            </button>
          </div>

          {loadingLaborSummary && (
            <div style={{ padding: "20px 0", color: theme.textSecondary }}>
              Loading labor cost summary…
            </div>
          )}
          {laborSummaryError && (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: "6px",
                backgroundColor: theme.errorBg || "rgba(229,57,53,0.1)",
                color: theme.error || "#e53935",
                border: `1px solid ${theme.errorBorder || "#e53935"}`,
                marginBottom: "12px",
              }}
            >
              <strong>Error:</strong> {laborSummaryError}
            </div>
          )}

          {!loadingLaborSummary && !laborSummaryError && (
            <>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "16px",
                  marginBottom: "12px",
                  fontSize: "0.95rem",
                }}
              >
                <div>
                  <span style={{ color: theme.textSecondary }}>
                    Total income:
                  </span>{" "}
                  <strong>{Math.round(totals.total).toLocaleString()}</strong>
                </div>
                <div>
                  <span style={{ color: theme.textSecondary }}>
                    Total labor cost:
                  </span>{" "}
                  <strong>
                    {Math.round(totals.labor_cost).toLocaleString()}
                  </strong>
                </div>
                <div>
                  <span style={{ color: theme.textSecondary }}>
                    Labor cost %:
                  </span>{" "}
                  <strong>
                    {totals.percentage == null
                      ? "—"
                      : `${totals.percentage.toFixed(2)}%`}
                  </strong>
                </div>
              </div>

              <div style={{ width: "100%", height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    margin={{ top: 10, right: 20, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={theme.border}
                    />
                    <XAxis
                      dataKey="day"
                      tick={{ fill: theme.text, fontSize: 12 }}
                      label={{
                        value: "Day of month",
                        position: "insideBottom",
                        offset: -2,
                        fill: theme.textSecondary,
                      }}
                    />
                    <YAxis
                      tick={{ fill: theme.text, fontSize: 12 }}
                      tickFormatter={(v) => `${v}%`}
                      label={{
                        value: "Labor cost %",
                        angle: -90,
                        position: "insideLeft",
                        fill: theme.textSecondary,
                      }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: theme.surface,
                        border: `1px solid ${theme.border}`,
                        color: theme.text,
                      }}
                      formatter={(value, name, ctx) => {
                        if (name === "percentage") {
                          return [`${Number(value).toFixed(2)}%`, "Labor %"];
                        }
                        return [value, name];
                      }}
                      labelFormatter={(d) => `Day ${d}`}
                    />
                    <Bar
                      dataKey="percentage"
                      fill={theme.active || "#2196f3"}
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          <div
            style={{
              marginTop: "16px",
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            <button
              type="button"
              onClick={() => setShowLaborDialog(false)}
              style={{
                padding: "8px 16px",
                fontSize: "0.95rem",
                fontWeight: 600,
                border: `1px solid ${theme.border}`,
                borderRadius: "6px",
                backgroundColor: theme.active || "#2196f3",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderMicpalMissingDialog = () => {
    const hasMissing = micpalMissing && micpalMissing.length > 0;
    const hasContractors = skippedContractors && skippedContractors.length > 0;
    if (!hasMissing && !hasContractors) return null;
    const closeDialog = () => {
      setMicpalMissing(null);
      setSkippedContractors(null);
    };
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0,0,0,0.55)",
          zIndex: 2100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
        }}
        onClick={closeDialog}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            backgroundColor: theme.surface,
            color: theme.text,
            borderRadius: "10px",
            padding: "20px",
            width: "100%",
            maxWidth: "560px",
            maxHeight: "80vh",
            overflowY: "auto",
            boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "12px",
            }}
          >
            <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>
              עובדים שלא יוצאו
            </div>
            <button
              type="button"
              onClick={closeDialog}
              aria-label="Close"
              style={{
                background: "none",
                border: "none",
                color: theme.text,
                cursor: "pointer",
                fontSize: "1.4rem",
                lineHeight: 1,
                padding: "2px 8px",
              }}
            >
              ×
            </button>
          </div>
          {(() => {
            const th = {
              textAlign: "right",
              padding: "6px 8px",
              borderBottom: `1px solid ${theme.border}`,
            };
            const td = {
              padding: "6px 8px",
              borderBottom: `1px solid ${theme.border}`,
            };
            const section = (title, note, rows) => (
              <div style={{ marginBottom: "14px" }}>
                <div style={{ fontWeight: 600, marginBottom: "4px" }}>
                  {title} ({rows.length})
                </div>
                <div
                  style={{
                    fontSize: "0.9rem",
                    color: theme.textSecondary,
                    marginBottom: "8px",
                  }}
                >
                  {note}
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={th}>שם</th>
                      <th style={th}>ת"ז</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((m, i) => (
                      <tr key={i}>
                        <td style={td}>{m.name || "—"}</td>
                        <td style={td}>{m.ID_nmbr || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
            return (
              <>
                {hasContractors &&
                  section(
                    "קבלנים שדולגו",
                    "עובדים המסומנים כקבלן — לא נכללים בקובץ הייצוא.",
                    skippedContractors,
                  )}
                {hasMissing &&
                  section(
                    "חסר מספר עובד",
                    "אין מספר עובד (מס עובד) — דולגו בייצוא.",
                    micpalMissing,
                  )}
              </>
            );
          })()}
        </div>
      </div>
    );
  };

  return (
    <div style={styles.container}>
      {renderLaborDialog()}
      {renderMicpalMissingDialog()}
      {savingPayroll && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.45)",
            zIndex: 2000,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: "1.1rem",
            gap: "12px",
          }}
          role="status"
          aria-live="polite"
        >
          <div
            style={{
              width: "44px",
              height: "44px",
              border: "4px solid rgba(255,255,255,0.3)",
              borderTopColor: "#fff",
              borderRadius: "50%",
              animation: "spin 0.9s linear infinite",
            }}
          />
          <div>Calculating daily labor cost and saving payroll…</div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
      {renderStepper()}
      <div style={styles.body}>
        {stepRenderers[step]()}

        <div style={styles.nav}>
          <button
            type="button"
            style={{
              ...styles.secondaryButton,
              visibility: step > 1 ? "visible" : "hidden",
            }}
            onClick={goBack}
          >
            ← Back
          </button>
          {step < 5 && (
            <button
              type="button"
              style={{
                ...styles.primaryButton,
                opacity: !canAdvance() || processing || loadingWages ? 0.5 : 1,
                cursor:
                  !canAdvance() || processing || loadingWages
                    ? "not-allowed"
                    : "pointer",
              }}
              onClick={goNext}
              disabled={!canAdvance() || processing || loadingWages}
            >
              {processing
                ? "Processing…"
                : loadingWages
                  ? "Loading…"
                  : "Next →"}
            </button>
          )}
        </div>
      </div>

      {wageDialog &&
        (() => {
          const emp = newEmployees[wageDialog.empIdx];
          if (!emp) return null;
          const isRole = wageDialog.roleIdx != null;
          const target = isRole ? emp.roles?.[wageDialog.roleIdx] : emp;
          if (!target) return null;
          return (
            <WageDialog
              title={
                isRole
                  ? `Role wage · ${target.role || ""} (${emp.name || "(no name)"})`
                  : `Set wage for ${emp.name || "(no name)"}`
              }
              value={{
                new_wage_type: target.new_wage_type || "",
                wage: target.wage ?? "",
              }}
              allowClear={isRole}
              onClose={() => setWageDialog(null)}
              onSave={(next) => {
                if (isRole) {
                  updateRoleWage(wageDialog.empIdx, wageDialog.roleIdx, next);
                } else {
                  updateWageFields(wageDialog.empIdx, next);
                }
              }}
            />
          );
        })()}
    </div>
  );
};

export default Shifts;
