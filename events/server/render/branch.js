import { escapeHtml } from "./html.js";
import { BRANCHES } from "../data/branches.js";
import {
  joyaDoc,
  joyaHeader,
  joyaFooter,
  PHONE_TEL,
} from "./joyaChrome.js";

// ---------------------------------------------------------------------------
// Per-branch landing pages (/joya/branches/:slug) and the branches index
// (/joya/branches). Same modern RTL design language as /joya.
// ---------------------------------------------------------------------------

const telHref = (phone) => "tel:" + String(phone).replace(/[^\d]/g, "").replace(/^0/, "+972");

// Action links shown as buttons (only those that exist for the branch).
const ACTIONS = [
  { key: "reserve", label: "הזמנת מקום", primary: true },
  { key: "menu", label: "לתפריט" },
  { key: "waze", label: "ניווט בוויז" },
  { key: "order", label: "הזמנת משלוח" },
];

const branchActions = (branch) =>
  ACTIONS.filter((a) => branch.links?.[a.key])
    .map(
      (a) =>
        `<a class="btn ${a.primary ? "btn-primary" : "btn-ghost-ink"}" href="${escapeHtml(
          encodeURI(branch.links[a.key]),
        )}" target="_blank" rel="noopener">${a.label}</a>`,
    )
    .join("\n          ");

const galleryMosaic = (branch) =>
  branch.images
    .map(
      (src, i) =>
        `<figure class="gallery-item"><img src="${src}" alt="${escapeHtml(branch.name)} ${i + 1}" loading="lazy" /></figure>`,
    )
    .join("\n        ");

const otherBranchChips = (slug) =>
  BRANCHES.filter((b) => b.slug !== slug)
    .map(
      (b) => `
        <a class="branch-chip" href="/joya/branches/${b.slug}">
          <span class="branch-name">${escapeHtml(b.name)}</span>
          ${b.kosher ? '<span class="kosher-tag">כשר</span>' : ""}
        </a>`,
    )
    .join("");

export const renderBranchPage = ({ branch, baseUrl = "" }) => {
  const url = `${baseUrl}/joya/branches/${branch.slug}`;
  const hero = branch.images[0];
  const ogImage = `${baseUrl}${hero}`;
  const description = branch.description?.[0] || `ג׳ויה ${branch.city}`;

  const hoursRows = (branch.hours || [])
    .map(
      (h) =>
        `<tr><th>${escapeHtml(h.label)}</th><td>${escapeHtml(h.value)}</td></tr>`,
    )
    .join("\n            ");

  const kosherBadge = branch.kosher
    ? `<span class="hero-badge">${escapeHtml(branch.kosherText || "כשר")}</span>`
    : "";

  const body = `
  ${joyaHeader()}

  <section class="branch-hero">
    <div class="hero-bg" style="background-image:url('${escapeHtml(hero)}')"></div>
    <div class="hero-overlay"></div>
    <div class="container hero-content">
      <p class="eyebrow">Joya · Cucina Italiana</p>
      <h1>${escapeHtml(branch.name)}</h1>
      <p class="branch-hero-sub">${escapeHtml(branch.address)} ${kosherBadge}</p>
      <div class="hero-actions">
        ${branchActions(branch)}
      </div>
    </div>
  </section>

  <section class="section branch-info">
    <div class="container branch-info-grid">
      <div class="branch-about">
        <p class="section-eyebrow">${escapeHtml(branch.city)}</p>
        <h2>${escapeHtml(branch.name)}</h2>
        ${(branch.description || []).map((p) => `<p>${escapeHtml(p)}</p>`).join("\n        ")}
      </div>

      <aside class="branch-card">
        <div class="info-row">
          <span class="info-ico" aria-hidden="true">📍</span>
          <div>
            <span class="info-key">כתובת</span>
            <a href="${escapeHtml(encodeURI(branch.links?.waze || "#"))}" target="_blank" rel="noopener">${escapeHtml(branch.address)}</a>
          </div>
        </div>
        <div class="info-row">
          <span class="info-ico" aria-hidden="true">📞</span>
          <div>
            <span class="info-key">טלפון</span>
            <a href="${telHref(branch.phone)}">${escapeHtml(branch.phone)}</a>
          </div>
        </div>
        ${
          branch.kosher
            ? `<div class="info-row">
          <span class="info-ico" aria-hidden="true">✡️</span>
          <div>
            <span class="info-key">כשרות</span>
            <span>${escapeHtml(branch.kosherText || "כשר")}</span>
          </div>
        </div>`
            : ""
        }
        <div class="info-hours">
          <span class="info-key">שעות פתיחה</span>
          <table>
            ${hoursRows}
          </table>
          ${branch.note ? `<p class="info-note">* ${escapeHtml(branch.note)}</p>` : ""}
        </div>
        <div class="branch-card-actions">
          ${branchActions(branch)}
        </div>
      </aside>
    </div>
  </section>

  <section class="section gallery" id="gallery">
    <div class="container">
      <header class="section-head">
        <p class="section-eyebrow">הצצה לסניף</p>
        <h2>גלריה</h2>
      </header>
      <div class="gallery-grid">
        ${galleryMosaic(branch)}
      </div>
    </div>
  </section>

  <section class="branch-events">
    <div class="container branch-events-inner">
      <div>
        <h2>רוצים לחגוג כאן אירוע?</h2>
        <p>אירועים מ-15 ועד 200 אורחים — חדר פרטי או סגירת מסעדה מלאה. השאירו פרטים ונחזור אליכם.</p>
      </div>
      <a class="btn btn-primary" href="/joya#lead">להשארת פרטים</a>
    </div>
  </section>

  <section class="section branches" id="branches">
    <div class="container">
      <header class="section-head">
        <p class="section-eyebrow">עוד סניפים</p>
        <h2>הסניפים שלנו</h2>
      </header>
      <div class="branch-grid">${otherBranchChips(branch.slug)}
      </div>
    </div>
  </section>

  ${joyaFooter()}`;

  return joyaDoc({
    title: `${branch.name} | Joya Cucina Italiana`,
    description,
    canonical: url,
    ogImage,
    ogType: "restaurant.restaurant",
    body,
  });
};

// Index page listing every branch as a rich card.
export const renderBranchesIndex = ({ baseUrl = "" } = {}) => {
  const cards = BRANCHES.map(
    (b) => `
      <a class="branch-list-card" href="/joya/branches/${b.slug}">
        <div class="card-thumb" style="background-image:url('${escapeHtml(b.images[0])}')">
          ${b.kosher ? '<span class="kosher-tag">כשר</span>' : ""}
        </div>
        <div class="card-body">
          <h3>${escapeHtml(b.name)}</h3>
          <p class="card-addr">${escapeHtml(b.address)}</p>
          <span class="card-link">לעמוד הסניף ←</span>
        </div>
      </a>`,
  ).join("\n");

  const body = `
  ${joyaHeader()}
  <section class="section branches-index">
    <div class="container">
      <header class="section-head">
        <p class="section-eyebrow">איפה חוגגים</p>
        <h2>הסניפים שלנו</h2>
      </header>
      <div class="branch-list-grid">${cards}
      </div>
    </div>
  </section>
  ${joyaFooter()}`;

  return joyaDoc({
    title: "הסניפים שלנו | Joya Cucina Italiana",
    description: "סניפי ג׳ויה ברחבי הארץ — כתובות, שעות פתיחה, תפריטים והזמנת מקום.",
    canonical: `${baseUrl}/joya/branches`,
    ogImage: `${baseUrl}/images/joya/hero-1.jpg`,
    body,
  });
};
