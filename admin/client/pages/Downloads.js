// Downloads — admin only. Lists the install packages the server builds from the repo (GET /admin/downloads) with a
// download link for each (GET /admin/downloads/:id). The first one is the Hashavshevet sync for Windows.
import React, { useEffect, useState } from "react";
import axios from "axios";
import { useTheme } from "../context/ThemeContext";

const errText = (err, fallback) => err.response?.data?.error?.message || err.response?.data?.error || err.message || fallback;
const kb = (n) => `${Math.max(1, Math.round(n / 1024))} KB`;

// Short install steps per package. The full guide (INSTALL.md) is inside the zip.
const STEPS = {
  "hash-sync-windows": [
    "On the Windows computer that runs the Hashavshevet SQL Server, unzip the file to C:\\hash-sync.",
    "Double-click install.cmd. It checks Node.js (18 or newer), installs the packages and opens the settings file .env in Notepad.",
    "Fill in .env: the SQL Server instance (usually WIZSOFT), the sa password and the company database name, and the MySQL host, user and password from .env.production on the development machine. Save and close Notepad; the install then checks both connections.",
    "sync-now.cmd runs the first sync. schedule.cmd creates the nightly task (02:00). check.cmd tests the connections again at any time.",
    "Before the first run, add the public IP address of that computer to the trusted sources of the production database (DigitalOcean).",
  ],
};

const Downloads = () => {
  const { theme } = useTheme();
  const [packages, setPackages] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState({});

  useEffect(() => {
    axios
      .get("/admin/downloads", { withCredentials: true })
      .then((res) => setPackages(res.data.packages || []))
      .catch((err) => setError(errText(err, "could not load the downloads")));
  }, []);

  const styles = {
    page: { padding: "16px", color: theme.text, maxWidth: "900px" },
    card: { background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: "8px", padding: "16px 20px", marginBottom: "16px" },
    head: { display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center", justifyContent: "space-between" },
    title: { margin: 0, fontSize: "1.1rem" },
    meta: { color: theme.textSecondary, fontSize: "0.85rem" },
    button: { padding: "8px 16px", border: "none", borderRadius: "4px", background: theme.active, color: "#fff", cursor: "pointer", fontWeight: 600, textDecoration: "none", display: "inline-block" },
    link: { background: "none", border: "none", color: theme.active, cursor: "pointer", padding: 0, fontSize: "0.85rem" },
    steps: { margin: "12px 0 0", paddingLeft: "20px", lineHeight: 1.5 },
    files: { margin: "8px 0 0", paddingLeft: "20px", fontSize: "0.8rem", color: theme.textSecondary, columns: 2 },
    error: { background: theme.errorBg, color: theme.error, border: `1px solid ${theme.errorBorder}`, padding: "10px 14px", borderRadius: "6px", marginBottom: "12px" },
  };

  return (
    <div style={styles.page}>
      <h2 style={{ marginTop: 0 }}>Downloads</h2>
      <p style={styles.meta}>Install packages built from the code on this server. Only admins can see this page and download the files.</p>
      {error && <div style={styles.error}>{String(error)}</div>}
      {packages === null && !error && <p style={styles.meta}>Loading…</p>}
      {packages?.length === 0 && <p style={styles.meta}>No packages yet.</p>}
      {packages?.map((pkg) => (
        <div key={pkg.id} style={styles.card}>
          <div style={styles.head}>
            <div>
              <h3 style={styles.title}>{pkg.name}</h3>
              <div style={styles.meta}>{pkg.fileName} · version {pkg.version} · {kb(pkg.size)} · {pkg.files.length} files</div>
            </div>
            <a style={styles.button} href={pkg.url}>Download</a>
          </div>
          <p style={{ margin: "12px 0 0" }}>{pkg.description}</p>
          {STEPS[pkg.id] && (
            <ol style={styles.steps}>
              {STEPS[pkg.id].map((step, i) => <li key={i}>{step}</li>)}
            </ol>
          )}
          <p style={{ margin: "12px 0 0" }}>
            <button style={styles.link} onClick={() => setOpen((o) => ({ ...o, [pkg.id]: !o[pkg.id] }))}>
              {open[pkg.id] ? "Hide the file list" : "Show the file list"}
            </button>
          </p>
          {open[pkg.id] && (
            <ul style={styles.files}>
              {pkg.files.map((f) => <li key={f}>{f}</li>)}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
};

export default Downloads;
