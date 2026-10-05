import express from "express";
import { renderJoyaPage } from "../render/joya.js";
import { renderBranchPage, renderBranchesIndex } from "../render/branch.js";
import { BRANCH_BY_SLUG } from "../data/branches.js";
import { baseUrlFor, escapeHtml } from "../render/html.js";
import { gtmHeadSnippet, gtmBodySnippet } from "../render/analytics.js";
import { executeSql } from "../sources/dbpool.js";
import {
  TRACKING_PARAMS,
  deviceFromUserAgent,
  postLeadToLeadim,
} from "../sources/leadim.js";

// Minimal RTL "coming soon" page for links we reference now but build later
// (per-branch pages, full menu, privacy policy). Reuses /css/joya.css.
const comingSoon = (title) => `<!DOCTYPE html>
<html lang="he" dir="rtl"><head>
${gtmHeadSnippet()}
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} | Joya</title>
<meta name="robots" content="noindex" />
<link href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;600;700&family=Frank+Ruhl+Libre:wght@700;900&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/css/joya.css" />
</head><body>
${gtmBodySnippet()}
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
// The lead form posts to /joya/inquiry, which persists to joya_event_leads
// and (when enabled) forwards the lead to a Make.com webhook scenario and to
// lead.im (see sources/leadim.js).
// ---------------------------------------------------------------------------

// UTM/gclid values from a query string — preserved across the /inquiry
// redirect so a retry after a validation error keeps its attribution.
const pickTracking = (query = {}) =>
  Object.fromEntries(
    TRACKING_PARAMS.filter((k) => typeof query[k] === "string" && query[k]).map(
      (k) => [k, query[k]],
    ),
  );

const backToForm = (res, status, tracking) => {
  const qs = new URLSearchParams({ ...tracking, lead: status });
  res.redirect(303, `/joya?${qs}#lead`);
};

// Make.com (Integromat) webhook for new leads — set EVENTS_LEADS_WEBHOOK_URL
// in .env, and EVENTS_LEADS_WEBHOOK_ENABLED=true to actually fire it (off by
// default so a configured-but-untested URL can't misfire in other envs).
const LEADS_WEBHOOK_URL = process.env.EVENTS_LEADS_WEBHOOK_URL || "";
const LEADS_WEBHOOK_ENABLED = process.env.EVENTS_LEADS_WEBHOOK_ENABLED === "true";

// Best-effort, fire-and-forget — never let a webhook failure affect the
// visitor's submission (the DB row is already the source of truth).
const postLeadWebhook = async (lead) => {
  if (!LEADS_WEBHOOK_ENABLED || !LEADS_WEBHOOK_URL) return;
  try {
    const res = await fetch(LEADS_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lead),
    });
    if (!res.ok) {
      console.error(`[events][joya] leads webhook responded ${res.status}`);
    }
  } catch (e) {
    console.error("[events][joya] leads webhook failed:", e);
  }
};

export default () => {
  const router = express.Router();

  // Landing page. `lead=sent`/`lead=error` (set by the /inquiry redirect
  // below) drives an inline success/error banner near the lead form.
  router.get("/", (req, res) => {
    const leadStatus = ["sent", "error"].includes(req.query.lead)
      ? req.query.lead
      : null;
    const baseUrl = baseUrlFor(req);

    // Full landing URL (minus our own `lead` flag) + external referrer, for
    // lead.im's lm_source / ref fields.
    const pageUrl = new URL(req.originalUrl, baseUrl);
    pageUrl.searchParams.delete("lead");
    const referer = req.get("referer") || "";
    const externalRef =
      referer && new URL(referer, baseUrl).host !== pageUrl.host ? referer : "";

    const tracking = {
      ...pickTracking(req.query),
      page_url: pageUrl.toString(),
      ref: externalRef,
    };
    const html = renderJoyaPage({ baseUrl, leadStatus, tracking });
    res.set("Content-Type", "text/html; charset=utf-8").send(html);
  });

  // Lead-form submission. This is a plain HTML form POST (no JS), so on
  // both success and failure we redirect back to /joya#lead with a query
  // flag rather than returning JSON — see renderJoyaPage's leadStatus banner.
  router.post("/inquiry", async (req, res) => {
    const { name, phone, email, guests, event_date, branch, message, consent } =
      req.body || {};
    const tracking = pickTracking(req.body);

    // Minimal validation: name + phone are required.
    if (!name || !phone) {
      return backToForm(res, "error", tracking);
    }

    const leadFields = {
      name,
      phone,
      email: email || null,
      guests: guests ? Number(guests) : null,
      event_date: event_date || null,
      branch: branch || null,
      message: message || null,
    };

    try {
      const [result] = await executeSql(
        `INSERT INTO joya_event_leads
           (name, phone, email, guests, event_date, branch, message)
         VALUES (:name, :phone, :email, :guests, :event_date, :branch, :message)`,
        leadFields,
      );
      postLeadWebhook({
        id: result.insertId,
        ...leadFields,
        created_at: new Date().toISOString(),
      });

      // lead.im has no dedicated guests/date fields — fold them into fld_msg.
      const branchName = BRANCH_BY_SLUG[branch]?.name || branch || "";
      const details = [
        leadFields.guests && `מספר אורחים: ${leadFields.guests}`,
        leadFields.event_date && `תאריך האירוע: ${leadFields.event_date}`,
        branchName && `סניף: ${branchName}`,
        message && `פרטי האירוע: ${message}`,
      ].filter(Boolean);
      postLeadToLeadim({
        subject: "אירועים בג׳ויה",
        name,
        phone,
        email,
        choice: branchName,
        message: details.join("\n"),
        pageTitle: "אירועים בג׳ויה | Joya Cucina Italiana",
        pageUrl: req.body.page_url || `${baseUrlFor(req)}/joya`,
        branch: branchName,
        device: deviceFromUserAgent(req.get("user-agent")),
        ref: req.body.ref || "",
        tracking,
      });

      backToForm(res, "sent", tracking);
    } catch (e) {
      console.error("[events][joya] inquiry insert failed:", e);
      backToForm(res, "error", tracking);
    }
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
