// Tabit Shift (app.shiftorganizer.com) detailed report through its web API, so it needs no Excel upload.
// These are the calls Tabit Shift's own web app makes (internal, not a published API — they can change):
//   GET /login/ (csrftoken) → POST /api/auth/login/ (sessionid) → POST /api/auth/switch-application/ per Tabit app
//   → GET /api/report/?report=detailed… (JSON: one entry per employee, one row per day) → POST /api/auth/logout/
// Env: TABIT_SHIFT_COMPANY, TABIT_SHIFT_USER, TABIT_SHIFT_PASSWORD; TABIT_SHIFT_URL for another server
// (some companies are on https://app-b.shiftorganizer.com).

const TZ = "Asia/Jerusalem";

export const tabitShiftConfig = (env = process.env) => ({
  base: (env.TABIT_SHIFT_URL || "https://app.shiftorganizer.com").replace(/\/$/, ""),
  company: env.TABIT_SHIFT_COMPANY || "",
  username: env.TABIT_SHIFT_USER || "",
  password: env.TABIT_SHIFT_PASSWORD || "",
});

// Node 18 before 18.18 has no Headers.getSetCookie: split the joined header at each "name=" after a comma.
const setCookies = (headers) => {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const raw = headers.get("set-cookie");
  return raw ? raw.split(/,(?=\s*[A-Za-z0-9_-]+=)/) : [];
};

export class TabitShiftClient {
  constructor({ base } = tabitShiftConfig()) {
    this.base = base;
    this.jar = new Map();
  }

  async call(path, { method = "GET", body, type, referer = "/app/reports" } = {}) {
    const headers = {
      accept: "application/json, text/plain, */*",
      referer: this.base + referer,
      cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "),
    };
    if (this.jar.has("csrftoken")) headers["x-csrftoken"] = this.jar.get("csrftoken");
    if (type) headers["content-type"] = type;
    const res = await fetch(this.base + path, { method, headers, body, redirect: "manual" });
    for (const c of setCookies(res.headers)) {
      const pair = c.split(";")[0];
      const i = pair.indexOf("=");
      if (i > 0) this.jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    return res;
  }

  async json(path, opts) {
    const res = await this.call(path, opts);
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // not JSON (an HTML error page)
    }
    if (!res.ok) throw new Error(`Tabit Shift ${opts?.method || "GET"} ${path.split("?")[0]}: ${res.status} ${data?.message || data?.detail || ""}`.trim());
    return data;
  }

  async login({ company, username, password }) {
    if (!company || !username || !password) throw new Error("Tabit Shift login is not set (TABIT_SHIFT_COMPANY / _USER / _PASSWORD)");
    const page = await (await this.call("/login/", { referer: "/login/" })).text();
    const tag = page.match(/<input[^>]*csrfmiddlewaretoken[^>]*>/)?.[0] || "";
    const token = tag.match(/value=["']([^"']*)/)?.[1] || this.jar.get("csrftoken");
    if (!token) throw new Error("Tabit Shift login page: no CSRF token");
    const form = new URLSearchParams({ company, username, password, rememberme: "false", csrfmiddlewaretoken: token });
    await this.json("/api/auth/login/", { method: "POST", body: form.toString(), type: "application/x-www-form-urlencoded; charset=UTF-8", referer: "/login/" });
    if (!this.jar.has("sessionid")) throw new Error("Tabit Shift login: no session cookie");
  }

  /** The Tabit apps (restaurants) this login can switch to: [{ id, name }]. */
  async siblings() {
    return (await this.json("/api/siblings/")) || [];
  }

  async switchApp(id) {
    await this.json("/api/auth/switch-application/", { method: "POST", body: JSON.stringify({ application: Number(id) }), type: "application/json" });
  }

  /** The detailed report of one month ('YYYY-MM') of the current app. to_month is inclusive (the web app's
   *  "to 2026-10-01" returns September and October, one entry per employee per month), so from = to. */
  async detailedReport(month) {
    const qs = new URLSearchParams({
      from_month: `${month}-01`,
      groups: "-2",
      one_page: "false",
      only_totals: "undefined",
      report: "detailed",
      sort_by: "first_name",
      time_only: "false",
      to_month: `${month}-01`,
      type: "excel",
    });
    return this.json(`/api/report/?${qs}`);
  }

  async logout() {
    await this.call("/api/auth/logout/", { method: "POST" }).catch(() => {});
  }
}

export const nextMonth = (month) => {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

const wallClock = new Intl.DateTimeFormat("sv-SE", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
// '2026-09-01T08:59:00+03:00' → '2026-09-01 08:59:00' (restaurant time, as tabit_shifts keeps it)
const localTime = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : wallClock.format(d);
};

/**
 * The report JSON → what parseTabitDetailed returns for an Excel file:
 * { month, employees: [{ name, clockId, shifts: [{ work_date, block_no, role, clock_in, clock_out, note }] }], skipped }.
 * A day row has numbered blocks: role_0/start_0/end_0/notes_0, role_1/… A report of several months has one
 * entry per employee per month: only the days of `month` are kept, and one employee's entries become one.
 */
export const reportToParsed = (report, month) => {
  const byName = new Map();
  const skipped = [];
  for (const e of report?.data || []) {
    const name = String(e.header?.employee?.name || "").trim();
    if (!name) {
      skipped.push({ sheet: String(e.header?.employee?.id ?? "?"), reason: "no employee name" });
      continue;
    }
    if (!byName.has(name)) byName.set(name, { sheet: name, name, clockId: null, shifts: [] });
    const shifts = byName.get(name).shifts;
    for (const row of e.data || []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.date || "")) || !row.date.startsWith(`${month}-`)) continue;
      const blocks = [...new Set(Object.keys(row).map((k) => k.match(/^(?:start|end)_(\d+)$/)?.[1]).filter(Boolean).map(Number))].sort((a, b) => a - b);
      for (const i of blocks) {
        const clockIn = localTime(row[`start_${i}`]);
        const clockOut = localTime(row[`end_${i}`]);
        if (!clockIn && !clockOut) continue;
        shifts.push({
          work_date: row.date,
          block_no: i + 1,
          role: String(row[`role_${i}`] || "").trim() || null,
          clock_in: clockIn,
          clock_out: clockOut,
          note: String(row[`notes_${i}`] || "").trim().slice(0, 255) || null,
        });
      }
    }
  }
  return { month, employees: [...byName.values()], skipped };
};

const UNPLANNED = 'בלת"מ';
// Of two rows with the same day and clock-in, the better one: with a clock-out, then a real role over בלת"מ.
const better = (a, b) => {
  if (!a.clock_out !== !b.clock_out) return a.clock_out ? a : b;
  if ((a.role === UNPLANNED) !== (b.role === UNPLANNED)) return a.role === UNPLANNED ? b : a;
  return a;
};

/**
 * Several reports of one branch and month (Raanana: kitchen + floor) → one, so the import of one app does not
 * replace the other's rows. An employee in both apps gets the shifts of both. Tabit sometimes has one person
 * twice with the same day and clock-in (a role row + a בלת"מ row, often one without clock-out): only the
 * better row is kept (see better()). The blocks of a day are renumbered by clock-in.
 */
export const mergeParsed = (list) => {
  const byName = new Map();
  for (const p of list) {
    for (const e of p.employees) {
      const cur = byName.get(e.name) || { sheet: e.name, name: e.name, clockId: e.clockId, shifts: [] };
      cur.shifts.push(...e.shifts);
      byName.set(e.name, cur);
    }
  }
  for (const e of byName.values()) {
    const kept = new Map();
    for (const s of e.shifts) {
      const k = s.clock_in ? `${s.work_date}|${s.clock_in}` : `${s.work_date}||${s.clock_out}`;
      kept.set(k, kept.has(k) ? better(kept.get(k), s) : s);
    }
    e.shifts = [...kept.values()]
      .sort((a, b) => a.work_date.localeCompare(b.work_date) || String(a.clock_in || a.clock_out).localeCompare(String(b.clock_in || b.clock_out)));
    const perDay = new Map();
    for (const s of e.shifts) {
      const n = (perDay.get(s.work_date) || 0) + 1;
      perDay.set(s.work_date, n);
      s.block_no = n;
    }
  }
  return { month: list[0]?.month ?? null, employees: [...byName.values()], skipped: list.flatMap((p) => p.skipped) };
};
