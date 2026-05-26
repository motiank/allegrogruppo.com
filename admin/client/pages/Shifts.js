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
const MIN_HOURLY_WAGE = 34.42;

// Build a per-employee record map keyed by ID_nmbr / name.
// Each entry: { roles: { role: wage }, hourly_wage, wage_type, global, travel }
const buildWageMap = (employeesFromDb) => {
  const map = new Map();
  for (const e of employeesFromDb || []) {
    const roleWage = {};
    for (const r of e.roles || []) {
      if (r && r.role) roleWage[r.role] = r.wage;
    }
    const rec = {
      roles: roleWage,
      hourly_wage: e.hourly_wage == null ? null : Number(e.hourly_wage),
      wage_type: e.wage_type || null,
      global: e.global == null ? null : Number(e.global),
      travel: e.travel == null ? null : Number(e.travel),
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

// Wage resolution per spec:
//   1. role-level wage from employees.roles JSON
//   2. fallback: employees.hourly_wage
//   3. -1 → 34.42 (national minimum)
const resolveHourlyWage = (empData, role) => {
  let wage = empData?.roles?.[role];
  if (wage == null) wage = empData?.hourly_wage;
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
        global: "",
        hourly_wage: "",
        wage_type: "",
        travel: "",
        contractor: false,
        roles: (e.roles || []).map((role) => ({ role, wage: "" })),
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
  const updateWage = (empIdx, roleIdx, wage) => {
    setNewEmployees((prev) => {
      const next = prev.slice();
      const emp = { ...next[empIdx] };
      emp.roles = emp.roles.slice();
      emp.roles[roleIdx] = { ...emp.roles[roleIdx], wage };
      next[empIdx] = emp;
      return next;
    });
  };

  const updateGlobal = (empIdx, val) => {
    setNewEmployees((prev) => {
      const next = prev.slice();
      next[empIdx] = { ...next[empIdx], global: val };
      return next;
    });
  };

  const updateHourlyWage = (empIdx, val) => {
    setNewEmployees((prev) => {
      const next = prev.slice();
      next[empIdx] = { ...next[empIdx], hourly_wage: val };
      return next;
    });
  };

  const updateWageType = (empIdx, val) => {
    setNewEmployees((prev) => {
      const next = prev.slice();
      next[empIdx] = { ...next[empIdx], wage_type: val };
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

  const [diffSummary, setDiffSummary] = useState(null);

  const buildDiff = useCallback(async () => {
    if (!selectedRestaurant) return [];
    const dbRes = await axios.post(
      "/admin/payroll/wages",
      { rest: selectedRestaurant, scope: "all" },
      { withCredentials: true },
    );
    const dbByName = new Map();
    for (const e of dbRes.data?.employees || []) {
      dbByName.set((e.name || "").trim(), e);
    }

    const inserts = [];
    const updates = [];
    let existing = 0;
    const seen = new Set();

    // allEmployees has shift data + phones (merged in Step 3)
    for (const emp of [...newEmployees, ...allEmployees]) {
      const name = (emp.name || "").trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const db = dbByName.get(name);
      if (!db) {
        inserts.push({
          rest: selectedRestaurant,
          name,
          ID_nmbr: emp.ID_nmbr || null,
          phone: emp.phone || null,
          roles: emp.roles || [],
          global: emp.global,
          hourly_wage: emp.hourly_wage,
          wage_type: emp.wage_type,
          travel: emp.travel,
          contractor: !!emp.contractor,
          t101: false,
        });
      } else {
        const needsPhone = emp.phone && !db.phone;
        const needsId = emp.ID_nmbr && !db.ID_nmbr;
        if (needsPhone || needsId) {
          updates.push({
            rest: selectedRestaurant,
            name,
            ID_nmbr: emp.ID_nmbr || db.ID_nmbr || null,
            phone: emp.phone || db.phone || null,
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
      existing,
    });
    setDiffSummary({
      inserts: inserts.length,
      updates: updates.length,
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
        flaggedEmployees: Array.from(flaggedNames),
        employees: allEmployees.map((e) => {
          const empData = lookupEmpData(wageMap, e);
          const wages = {};
          for (const role of Object.keys(e.payroll_data || {})) {
            const w = empData?.roles?.[role];
            if (w != null) wages[role] = Number(w);
          }
          return {
            name: e.name,
            ID_nmbr: e.ID_nmbr,
            payroll_data: e.payroll_data || {},
            role_extras: e.role_extras || {},
            workdays: e.workdays,
            global: e.global,
            wages,
            // Per-employee DB fields for wage resolution + display
            hourly_wage: empData?.hourly_wage ?? null,
            wage_type: empData?.wage_type ?? null,
            global_amount: empData?.global ?? null,
            travel: empData?.travel ?? null,
          };
        }),
      };
      const res = await axios.post("/admin/payroll/export-xlsx", payload, {
        withCredentials: true,
        responseType: "blob",
      });
      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payroll_summary_${month || "month"}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error("export-xlsx error:", err);
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
      const empTravel =
        empData && empData.travel != null ? Number(empData.travel) : null;

      const roleEntries = Object.entries(emp.payroll_data || {});

      const roleRows = roleEntries.map(([role, payload]) => {
        const hours = (payload && payload.hours) || [];
        const [h100 = 0, h125 = 0, h150 = 0] = hours;
        const tip = Number((payload && payload.tip) || 0);
        const completion = Number((payload && payload.completion) || 0);
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
          workdays: emp.workdays,
          global: emp.global,
          wage_type: wageType,
          travel: empTravel,
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
          workdays: emp.workdays,
          global: emp.global,
          wage_type: wageType,
          travel: empTravel,
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
      maxWidth: "1400px",
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
            to update ·{" "}
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
        <div style={{ ...styles.tableWrap, marginTop: "12px" }}>
          <table style={{ ...styles.table, ...styles.ltrTable }}>
            <thead>
              <tr>
                <th style={styles.th}>name</th>
                <th style={styles.th}>ID_nmbr</th>
                <th style={styles.th}>global wage</th>
                <th style={styles.th}>hourly_wage</th>
                <th style={styles.th}>wage_type</th>
                <th style={styles.th}>travel</th>
                <th style={styles.th}>contractor</th>
                <th style={styles.th}>role</th>
                <th style={styles.th}>role wage</th>
              </tr>
            </thead>
            <tbody>
              {newEmployees.flatMap((emp, empIdx) => {
                const roles =
                  emp.roles && emp.roles.length > 0
                    ? emp.roles
                    : [{ role: "", wage: "" }];
                return roles.map((r, roleIdx) => {
                  const isFirst = roleIdx === 0;
                  const isLast = roleIdx === roles.length - 1;
                  const cellStyle = isLast ? styles.tdEmpBoundary : styles.td;
                  return (
                    <tr key={`${empIdx}-${roleIdx}`}>
                      {isFirst ? (
                        <>
                          <td
                            rowSpan={roles.length}
                            style={styles.tdEmpBoundary}
                          >
                            {emp.name || "—"}
                          </td>
                          <td
                            rowSpan={roles.length}
                            style={styles.tdEmpBoundary}
                          >
                            {emp.ID_nmbr || "—"}
                          </td>
                          <td
                            rowSpan={roles.length}
                            style={styles.tdEmpBoundary}
                          >
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="—"
                              style={styles.wageInput}
                              value={emp.global || ""}
                              onChange={(ev) =>
                                updateGlobal(empIdx, ev.target.value)
                              }
                            />
                          </td>
                          <td
                            rowSpan={roles.length}
                            style={styles.tdEmpBoundary}
                          >
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="—"
                              style={styles.wageInput}
                              value={emp.hourly_wage || ""}
                              onChange={(ev) =>
                                updateHourlyWage(empIdx, ev.target.value)
                              }
                            />
                          </td>
                          <td
                            rowSpan={roles.length}
                            style={styles.tdEmpBoundary}
                          >
                            <select
                              style={styles.wageInput}
                              value={emp.wage_type || ""}
                              onChange={(ev) =>
                                updateWageType(empIdx, ev.target.value)
                              }
                            >
                              <option value="">—</option>
                              <option value="gross">gross</option>
                              <option value="net">net</option>
                            </select>
                          </td>
                          <td
                            rowSpan={roles.length}
                            style={styles.tdEmpBoundary}
                          >
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="—"
                              style={styles.wageInput}
                              value={emp.travel || ""}
                              onChange={(ev) =>
                                updateTravel(empIdx, ev.target.value)
                              }
                            />
                          </td>
                          <td
                            rowSpan={roles.length}
                            style={styles.tdEmpBoundary}
                          >
                            <button
                              type="button"
                              aria-pressed={!!emp.contractor}
                              onClick={() => toggleContractor(empIdx)}
                              style={
                                emp.contractor
                                  ? styles.toggleButtonActive
                                  : styles.toggleButton
                              }
                              title="Mark as contractor (קבלן)"
                            >
                              {emp.contractor ? "קבלן" : "שכיר"}
                            </button>
                          </td>
                        </>
                      ) : null}
                      <td style={cellStyle}>{r.role || "—"}</td>
                      <td style={cellStyle}>
                        {r.role ? (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="—"
                            style={styles.wageInput}
                            value={r.wage}
                            onChange={(e) =>
                              updateWage(empIdx, roleIdx, e.target.value)
                            }
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
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

      <div style={{ ...styles.tableWrapStep4, marginTop: "12px" }}>
        <table style={styles.tableStep4}>
          <thead>
            <tr>
              <th style={{ ...styles.th, ...styles.stickyNameTh }}>שם</th>
              <th style={{ ...styles.th, ...styles.stickyTh }}>תפקיד</th>
              <th style={{ ...styles.th, ...styles.stickyTh }}>שכר שעתי</th>
              <th style={{ ...styles.th, ...styles.stickyTh }}>ימי עבודה</th>
              <th style={{ ...styles.th, ...styles.stickyTh }}>שעות 100%</th>
              <th style={{ ...styles.th, ...styles.stickyTh }}>שעות 125%</th>
              <th style={{ ...styles.th, ...styles.stickyTh }}>שעות 150%</th>
              <th style={{ ...styles.th, ...styles.stickyTh }}>נטו/ברוטו</th>
              <th style={{ ...styles.th, ...styles.stickyTh }}>טיפ</th>
              <th style={{ ...styles.th, ...styles.stickyTh }}>השלמה</th>
              <th style={{ ...styles.th, ...styles.stickyTh }}>נסיעות</th>
              <th style={{ ...styles.th, ...styles.stickyTh }}>עובד גלובאלי</th>
              <th style={{ ...styles.th, ...styles.stickyTh }}>סה"כ</th>
            </tr>
          </thead>
          <tbody>
            {fullPayrollRows.map((r, i) => {
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
                    <td style={nameCell} colSpan={12}>
                      {r.role}
                    </td>
                    <td style={cell}>{fmtNum(r.total)}</td>
                  </tr>
                );
              }
              return (
                <tr key={r.empKey + i}>
                  <td style={nameCell}>{r.first ? r.name : ""}</td>
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

  return (
    <div style={styles.container}>
      {renderLaborDialog()}
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
    </div>
  );
};

export default Shifts;
