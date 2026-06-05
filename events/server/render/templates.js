import { escapeHtml } from "./html.js";

// ---------------------------------------------------------------------------
// Server-side templates for the events landing-page service.
//
// These are plain template-literal functions (no template engine) so the
// service stays lightweight and easy to reason about. Every value coming from
// the database is passed through escapeHtml(); body_html is the only field
// rendered as raw HTML and is expected to be trusted content authored via the
// admin backend.
// ---------------------------------------------------------------------------

// Format a DATETIME (UTC, as stored) for display. Falls back to empty string.
const formatDateRange = (startsAt, endsAt, locale = "he-IL") => {
  if (!startsAt) return "";
  const opts = {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jerusalem",
  };
  try {
    const start = new Date(startsAt);
    const startStr = new Intl.DateTimeFormat(locale, opts).format(start);
    if (!endsAt) return startStr;
    const end = new Date(endsAt);
    const endStr = new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Jerusalem",
    }).format(end);
    return `${startStr} – ${endStr}`;
  } catch {
    return "";
  }
};

// Shared <head> + page shell. `head` holds page-specific meta tags.
const layout = ({ title, lang = "he", head = "", body }) => {
  const dir = lang === "he" || lang === "ar" ? "rtl" : "ltr";
  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}" dir="${dir}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/css/events.css" />
  ${head}
</head>
<body>
  ${body}
  <footer class="site-footer">
    <p>&copy; ${new Date().getFullYear()} Allegro Gruppo</p>
  </footer>
</body>
</html>`;
};

// Open Graph / Twitter card meta for rich link previews (WhatsApp, FB, X,
// Google). This is the main reason the service is server-rendered.
const socialMeta = ({ title, description, image, url, type = "website" }) => {
  const tags = [
    ["og:type", type],
    ["og:title", title],
    ["og:description", description],
    ["og:url", url],
    ["og:image", image],
    ["twitter:card", image ? "summary_large_image" : "summary"],
    ["twitter:title", title],
    ["twitter:description", description],
    ["twitter:image", image],
  ];
  const metaTags = tags
    .filter(([, content]) => content)
    .map(([property, content]) => {
      const attr = property.startsWith("twitter:") ? "name" : "property";
      return `  <meta ${attr}="${escapeHtml(property)}" content="${escapeHtml(content)}" />`;
    })
    .join("\n");
  const canonical = url ? `  <link rel="canonical" href="${escapeHtml(url)}" />\n` : "";
  const desc = description
    ? `  <meta name="description" content="${escapeHtml(description)}" />\n`
    : "";
  return `${desc}${canonical}${metaTags}`;
};

// Single event landing page.
export const renderEventPage = ({ event, restaurant, baseUrl }) => {
  const url = `${baseUrl}/${encodeURIComponent(restaurant)}/${encodeURIComponent(event.slug)}`;
  const image = event.og_image_url || event.hero_image_url || "";
  const description = event.summary || "";
  const dateStr = formatDateRange(event.starts_at, event.ends_at);

  const head = socialMeta({
    title: event.title,
    description,
    image: image && !/^https?:\/\//.test(image) ? `${baseUrl}${image}` : image,
    url,
    type: "article",
  });

  const hero = event.hero_image_url
    ? `<div class="event-hero" style="background-image:url('${escapeHtml(event.hero_image_url)}')"></div>`
    : "";

  const meta = [
    dateStr && `<li class="event-when">🗓️ ${escapeHtml(dateStr)}</li>`,
    event.location && `<li class="event-where">📍 ${escapeHtml(event.location)}</li>`,
    event.price && `<li class="event-price">🎟️ ${escapeHtml(event.price)}</li>`,
  ]
    .filter(Boolean)
    .join("\n");

  const cta =
    event.cta_url && event.cta_label
      ? `<a class="event-cta" href="${escapeHtml(event.cta_url)}">${escapeHtml(event.cta_label)}</a>`
      : "";

  const body = `
  <main class="event-page">
    ${hero}
    <article class="event-body">
      <header class="event-header">
        <p class="event-restaurant">${escapeHtml(restaurant)}</p>
        <h1 class="event-title">${escapeHtml(event.title)}</h1>
        ${event.subtitle ? `<p class="event-subtitle">${escapeHtml(event.subtitle)}</p>` : ""}
        ${meta ? `<ul class="event-meta">${meta}</ul>` : ""}
      </header>
      <div class="event-content">
        ${event.body_html || (event.summary ? `<p>${escapeHtml(event.summary)}</p>` : "")}
      </div>
      ${cta}
    </article>
  </main>`;

  return layout({ title: event.title, lang: event.lang || "he", head, body });
};

// Listing of all published events for a restaurant.
export const renderEventList = ({ events, restaurant, baseUrl }) => {
  const url = `${baseUrl}/${encodeURIComponent(restaurant)}`;
  const title = `Events – ${restaurant}`;
  const head = socialMeta({
    title,
    description: `Upcoming events at ${restaurant}`,
    url,
  });

  const cards = events.length
    ? events
        .map((ev) => {
          const evUrl = `/${encodeURIComponent(restaurant)}/${encodeURIComponent(ev.slug)}`;
          const dateStr = formatDateRange(ev.starts_at, ev.ends_at);
          const thumb = ev.hero_image_url
            ? `<div class="card-thumb" style="background-image:url('${escapeHtml(ev.hero_image_url)}')"></div>`
            : "";
          return `
      <a class="event-card" href="${escapeHtml(evUrl)}">
        ${thumb}
        <div class="card-body">
          <h2 class="card-title">${escapeHtml(ev.title)}</h2>
          ${dateStr ? `<p class="card-date">${escapeHtml(dateStr)}</p>` : ""}
          ${ev.summary ? `<p class="card-summary">${escapeHtml(ev.summary)}</p>` : ""}
        </div>
      </a>`;
        })
        .join("\n")
    : `<p class="empty-state">No upcoming events.</p>`;

  const body = `
  <main class="event-list-page">
    <header class="list-header">
      <h1>${escapeHtml(restaurant)}</h1>
      <p class="list-subtitle">Upcoming events</p>
    </header>
    <section class="event-grid">
      ${cards}
    </section>
  </main>`;

  return layout({ title, head, body });
};

// Generic 404 page.
export const renderNotFound = ({ message = "Event not found" } = {}) => {
  const body = `
  <main class="not-found">
    <h1>404</h1>
    <p>${escapeHtml(message)}</p>
  </main>`;
  return layout({ title: "Not found", head: '<meta name="robots" content="noindex" />', body });
};
