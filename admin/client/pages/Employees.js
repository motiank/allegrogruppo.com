import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import axios from "axios";
import { useTheme } from "../context/ThemeContext";
import {
  RESTAURANT_GROUPS,
  findRestaurantLabel,
  filterRestaurantGroups,
} from "../constants/restaurants";
import useCurrentUser from "../hooks/useCurrentUser";

const Employees = () => {
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [search, setSearch] = useState("");
  const [viewFilter, setViewFilter] = useState("active");
  // Frozen set of employee_ids currently visible under the "missing wages"
  // filter. Recomputed only when the user changes the filter, reloads, or
  // clicks Update — so editing a wage doesn't make the row vanish.
  const [missingFrozenIds, setMissingFrozenIds] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [menuOpenFor, setMenuOpenFor] = useState(null);
  const [removingId, setRemovingId] = useState(null);
  const [duplicateDialogFor, setDuplicateDialogFor] = useState(null);
  const [duplicateSearch, setDuplicateSearch] = useState("");
  const [markingDuplicateId, setMarkingDuplicateId] = useState(null);
  const [micpalSyncing, setMicpalSyncing] = useState(false);
  const [micpalResult, setMicpalResult] = useState(null);
  const [micpalError, setMicpalError] = useState(null);
  const micpalFileInputRef = useRef(null);
  // Wage dialog: { empIdx, new_wage_type, wage } when open, null otherwise.
  const [wageDialog, setWageDialog] = useState(null);

  const WAGE_TYPE_OPTIONS = [
    { value: "global_gross", label: "Global · Gross" },
    { value: "global_net", label: "Global · Net" },
    { value: "hourly_gross", label: "Hourly · Gross" },
    { value: "hourly_net", label: "Hourly · Net" },
    { value: "hourly_min_gross", label: "Hourly min · Gross" },
    { value: "hourly_min_net", label: "Hourly min · Net" },
  ];
  const wageTypeLabel = (t) =>
    WAGE_TYPE_OPTIONS.find((o) => o.value === t)?.label || "";
  const isMinWageType = (t) =>
    t === "hourly_min_gross" || t === "hourly_min_net";
  const formatWageCell = (emp) => {
    if (!emp.new_wage_type) return "—";
    const label = wageTypeLabel(emp.new_wage_type);
    return emp.wage !== "" && emp.wage != null
      ? `${emp.wage} · ${label}`
      : label;
  };

  useEffect(() => {
    if (menuOpenFor == null) return;
    const close = () => setMenuOpenFor(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpenFor]);

  const selectedLabel = useMemo(
    () => findRestaurantLabel(selectedRestaurant),
    [selectedRestaurant],
  );

  const hasWageValue = (v) => {
    if (v == null) return false;
    const s = String(v).trim();
    if (!s) return false;
    const n = Number(s);
    return Number.isFinite(n);
  };

  const isActive = (emp) => emp.active !== false && emp.duplicate == null;
  const isRemoved = (emp) => emp.active === false;
  const isDuplicate = (emp) => emp.duplicate != null;
  // "Has a wage" means there's a new_wage_type set AND either a wage value
  // (which can be -1 for hourly_min_*) or the type itself implies one.
  const hasResolvedWage = (emp) =>
    !!emp.new_wage_type && hasWageValue(emp.wage);
  const matchesMissingFilter = (emp) => isActive(emp) && !hasResolvedWage(emp);

  const counts = useMemo(() => {
    let active = 0;
    let missing = 0;
    let removed = 0;
    let dup = 0;
    for (const e of employees) {
      if (isActive(e)) active += 1;
      if (matchesMissingFilter(e)) missing += 1;
      if (isRemoved(e)) removed += 1;
      if (isDuplicate(e)) dup += 1;
    }
    return { active, missing, removed, duplicate: dup };
  }, [employees]);

  // (Re)build the frozen "missing wages" set whenever:
  //   - the filter switches to / away from "missing"
  //   - the employees list is reloaded for a different restaurant
  // The set is *not* rebuilt on every edit, so a row stays visible while the
  // user types wages — only handleUpdate refreshes it after a successful save.
  useEffect(() => {
    if (viewFilter !== "missing") {
      if (missingFrozenIds !== null) setMissingFrozenIds(null);
      return;
    }
    if (missingFrozenIds == null) {
      const ids = new Set();
      for (const e of employees) {
        if (matchesMissingFilter(e)) ids.add(e.employee_id);
      }
      setMissingFrozenIds(ids);
    }
    // intentionally not depending on `employees` — we don't want edits to
    // shrink the frozen set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewFilter]);

  const filteredEmployees = useMemo(() => {
    const indexed = employees.map((emp, origIdx) => ({ emp, origIdx }));
    const q = search.trim().toLowerCase();
    let result = indexed;
    if (viewFilter === "active") {
      result = result.filter(({ emp }) => isActive(emp));
    } else if (viewFilter === "missing") {
      // Use the frozen set when present so editing a wage doesn't make
      // the row disappear immediately.
      if (missingFrozenIds) {
        result = result.filter(({ emp }) =>
          missingFrozenIds.has(emp.employee_id),
        );
      } else {
        result = result.filter(({ emp }) => matchesMissingFilter(emp));
      }
    } else if (viewFilter === "removed") {
      result = result.filter(({ emp }) => isRemoved(emp));
    } else if (viewFilter === "duplicate") {
      result = result.filter(({ emp }) => isDuplicate(emp));
    }
    if (q) {
      result = result.filter(({ emp }) => {
        const haystack = [
          emp.name,
          emp.company,
          emp.ID_nmbr,
          emp.phone,
          emp.employee_id,
          emp.new_wage_type,
          ...(emp.roles || []).map((r) => r.role),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      });
    }
    return result;
  }, [employees, search, viewFilter, missingFrozenIds]);

  const loadEmployees = useCallback(async (rest) => {
    if (!rest) {
      setEmployees([]);
      return;
    }
    setLoading(true);
    setError(null);
    setSaveResult(null);
    setSaveError(null);
    setDirty(false);
    setSearch("");
    setViewFilter("active");
    setMissingFrozenIds(null);
    try {
      const res = await axios.post(
        "/admin/payroll/wages",
        { rest, scope: "all" },
        { withCredentials: true },
      );
      const list = (res.data?.employees || [])
        .slice()
        .sort((a, b) => (a.name || "").localeCompare(b.name || "", "he"));
      const shaped = list.map((e) => ({
        employee_id: e.employee_id,
        company: e.company || "",
        ID_nmbr: e.ID_nmbr,
        phone: e.phone || "",
        name: e.name,
        new_wage_type: e.new_wage_type || "",
        wage: e.wage == null ? "" : String(e.wage),
        travel: e.travel == null ? "" : String(e.travel),
        maxTravel: e.maxTravel == null ? "" : String(e.maxTravel),
        contractor: !!e.contractor,
        active: e.active !== false,
        duplicate: e.duplicate == null ? null : Number(e.duplicate),
        roles:
          e.roles && e.roles.length > 0
            ? e.roles.map((r) => ({
                role: r.role,
                wage: r.wage == null ? "" : String(r.wage),
              }))
            : [],
      }));
      setEmployees(shaped);
    } catch (err) {
      setError(
        err.response?.data?.error || err.message || "Failed to load employees",
      );
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEmployees(selectedRestaurant);
  }, [selectedRestaurant, loadEmployees]);

  const updateWage = (empIdx, roleIdx, wage) => {
    setEmployees((prev) => {
      const next = prev.slice();
      const emp = { ...next[empIdx] };
      emp.roles = emp.roles.slice();
      emp.roles[roleIdx] = { ...emp.roles[roleIdx], wage };
      next[empIdx] = emp;
      return next;
    });
    setDirty(true);
    setSaveResult(null);
  };

  const updateWageFields = (empIdx, { new_wage_type, wage }) => {
    setEmployees((prev) => {
      const next = prev.slice();
      next[empIdx] = { ...next[empIdx], new_wage_type, wage };
      return next;
    });
    setDirty(true);
    setSaveResult(null);
  };

  const updateTravel = (empIdx, val) => {
    setEmployees((prev) => {
      const next = prev.slice();
      next[empIdx] = { ...next[empIdx], travel: val };
      return next;
    });
    setDirty(true);
    setSaveResult(null);
  };

  const updateMaxTravel = (empIdx, val) => {
    setEmployees((prev) => {
      const next = prev.slice();
      next[empIdx] = { ...next[empIdx], maxTravel: val };
      return next;
    });
    setDirty(true);
    setSaveResult(null);
  };

  const toggleContractor = (empIdx) => {
    setEmployees((prev) => {
      const next = prev.slice();
      next[empIdx] = { ...next[empIdx], contractor: !next[empIdx].contractor };
      return next;
    });
    setDirty(true);
    setSaveResult(null);
  };

  const handleMicpalPick = () => {
    if (micpalSyncing || !selectedRestaurant) return;
    setMicpalResult(null);
    setMicpalError(null);
    if (micpalFileInputRef.current) {
      micpalFileInputRef.current.value = "";
      micpalFileInputRef.current.click();
    }
  };

  const handleMicpalFileChange = async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    if (!selectedRestaurant) {
      setMicpalError("select a restaurant first");
      return;
    }
    setMicpalSyncing(true);
    setMicpalResult(null);
    setMicpalError(null);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      fd.append("rest", selectedRestaurant);
      const res = await axios.post("/admin/payroll/micpal/sync", fd, {
        withCredentials: true,
      });
      setMicpalResult(res.data);
    } catch (err) {
      setMicpalError(err.response?.data?.error || err.message || "Sync failed");
    } finally {
      setMicpalSyncing(false);
    }
  };

  // ---------- Match dialog (employees ↔ micpal) ----------
  const normalizeName = (s) =>
    String(s == null ? "" : s)
      .trim()
      .replace(/\s+/g, " ");

  const buildMicpalNameIndex = useCallback((rows) => {
    const idx = new Map();
    for (const m of rows || []) {
      const n = normalizeName(m.name);
      const f = normalizeName(m.family);
      if (!n && !f) continue;
      const keys = new Set();
      if (n && f) {
        keys.add(`${n} ${f}`);
        keys.add(`${f} ${n}`);
      } else if (n) {
        keys.add(n);
      } else if (f) {
        keys.add(f);
      }
      for (const k of keys) {
        const arr = idx.get(k) || [];
        arr.push(m);
        idx.set(k, arr);
      }
    }
    return idx;
  }, []);

  // Returns [{ keyName, name, family, ID_nmbr, score }, …] for a single
  // employee against the micpal index. Only score=100 matches.
  const searchMicpal = (index, employeeName) => {
    const key = normalizeName(employeeName);
    if (!key) return [];
    return (index.get(key) || []).map((m) => ({
      keyName: m.keyName,
      name: m.name,
      family: m.family,
      ID_nmbr: m.ID_nmbr,
      score: 100,
    }));
  };

  // Scored search used by the manual-match panel. Walks the full list and
  // returns rows with score > 0:
  //   100 — exact (name+family or family+name) == query
  //    80 — all query tokens appear in (name + " " + family)
  //    50 — at least one query token appears in (name + " " + family)
  const searchMicpalScored = (list, query) => {
    const q = normalizeName(query).toLowerCase();
    if (!q) return [];
    const tokens = q.split(/\s+/).filter(Boolean);
    const out = [];
    for (const m of list || []) {
      const n = normalizeName(m.name).toLowerCase();
      const f = normalizeName(m.family).toLowerCase();
      const idStr = String(m.ID_nmbr || "").trim();
      const a = `${n} ${f}`.trim();
      const b = `${f} ${n}`.trim();
      let score = 0;
      if (q === a || q === b) score = 100;
      else if (idStr && idStr.includes(q)) score = 90;
      else {
        const combined = `${n} ${f}`;
        let hit = 0;
        for (const t of tokens) {
          if (combined.includes(t) || idStr.includes(t)) hit += 1;
        }
        if (hit > 0) score = hit === tokens.length ? 80 : 50;
      }
      if (score > 0) out.push({ ...m, score });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  };

  const [matchDialogOpen, setMatchDialogOpen] = useState(false);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState(null);
  const [matchRows, setMatchRows] = useState([]); // perfect matches
  const [matchSelected, setMatchSelected] = useState({}); // employee_id -> bool
  const [matchUpdating, setMatchUpdating] = useState(false);
  const [matchResult, setMatchResult] = useState(null);
  const [matchMode, setMatchMode] = useState("perfect"); // 'perfect' | 'manual'
  const [micpalList, setMicpalList] = useState([]);
  const [selectedManualEmp, setSelectedManualEmp] = useState(null);
  const [manualSearch, setManualSearch] = useState("");
  const [manualSelectedKeyName, setManualSelectedKeyName] = useState(null);

  const manualUnmatched = useMemo(
    () =>
      employees.filter(
        (e) =>
          e.active !== false &&
          e.duplicate == null &&
          !(e.ID_nmbr && String(e.ID_nmbr).trim()),
      ),
    [employees],
  );

  const manualResults = useMemo(() => {
    if (!manualSearch.trim()) return [];
    return searchMicpalScored(micpalList, manualSearch).slice(0, 200);
  }, [micpalList, manualSearch]);

  const openMatchDialog = async () => {
    if (matchLoading) return;
    setMatchDialogOpen(true);
    setMatchLoading(true);
    setMatchError(null);
    setMatchRows([]);
    setMatchSelected({});
    setMatchResult(null);
    setMatchMode("perfect");
    setSelectedManualEmp(null);
    setManualSearch("");
    setManualSelectedKeyName(null);
    try {
      const res = await axios.post(
        "/admin/payroll/micpal/list",
        { rest: selectedRestaurant },
        { withCredentials: true },
      );
      const micpal = res.data?.rows || [];
      setMicpalList(micpal);
      const index = buildMicpalNameIndex(micpal);

      // Restrict to active, non-duplicate employees missing ID_nmbr.
      const candidates = employees.filter(
        (e) =>
          e.active !== false &&
          e.duplicate == null &&
          !(e.ID_nmbr && String(e.ID_nmbr).trim()),
      );

      const perfect = [];
      for (const emp of candidates) {
        const matches = searchMicpal(index, emp.name);
        const valid = matches.filter(
          (m) => m.ID_nmbr && String(m.ID_nmbr).trim(),
        );
        if (valid.length === 1) {
          perfect.push({ emp, match: valid[0] });
        }
      }
      setMatchRows(perfect);
      const sel = {};
      for (const row of perfect) sel[row.emp.employee_id] = true;
      setMatchSelected(sel);
      // No perfect matches → drop straight into the manual tool.
      if (perfect.length === 0) setMatchMode("manual");
    } catch (err) {
      setMatchError(
        err.response?.data?.error || err.message || "Failed to load micpal",
      );
    } finally {
      setMatchLoading(false);
    }
  };

  const pickManualEmp = (emp) => {
    setSelectedManualEmp(emp);
    setManualSearch(emp?.name || "");
    setManualSelectedKeyName(null);
  };

  const handleManualUpdate = async () => {
    if (matchUpdating) return;
    if (!selectedManualEmp || !manualSelectedKeyName) return;
    const chosen = manualResults.find(
      (m) => m.keyName === manualSelectedKeyName,
    );
    if (!chosen || !chosen.ID_nmbr) return;
    setMatchUpdating(true);
    setMatchError(null);
    setMatchResult(null);
    try {
      const res = await axios.post(
        "/admin/payroll/employees/set-id-nmbr",
        {
          updates: [
            {
              employee_id: selectedManualEmp.employee_id,
              ID_nmbr: chosen.ID_nmbr,
            },
          ],
        },
        { withCredentials: true },
      );
      setMatchResult(res.data);
      setEmployees((prev) =>
        prev.map((e) =>
          e.employee_id === selectedManualEmp.employee_id
            ? { ...e, ID_nmbr: chosen.ID_nmbr }
            : e,
        ),
      );
      // Reset the right pane for the next pick.
      setSelectedManualEmp(null);
      setManualSearch("");
      setManualSelectedKeyName(null);
    } catch (err) {
      setMatchError(
        err.response?.data?.error || err.message || "Update failed",
      );
    } finally {
      setMatchUpdating(false);
    }
  };

  const toggleMatchSelected = (employee_id) => {
    setMatchSelected((prev) => ({
      ...prev,
      [employee_id]: !prev[employee_id],
    }));
  };

  const toggleMatchSelectAll = () => {
    const allOn = matchRows.every((r) => matchSelected[r.emp.employee_id]);
    const next = {};
    for (const r of matchRows) next[r.emp.employee_id] = !allOn;
    setMatchSelected(next);
  };

  const handleMatchUpdate = async () => {
    if (matchUpdating) return;
    const updates = matchRows
      .filter((r) => matchSelected[r.emp.employee_id])
      .map((r) => ({
        employee_id: r.emp.employee_id,
        ID_nmbr: r.match.ID_nmbr,
      }));
    if (updates.length === 0) return;
    setMatchUpdating(true);
    setMatchError(null);
    setMatchResult(null);
    try {
      const res = await axios.post(
        "/admin/payroll/employees/set-id-nmbr",
        { updates },
        { withCredentials: true },
      );
      setMatchResult(res.data);
      // Reflect changes locally so the dialog and table show the new ID_nmbr.
      const applied = new Set(updates.map((u) => u.employee_id));
      setEmployees((prev) =>
        prev.map((e) =>
          applied.has(e.employee_id)
            ? {
                ...e,
                ID_nmbr:
                  updates.find((u) => u.employee_id === e.employee_id)
                    ?.ID_nmbr || e.ID_nmbr,
              }
            : e,
        ),
      );
      // Drop updated rows from the dialog list; if nothing left to confirm,
      // switch to the manual-match tool so the user can keep going.
      setMatchRows((prev) => {
        const next = prev.filter((r) => !applied.has(r.emp.employee_id));
        if (next.length === 0) setMatchMode("manual");
        return next;
      });
    } catch (err) {
      setMatchError(
        err.response?.data?.error || err.message || "Update failed",
      );
    } finally {
      setMatchUpdating(false);
    }
  };

  const openDuplicateDialog = (emp) => {
    setMenuOpenFor(null);
    setDuplicateSearch("");
    setDuplicateDialogFor(emp);
  };

  const handleMarkDuplicate = async (target) => {
    if (markingDuplicateId != null) return;
    const source = duplicateDialogFor;
    if (!source || !target || source.employee_id === target.employee_id) return;
    setMarkingDuplicateId(source.employee_id);
    setSaveError(null);
    try {
      await axios.post(
        "/admin/payroll/employees/duplicate-with",
        {
          employee_id: source.employee_id,
          duplicate_of: target.employee_id,
        },
        { withCredentials: true },
      );
      setEmployees((prev) =>
        prev.filter((e) => e.employee_id !== source.employee_id),
      );
      setDuplicateDialogFor(null);
    } catch (err) {
      setSaveError(
        err.response?.data?.error || err.message || "Mark duplicate failed",
      );
    } finally {
      setMarkingDuplicateId(null);
    }
  };

  const handleRemove = async (emp) => {
    if (removingId != null) return;
    if (!emp?.employee_id) return;
    const ok = window.confirm(
      `Remove ${emp.name || "this employee"}? They will no longer appear in this list.`,
    );
    if (!ok) return;
    setRemovingId(emp.employee_id);
    setMenuOpenFor(null);
    setSaveError(null);
    try {
      await axios.post(
        "/admin/payroll/employees/deactivate",
        { employee_id: emp.employee_id },
        { withCredentials: true },
      );
      setEmployees((prev) =>
        prev.filter((e) => e.employee_id !== emp.employee_id),
      );
    } catch (err) {
      setSaveError(err.response?.data?.error || err.message || "Remove failed");
    } finally {
      setRemovingId(null);
    }
  };

  const handleUpdate = async () => {
    if (saving || employees.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        employees: employees.map((e) => ({
          employee_id: e.employee_id,
          company: e.company,
          name: e.name,
          roles: e.roles,
          new_wage_type: e.new_wage_type || null,
          wage: e.wage,
          travel: e.travel,
          maxTravel: e.maxTravel,
          contractor: !!e.contractor,
        })),
      };
      const res = await axios.post("/admin/payroll/employees/update", payload, {
        withCredentials: true,
      });
      setSaveResult(res.data);
      setDirty(false);
      // Refresh the "missing wages" frozen set: rows that now have a wage
      // drop out, rows that became missing are added.
      if (viewFilter === "missing") {
        const ids = new Set();
        for (const e of employees) {
          if (matchesMissingFilter(e)) ids.add(e.employee_id);
        }
        setMissingFrozenIds(ids);
      }
    } catch (err) {
      setSaveError(err.response?.data?.error || err.message || "Update failed");
    } finally {
      setSaving(false);
    }
  };

  const styles = {
    container: {
      width: "100%",
      minHeight: "calc(100vh - 100px)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "16px 12px",
    },
    header: {
      width: "100%",
      maxWidth: "1400px",
      display: "flex",
      justifyContent: "center",
      alignItems: "flex-end",
      gap: "16px",
      padding: "16px 0 24px",
      position: "relative",
    },
    iconButton: {
      width: "40px",
      height: "40px",
      padding: 0,
      border: `1px solid ${theme.border}`,
      borderRadius: "6px",
      backgroundColor: theme.surface,
      color: theme.text,
      cursor: "pointer",
      fontSize: "1.2rem",
      lineHeight: 1,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
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
    body: {
      width: "100%",
      maxWidth: "1400px",
      display: "flex",
      flexDirection: "column",
      gap: "12px",
    },
    summary: { fontSize: "0.9rem", color: theme.textSecondary },
    searchRow: {
      display: "flex",
      justifyContent: "flex-start",
      alignItems: "center",
      gap: "10px",
      flexWrap: "wrap",
      width: "100%",
    },
    toggleButton: {
      padding: "8px 14px",
      fontSize: "0.9rem",
      fontWeight: 600,
      border: `1px solid ${theme.border}`,
      borderRadius: "6px",
      backgroundColor: theme.surface,
      color: theme.text,
      cursor: "pointer",
      whiteSpace: "nowrap",
    },
    toggleButtonActive: {
      padding: "8px 14px",
      fontSize: "0.9rem",
      fontWeight: 600,
      border: `1px solid ${theme.active || "#2196f3"}`,
      borderRadius: "6px",
      backgroundColor: theme.active || "#2196f3",
      color: "#ffffff",
      cursor: "pointer",
      whiteSpace: "nowrap",
    },
    searchInput: {
      width: "100%",
      maxWidth: "360px",
      padding: "8px 12px",
      fontSize: "0.95rem",
      border: `1px solid ${theme.border}`,
      borderRadius: "6px",
      backgroundColor: theme.surface,
      color: theme.text,
      outline: "none",
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
    table: {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "0.9rem",
      backgroundColor: theme.surface,
      border: `1px solid ${theme.border}`,
      borderRadius: "6px",
      overflow: "hidden",
    },
    th: {
      padding: "10px 12px",
      textAlign: "left",
      borderBottom: `1px solid ${theme.border}`,
      color: theme.text,
      fontWeight: 600,
      backgroundColor: theme.surfaceSecondary || theme.surface,
      whiteSpace: "nowrap",
    },
    td: {
      padding: "8px 12px",
      borderBottom: `1px solid ${theme.border}`,
      color: theme.text,
      verticalAlign: "top",
    },
    tdEmpBoundary: {
      padding: "8px 12px",
      borderBottom: `2px solid ${theme.border}`,
      color: theme.text,
      verticalAlign: "top",
    },
    wageInput: {
      width: "120px",
      padding: "6px 8px",
      fontSize: "0.9rem",
      border: `1px solid ${theme.border}`,
      borderRadius: "4px",
      backgroundColor: theme.surface,
      color: theme.text,
      outline: "none",
    },
    actions: {
      display: "flex",
      justifyContent: "flex-end",
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
    placeholder: {
      textAlign: "center",
      color: theme.textSecondary,
      fontSize: "0.95rem",
      padding: "32px 0",
    },
    actionsCell: {
      padding: "8px 4px",
      borderBottom: `2px solid ${theme.border}`,
      color: theme.text,
      verticalAlign: "middle",
      textAlign: "center",
      width: "40px",
      position: "relative",
    },
    kebabButton: {
      width: "32px",
      height: "32px",
      padding: 0,
      border: "none",
      background: "transparent",
      color: theme.text,
      cursor: "pointer",
      fontSize: "1.4rem",
      fontWeight: 700,
      lineHeight: 1,
      borderRadius: "4px",
    },
    menu: {
      position: "absolute",
      top: "32px",
      right: "4px",
      minWidth: "120px",
      backgroundColor: theme.surface,
      border: `1px solid ${theme.border}`,
      borderRadius: "6px",
      boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
      zIndex: 10,
      overflow: "hidden",
    },
    menuItem: {
      display: "block",
      width: "100%",
      padding: "8px 12px",
      border: "none",
      background: "transparent",
      color: theme.error || "#e53935",
      textAlign: "left",
      fontSize: "0.9rem",
      cursor: "pointer",
    },
    menuItemNeutral: {
      display: "block",
      width: "100%",
      padding: "8px 12px",
      border: "none",
      background: "transparent",
      color: theme.text,
      textAlign: "left",
      fontSize: "0.9rem",
      cursor: "pointer",
      borderBottom: `1px solid ${theme.border}`,
    },
    modalBackdrop: {
      position: "fixed",
      inset: 0,
      backgroundColor: "rgba(0,0,0,0.5)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000,
    },
    modal: {
      width: "min(480px, 92vw)",
      maxHeight: "80vh",
      backgroundColor: theme.surface,
      color: theme.text,
      border: `1px solid ${theme.border}`,
      borderRadius: "8px",
      boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    },
    modalHeader: {
      padding: "14px 16px",
      borderBottom: `1px solid ${theme.border}`,
      fontWeight: 600,
      fontSize: "1rem",
    },
    modalBody: {
      padding: "12px 16px",
      display: "flex",
      flexDirection: "column",
      gap: "10px",
      overflow: "hidden",
    },
    modalList: {
      overflowY: "auto",
      border: `1px solid ${theme.border}`,
      borderRadius: "6px",
      maxHeight: "50vh",
    },
    modalListItem: {
      display: "block",
      width: "100%",
      padding: "10px 12px",
      border: "none",
      borderBottom: `1px solid ${theme.border}`,
      background: "transparent",
      color: theme.text,
      textAlign: "left",
      fontSize: "0.95rem",
      cursor: "pointer",
    },
    modalFooter: {
      padding: "10px 16px",
      borderTop: `1px solid ${theme.border}`,
      display: "flex",
      justifyContent: "flex-end",
      gap: "8px",
    },
    secondaryButton: {
      padding: "8px 14px",
      fontSize: "0.9rem",
      fontWeight: 600,
      border: `1px solid ${theme.border}`,
      borderRadius: "6px",
      backgroundColor: theme.surface,
      color: theme.text,
      cursor: "pointer",
    },
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.selectWrapper}>
          <label htmlFor="employees-restaurant-select" style={styles.label}>
            Select Restaurant
          </label>
          <select
            id="employees-restaurant-select"
            style={styles.select}
            value={selectedRestaurant}
            onChange={(e) => setSelectedRestaurant(e.target.value)}
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
        <button
          type="button"
          title={
            !selectedRestaurant
              ? "Select a restaurant first"
              : "Sync payroll-software index — pick an .xlsx file"
          }
          aria-label="Sync payroll-software index"
          style={{
            ...styles.iconButton,
            opacity: micpalSyncing || !selectedRestaurant ? 0.6 : 1,
            cursor: micpalSyncing
              ? "wait"
              : !selectedRestaurant
                ? "not-allowed"
                : "pointer",
          }}
          onClick={handleMicpalPick}
          disabled={micpalSyncing || !selectedRestaurant}
        >
          {micpalSyncing ? "…" : "↻"}
        </button>
        <input
          ref={micpalFileInputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          style={{ display: "none" }}
          onChange={handleMicpalFileChange}
        />
      </div>

      {(micpalResult || micpalError) && (
        <div style={{ width: "100%", maxWidth: "1400px", marginBottom: 12 }}>
          {micpalError && (
            <div style={styles.errorBox}>
              <strong>Micpal sync error:</strong> {micpalError}
            </div>
          )}
          {micpalResult && (
            <div style={styles.successBox}>
              Micpal sync: upserted <strong>{micpalResult.upserted}</strong> row
              {micpalResult.upserted === 1 ? "" : "s"}
              {micpalResult.skipped ? ` · skipped ${micpalResult.skipped}` : ""}
              {micpalResult.errors && micpalResult.errors.length > 0 && (
                <ul style={{ margin: "8px 0 0", paddingLeft: "20px" }}>
                  {micpalResult.errors.slice(0, 5).map((e, i) => (
                    <li key={i}>
                      row {e.row} ({e.keyName}): {e.issue}
                    </li>
                  ))}
                  {micpalResult.errors.length > 5 && (
                    <li>…and {micpalResult.errors.length - 5} more</li>
                  )}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      <div style={styles.body}>
        {!selectedRestaurant && (
          <div style={styles.placeholder}>
            Select a restaurant to view its employees.
          </div>
        )}

        {selectedRestaurant && loading && (
          <div style={styles.placeholder}>Loading employees…</div>
        )}

        {selectedRestaurant && error && (
          <div style={styles.errorBox}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {selectedRestaurant && !loading && !error && employees.length === 0 && (
          <div style={styles.placeholder}>
            No employees yet for{" "}
            <strong style={{ color: theme.text }}>{selectedLabel}</strong>.
          </div>
        )}

        {selectedRestaurant && !loading && !error && employees.length > 0 && (
          <>
            <div style={styles.searchRow}>
              <input
                type="search"
                placeholder="Search by name, ID, role…"
                style={styles.searchInput}
                value={search}
                onChange={(ev) => setSearch(ev.target.value)}
              />
              <select
                style={styles.select}
                value={viewFilter}
                onChange={(ev) => setViewFilter(ev.target.value)}
              >
                <option value="active">
                  Active employees ({counts.active})
                </option>
                <option value="missing">
                  Missing wages ({counts.missing})
                </option>
                <option value="removed">
                  Removed employees ({counts.removed})
                </option>
                <option value="duplicate">
                  Duplicate employees ({counts.duplicate})
                </option>
              </select>
              <button
                type="button"
                title="Match employees ↔ micpal"
                aria-label="Match with Micpal"
                style={{
                  ...styles.toggleButton,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  opacity: matchLoading ? 0.6 : 1,
                  cursor: matchLoading ? "wait" : "pointer",
                }}
                onClick={openMatchDialog}
                disabled={matchLoading}
              >
                <span style={{ fontSize: "1.1rem", lineHeight: 1 }}>
                  {matchLoading ? "…" : "↻"}
                </span>
                <span>micpal</span>
              </button>
            </div>
            <div style={styles.summary}>
              {search.trim() || viewFilter !== "active" ? (
                <>
                  <strong style={{ color: theme.text }}>
                    {filteredEmployees.length}
                  </strong>{" "}
                  of{" "}
                  <strong style={{ color: theme.text }}>
                    {employees.length}
                  </strong>{" "}
                  employee{employees.length === 1 ? "" : "s"} for{" "}
                  <strong style={{ color: theme.text }}>{selectedLabel}</strong>
                  {viewFilter === "missing"
                    ? " — missing wages"
                    : viewFilter === "removed"
                      ? " — removed"
                      : viewFilter === "duplicate"
                        ? " — duplicates"
                        : ""}
                </>
              ) : (
                <>
                  <strong style={{ color: theme.text }}>
                    {employees.length}
                  </strong>{" "}
                  employee{employees.length === 1 ? "" : "s"} for{" "}
                  <strong style={{ color: theme.text }}>{selectedLabel}</strong>
                </>
              )}
            </div>
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>name</th>
                    <th style={styles.th}>ID_nmbr</th>
                    <th style={styles.th}>wage</th>
                    <th style={styles.th}>travel</th>
                    <th style={styles.th}>maxTravel</th>
                    <th style={styles.th}>contractor</th>
                    <th style={styles.th}>role</th>
                    <th style={styles.th}>role wage</th>
                    <th style={styles.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.flatMap(({ emp, origIdx: empIdx }) => {
                    const roles =
                      emp.roles && emp.roles.length > 0
                        ? emp.roles
                        : [{ role: "", wage: "" }];
                    return roles.map((r, roleIdx) => {
                      const isFirst = roleIdx === 0;
                      const isLast = roleIdx === roles.length - 1;
                      const cellStyle = isLast
                        ? styles.tdEmpBoundary
                        : styles.td;
                      return (
                        <tr key={`${emp.employee_id}-${roleIdx}`}>
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
                                <button
                                  type="button"
                                  style={styles.toggleButton}
                                  onClick={() =>
                                    setWageDialog({
                                      empIdx,
                                      new_wage_type: emp.new_wage_type || "",
                                      wage: emp.wage || "",
                                    })
                                  }
                                  title="Set wage"
                                >
                                  {formatWageCell(emp)}
                                </button>
                              </td>
                              <td
                                rowSpan={roles.length}
                                style={styles.tdEmpBoundary}
                              >
                                <input
                                  type="number"
                                  step="any"
                                  min="0"
                                  placeholder="—"
                                  style={styles.wageInput}
                                  value={emp.travel}
                                  onChange={(ev) =>
                                    updateTravel(empIdx, ev.target.value)
                                  }
                                />
                              </td>
                              <td
                                rowSpan={roles.length}
                                style={styles.tdEmpBoundary}
                              >
                                <input
                                  type="number"
                                  step="any"
                                  min="0"
                                  placeholder="—"
                                  style={styles.wageInput}
                                  value={emp.maxTravel}
                                  onChange={(ev) =>
                                    updateMaxTravel(empIdx, ev.target.value)
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
                                step="any"
                                min="0"
                                placeholder="—"
                                style={styles.wageInput}
                                value={r.wage}
                                onChange={(ev) =>
                                  updateWage(empIdx, roleIdx, ev.target.value)
                                }
                              />
                            ) : (
                              "—"
                            )}
                          </td>
                          {isFirst ? (
                            <td
                              rowSpan={roles.length}
                              style={styles.actionsCell}
                            >
                              <button
                                type="button"
                                aria-label="Row actions"
                                aria-haspopup="menu"
                                aria-expanded={menuOpenFor === emp.employee_id}
                                disabled={removingId === emp.employee_id}
                                style={styles.kebabButton}
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  setMenuOpenFor((cur) =>
                                    cur === emp.employee_id
                                      ? null
                                      : emp.employee_id,
                                  );
                                }}
                              >
                                ⋮
                              </button>
                              {menuOpenFor === emp.employee_id && (
                                <div
                                  role="menu"
                                  style={styles.menu}
                                  onClick={(ev) => ev.stopPropagation()}
                                >
                                  <button
                                    type="button"
                                    role="menuitem"
                                    style={styles.menuItemNeutral}
                                    onClick={() => openDuplicateDialog(emp)}
                                  >
                                    Duplicate with…
                                  </button>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    style={styles.menuItem}
                                    disabled={removingId === emp.employee_id}
                                    onClick={() => handleRemove(emp)}
                                  >
                                    {removingId === emp.employee_id
                                      ? "Removing…"
                                      : "Remove"}
                                  </button>
                                </div>
                              )}
                            </td>
                          ) : null}
                        </tr>
                      );
                    });
                  })}
                </tbody>
              </table>
            </div>
            <div style={styles.actions}>
              <button
                type="button"
                style={{
                  ...styles.primaryButton,
                  opacity: saving ? 0.7 : !dirty ? 0.7 : 1,
                  cursor: saving ? "wait" : !dirty ? "default" : "pointer",
                }}
                onClick={handleUpdate}
                disabled={saving || !dirty}
              >
                {saving ? "Saving…" : "Update"}
              </button>
            </div>
            {saveError && (
              <div style={styles.errorBox}>
                <strong>Error:</strong> {saveError}
              </div>
            )}
            {saveResult && (
              <div style={styles.successBox}>
                Updated <strong>{saveResult.updated}</strong> of{" "}
                {saveResult.attempted} employee
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
          </>
        )}
      </div>

      {matchDialogOpen && (
        <div
          style={styles.modalBackdrop}
          onClick={() => setMatchDialogOpen(false)}
        >
          <div
            style={{
              ...styles.modal,
              width:
                matchMode === "manual"
                  ? "min(960px, 96vw)"
                  : "min(820px, 96vw)",
            }}
            onClick={(ev) => ev.stopPropagation()}
          >
            <div style={styles.modalHeader}>
              {matchMode === "manual"
                ? "Match employees ↔ Micpal — manual tool"
                : "Match employees ↔ Micpal — perfect matches (100)"}
            </div>
            <div style={styles.modalBody}>
              {matchLoading && (
                <div style={{ color: theme.textSecondary }}>
                  Loading micpal…
                </div>
              )}
              {matchError && (
                <div style={styles.errorBox}>
                  <strong>Error:</strong> {matchError}
                </div>
              )}

              {!matchLoading && matchMode === "perfect" && (
                <>
                  {matchRows.length === 0 && !matchError && (
                    <div
                      style={{
                        padding: "12px",
                        color: theme.textSecondary,
                        fontSize: "0.95rem",
                      }}
                    >
                      No perfect matches found among employees missing ID.
                    </div>
                  )}
                  {matchRows.length > 0 && (
                    <div style={{ ...styles.modalList, maxHeight: "60vh" }}>
                      <table style={{ ...styles.table, borderRadius: 0 }}>
                        <thead>
                          <tr>
                            <th style={styles.th}>
                              <input
                                type="checkbox"
                                checked={matchRows.every(
                                  (r) => matchSelected[r.emp.employee_id],
                                )}
                                onChange={toggleMatchSelectAll}
                                aria-label="Select all"
                              />
                            </th>
                            <th style={styles.th}>Micpal name</th>
                            <th style={styles.th}>Employee name</th>
                            <th style={styles.th}>ID number</th>
                          </tr>
                        </thead>
                        <tbody>
                          {matchRows.map(({ emp, match }) => (
                            <tr key={emp.employee_id}>
                              <td style={styles.td}>
                                <input
                                  type="checkbox"
                                  checked={!!matchSelected[emp.employee_id]}
                                  onChange={() =>
                                    toggleMatchSelected(emp.employee_id)
                                  }
                                  aria-label={`Select ${emp.name}`}
                                />
                              </td>
                              <td style={styles.td}>
                                {[match.name, match.family]
                                  .filter(Boolean)
                                  .join(" ") || "—"}
                              </td>
                              <td style={styles.td}>{emp.name || "—"}</td>
                              <td style={styles.td}>{match.ID_nmbr || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}

              {!matchLoading && matchMode === "manual" && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(220px, 1fr) 2fr",
                    gap: "12px",
                    minHeight: "300px",
                  }}
                >
                  {/* Left: unmatched employees */}
                  <div
                    style={{
                      border: `1px solid ${theme.border}`,
                      borderRadius: "6px",
                      overflow: "hidden",
                      display: "flex",
                      flexDirection: "column",
                      maxHeight: "60vh",
                    }}
                  >
                    <div
                      style={{
                        padding: "8px 12px",
                        borderBottom: `1px solid ${theme.border}`,
                        fontWeight: 600,
                        fontSize: "0.9rem",
                        backgroundColor:
                          theme.surfaceSecondary || theme.surface,
                      }}
                    >
                      Unmatched ({manualUnmatched.length})
                    </div>
                    <div style={{ overflowY: "auto" }}>
                      {manualUnmatched.length === 0 && (
                        <div
                          style={{
                            padding: "12px",
                            color: theme.textSecondary,
                            fontSize: "0.9rem",
                          }}
                        >
                          Nothing to match.
                        </div>
                      )}
                      {manualUnmatched.map((emp) => {
                        const active =
                          selectedManualEmp &&
                          selectedManualEmp.employee_id === emp.employee_id;
                        const rawPhone = String(emp.phone || "").trim();
                        // Build a wa.me URL. Israeli locals starting with "0"
                        // get the leading 0 stripped and a 972 country prefix;
                        // anything starting with "+" / "972" is used as-is.
                        let waPhone = "";
                        if (rawPhone) {
                          const digits = rawPhone.replace(/[^\d]/g, "");
                          if (digits) {
                            if (digits.startsWith("972")) waPhone = digits;
                            else if (digits.startsWith("0"))
                              waPhone = "972" + digits.slice(1);
                            else waPhone = digits;
                          }
                        }
                        return (
                          <div
                            key={emp.employee_id}
                            role="button"
                            tabIndex={0}
                            onClick={() => pickManualEmp(emp)}
                            onKeyDown={(ev) => {
                              if (ev.key === "Enter" || ev.key === " ") {
                                ev.preventDefault();
                                pickManualEmp(emp);
                              }
                            }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: "8px",
                              width: "100%",
                              textAlign: "left",
                              padding: "8px 12px",
                              borderBottom: `1px solid ${theme.border}`,
                              background: active
                                ? theme.active || "#2196f3"
                                : "transparent",
                              color: active ? "#ffffff" : theme.text,
                              cursor: "pointer",
                              fontSize: "0.92rem",
                            }}
                          >
                            <span style={{ flex: 1, minWidth: 0 }}>
                              {emp.name || "(no name)"}
                            </span>
                            {waPhone ? (
                              <a
                                href={`https://web.whatsapp.com/send/?phone=${waPhone}&text&type=phone_number&app_absent=0`}
                                target="whatsapp"
                                rel="noopener noreferrer"
                                onClick={(ev) => ev.stopPropagation()}
                                style={{
                                  color: active ? "#ffffff" : "#25d366",
                                  textDecoration: "underline",
                                  fontSize: "0.85rem",
                                  whiteSpace: "nowrap",
                                }}
                                title={`Open WhatsApp chat with ${rawPhone}`}
                              >
                                {rawPhone}
                              </a>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Right: search + results */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      minHeight: 0,
                    }}
                  >
                    <input
                      type="search"
                      placeholder={
                        selectedManualEmp
                          ? `Search Micpal for "${selectedManualEmp.name}"…`
                          : "Search Micpal…"
                      }
                      style={styles.searchInput}
                      value={manualSearch}
                      onChange={(ev) => {
                        setManualSearch(ev.target.value);
                        setManualSelectedKeyName(null);
                      }}
                    />
                    <div
                      style={{
                        border: `1px solid ${theme.border}`,
                        borderRadius: "6px",
                        overflow: "hidden",
                        flex: 1,
                        minHeight: 0,
                        display: "flex",
                        flexDirection: "column",
                      }}
                    >
                      <div style={{ overflowY: "auto", maxHeight: "55vh" }}>
                        <table style={{ ...styles.table, borderRadius: 0 }}>
                          <thead>
                            <tr>
                              <th style={styles.th}></th>
                              <th style={styles.th}>Name</th>
                              <th style={styles.th}>ID number</th>
                              <th style={styles.th}>Score</th>
                            </tr>
                          </thead>
                          <tbody>
                            {manualResults.length === 0 && (
                              <tr>
                                <td
                                  colSpan={4}
                                  style={{
                                    ...styles.td,
                                    color: theme.textSecondary,
                                    textAlign: "center",
                                  }}
                                >
                                  {selectedManualEmp
                                    ? "No matches."
                                    : "Pick an employee to search."}
                                </td>
                              </tr>
                            )}
                            {manualResults.map((m) => (
                              <tr key={m.keyName}>
                                <td style={styles.td}>
                                  <input
                                    type="radio"
                                    name="manual-pick"
                                    checked={
                                      manualSelectedKeyName === m.keyName
                                    }
                                    onChange={() =>
                                      setManualSelectedKeyName(m.keyName)
                                    }
                                    disabled={
                                      !m.ID_nmbr || !String(m.ID_nmbr).trim()
                                    }
                                    aria-label={`Pick ${m.name} ${m.family}`}
                                  />
                                </td>
                                <td style={styles.td}>
                                  {[m.name, m.family]
                                    .filter(Boolean)
                                    .join(" ") || "—"}
                                </td>
                                <td style={styles.td}>{m.ID_nmbr || "—"}</td>
                                <td style={styles.td}>{m.score}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {matchResult && (
                <div style={styles.successBox}>
                  Updated <strong>{matchResult.updated}</strong> of{" "}
                  {matchResult.attempted}
                  {matchResult.errors && matchResult.errors.length > 0 && (
                    <ul style={{ margin: "8px 0 0", paddingLeft: "20px" }}>
                      {matchResult.errors.slice(0, 5).map((e, i) => (
                        <li key={i}>
                          emp {e.employee_id}: {e.issue}
                        </li>
                      ))}
                      {matchResult.errors.length > 5 && (
                        <li>…and {matchResult.errors.length - 5} more</li>
                      )}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <div style={styles.modalFooter}>
              <button
                type="button"
                style={styles.secondaryButton}
                onClick={() => setMatchDialogOpen(false)}
                disabled={matchUpdating}
              >
                Close
              </button>
              {matchMode === "perfect" ? (
                <button
                  type="button"
                  style={{
                    ...styles.primaryButton,
                    opacity:
                      matchUpdating ||
                      matchRows.every((r) => !matchSelected[r.emp.employee_id])
                        ? 0.6
                        : 1,
                    cursor: matchUpdating ? "wait" : "pointer",
                  }}
                  onClick={handleMatchUpdate}
                  disabled={
                    matchUpdating ||
                    matchRows.every((r) => !matchSelected[r.emp.employee_id])
                  }
                >
                  {matchUpdating ? "Updating…" : "Update"}
                </button>
              ) : (
                <button
                  type="button"
                  style={{
                    ...styles.primaryButton,
                    opacity:
                      matchUpdating ||
                      !selectedManualEmp ||
                      !manualSelectedKeyName
                        ? 0.6
                        : 1,
                    cursor: matchUpdating ? "wait" : "pointer",
                  }}
                  onClick={handleManualUpdate}
                  disabled={
                    matchUpdating ||
                    !selectedManualEmp ||
                    !manualSelectedKeyName
                  }
                >
                  {matchUpdating ? "Updating…" : "Update"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {wageDialog && (
        <div style={styles.modalBackdrop} onClick={() => setWageDialog(null)}>
          <div style={styles.modal} onClick={(ev) => ev.stopPropagation()}>
            <div style={styles.modalHeader}>
              Set wage for{" "}
              <span style={{ color: theme.active || "#2196f3" }}>
                {employees[wageDialog.empIdx]?.name || "(no name)"}
              </span>
            </div>
            <div style={styles.modalBody}>
              <label style={styles.label}>Wage type</label>
              <select
                style={styles.select}
                value={wageDialog.new_wage_type}
                onChange={(ev) =>
                  setWageDialog((d) => ({
                    ...d,
                    new_wage_type: ev.target.value,
                  }))
                }
                autoFocus
              >
                <option value="">-- choose --</option>
                {WAGE_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <label style={styles.label}>Wage</label>
              <input
                type="number"
                step="any"
                placeholder="—"
                style={styles.searchInput}
                value={wageDialog.wage}
                onChange={(ev) =>
                  setWageDialog((d) => ({ ...d, wage: ev.target.value }))
                }
              />
            </div>
            <div style={styles.modalFooter}>
              <button
                type="button"
                style={styles.secondaryButton}
                onClick={() => setWageDialog(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                style={{
                  ...styles.primaryButton,
                  opacity: wageDialog.new_wage_type ? 1 : 0.6,
                  cursor: wageDialog.new_wage_type ? "pointer" : "default",
                }}
                disabled={!wageDialog.new_wage_type}
                onClick={() => {
                  updateWageFields(wageDialog.empIdx, {
                    new_wage_type: wageDialog.new_wage_type,
                    wage: wageDialog.wage,
                  });
                  setWageDialog(null);
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {duplicateDialogFor && (
        <div
          style={styles.modalBackdrop}
          onClick={() => setDuplicateDialogFor(null)}
        >
          <div style={styles.modal} onClick={(ev) => ev.stopPropagation()}>
            <div style={styles.modalHeader}>
              Mark{" "}
              <span style={{ color: theme.active || "#2196f3" }}>
                {duplicateDialogFor.name || "(no name)"}
              </span>{" "}
              as duplicate of…
            </div>
            <div style={styles.modalBody}>
              <input
                type="search"
                placeholder="Search by name, ID…"
                style={styles.searchInput}
                value={duplicateSearch}
                onChange={(ev) => setDuplicateSearch(ev.target.value)}
                autoFocus
              />
              <div style={styles.modalList}>
                {(() => {
                  const q = duplicateSearch.trim().toLowerCase();
                  const candidates = employees.filter(
                    (e) =>
                      e.employee_id !== duplicateDialogFor.employee_id &&
                      (!q ||
                        [e.name, e.ID_nmbr]
                          .filter(Boolean)
                          .join(" ")
                          .toLowerCase()
                          .includes(q)),
                  );
                  if (candidates.length === 0) {
                    return (
                      <div
                        style={{
                          padding: "12px",
                          color: theme.textSecondary,
                          fontSize: "0.9rem",
                        }}
                      >
                        No matching employees.
                      </div>
                    );
                  }
                  return candidates.map((e) => (
                    <button
                      key={e.employee_id}
                      type="button"
                      style={styles.modalListItem}
                      disabled={markingDuplicateId != null}
                      onClick={() => handleMarkDuplicate(e)}
                    >
                      <strong>{e.name || "(no name)"}</strong>
                      {e.ID_nmbr ? ` — id ${e.ID_nmbr}` : ""}
                    </button>
                  ));
                })()}
              </div>
            </div>
            <div style={styles.modalFooter}>
              <button
                type="button"
                style={styles.secondaryButton}
                onClick={() => setDuplicateDialogFor(null)}
                disabled={markingDuplicateId != null}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Employees;
