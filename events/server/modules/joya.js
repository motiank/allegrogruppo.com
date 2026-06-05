import express from "express";
import { renderJoyaPage } from "../render/joya.js";
import { renderBranchPage, renderBranchesIndex } from "../render/branch.js";
import { BRANCH_BY_SLUG } from "../data/branches.js";
import { baseUrlFor, escapeHtml } from "../render/html.js";

// Minimal RTL "coming soon" page for links we reference now but build later
// (per-branch pages, full menu, privacy policy). Reuses /css/joya.css.
const comingSoon = (title) => `<!DOCTYPE html>
<html lang="he" dir="rtl"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} | Joya</title>
<meta name="robots" content="noindex" />
<link href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;600;700&family=Frank+Ruhl+Libre:wght@700;900&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/css/joya.css" />
</head><body>
<section class="section" style="text-align:center;min-height:70vh;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:1rem">
  <img src="/images/joya/logo-dark.png" alt="Joya" style="height:64px" />
  <p class="section-eyebrow">בקרוב</p>
  <h1 style="font-family:var(--serif)">${escapeHtml(title)}</h1>
  <p style="color:var(--muted);max-width:34ch">העמוד הזה בהכנה. בינתיים אפשר להשאיר פרטים ונחזור אליכם.</p>
  <a class="btn btn-primary" href="/joya#lead">חזרה לעמוד האירועים</a>
</section>
</body></html>`;

// ---------------------------------------------------------------------------
// Joya — a curated, hand-designed events landing page at /joya.
//
// Unlike /:restaurant/:slug (DB-driven event pages), this is a bespoke page.
// The lead form posts to /joya/inquiry. The real submission handling
// (persist to DB + notify the events manager) will be wired through the admin
// backend later — for now we acknowledge the submission so the form works
// end-to-end without losing the lead.
// ---------------------------------------------------------------------------

export default () => {
  const router = express.Router();

  // Landing page.
  router.get("/", (req, res) => {
    const html = renderJoyaPage({ baseUrl: baseUrlFor(req) });
    res.set("Content-Type", "text/html; charset=utf-8").send(html);
  });

  // Lead-form submission (placeholder — admin backend will own this later).
  router.post("/inquiry", (req, res) => {
    const { name, phone, email, guests, event_date, branch, message, consent } =
      req.body || {};

    // Minimal validation: name + phone are required.
    if (!name || !phone) {
      return res
        .status(400)
        .json({ ok: false, error: "missing_required", fields: ["name", "phone"] });
    }

    // TODO(admin): persist to a `joya_event_leads` table and notify the
    // events manager (email / WhatsApp). For now just log the lead.
    console.log("[events][joya] new event inquiry:", {
      name,
      phone,
      email,
      guests,
      event_date,
      branch,
      message,
      consent: consent === "1" || consent === true,
    });

    res.json({ ok: true, message: "תודה! נחזור אליכם בהקדם." });
  });

  // Branches index + per-branch landing pages.
  router.get("/branches", (req, res) => {
    res
      .set("Content-Type", "text/html; charset=utf-8")
      .send(renderBranchesIndex({ baseUrl: baseUrlFor(req) }));
  });

  router.get("/branches/:slug", (req, res) => {
    const branch = BRANCH_BY_SLUG[req.params.slug];
    if (!branch) {
      return res
        .status(404)
        .set("Content-Type", "text/html; charset=utf-8")
        .send(comingSoon("הסניף לא נמצא"));
    }
    res
      .set("Content-Type", "text/html; charset=utf-8")
      .send(renderBranchPage({ branch, baseUrl: baseUrlFor(req) }));
  });

  // Placeholder routes for pages we'll build later (see render/joya.js links).
  const stub = (title) => (req, res) =>
    res.set("Content-Type", "text/html; charset=utf-8").send(comingSoon(title));
  router.get("/menu", stub("תפריט האירועים"));
  router.get("/privacy", stub("מדיניות פרטיות"));

  return router;
};
