// lead.im (seo-c.co.il environment) — forwards event leads to the lead.im
// CRM via its submit API (integration doc ch-123857).
//
// Set EVENTS_LEADIM_FORM_ID + EVENTS_LEADIM_KEY in .env, and
// EVENTS_LEADIM_ENABLED=true to actually send (off by default so dev/test
// submissions don't land in the client's CRM).
const LEADIM_URL = "https://api.lead.im/v2/submit";
const LEADIM_FORM_ID = process.env.EVENTS_LEADIM_FORM_ID || "";
const LEADIM_KEY = process.env.EVENTS_LEADIM_KEY || "";
const LEADIM_ENABLED = process.env.EVENTS_LEADIM_ENABLED === "true";

// Attribution params we carry from the landing URL through the lead form.
export const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
];

const MOBILE_UA = /Mobi|Android|iPhone|iPad|iPod/i;
export const deviceFromUserAgent = (ua = "") =>
  MOBILE_UA.test(ua) ? "mobile" : "desktop";

// lead.im caps most fields at 300 chars and source/msg at 3500.
const clip = (v, max = 300) =>
  v == null || v === "" ? "" : String(v).slice(0, max);

// Best-effort, fire-and-forget — never let a lead.im failure affect the
// visitor's submission (the DB row is already the source of truth).
export const postLeadToLeadim = async ({
  subject,
  name,
  phone,
  email,
  choice,
  message,
  pageTitle,
  pageUrl,
  branch,
  device,
  ref,
  tracking = {},
}) => {
  if (!LEADIM_ENABLED || !LEADIM_FORM_ID || !LEADIM_KEY) return;

  const params = new URLSearchParams({
    lm_form: LEADIM_FORM_ID,
    lm_key: LEADIM_KEY,
    lm_redirect: "no",
    lm_format: "json",
    lm_source: clip(pageUrl, 3500),
    fld_subject: clip(subject),
    fld_name: clip(name),
    fld_phone: clip(phone),
    fld_email: clip(email),
    fld_73800: clip(choice),
    fld_msg: clip(message, 3500),
    fld_85234: clip(pageTitle),
    campus_name: clip(branch),
    device: clip(device),
    ref: clip(ref),
  });
  for (const key of TRACKING_PARAMS) params.set(key, clip(tracking[key]));

  try {
    const res = await fetch(LEADIM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      },
      body: params.toString(),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.error) {
      console.error(
        `[events][leadim] submit failed (${res.status}):`,
        body?.error || body,
      );
    }
  } catch (e) {
    console.error("[events][leadim] submit failed:", e);
  }
};
