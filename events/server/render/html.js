// Tiny HTML rendering helpers for server-side templates.
// Kept dependency-free on purpose: landing pages are simple, content is
// authored by the admin backend, and we want predictable escaping.

const ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

// Escape text for use inside HTML element content or double-quoted attributes.
export const escapeHtml = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
};

// Build the absolute base URL of the current request, used for canonical
// links and Open Graph / Twitter card URLs. Honours EVENTS_PUBLIC_URL when set
// (useful behind a reverse proxy / for the public events.allegrogruppo.com host).
export const baseUrlFor = (req) => {
  if (process.env.EVENTS_PUBLIC_URL) {
    return process.env.EVENTS_PUBLIC_URL.replace(/\/$/, "");
  }
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
};
