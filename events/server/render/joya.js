import { escapeHtml } from "./html.js";
import { BRANCHES } from "../data/branches.js";

// ---------------------------------------------------------------------------
// Joya events landing page — a hand-crafted, modern RTL redesign of
// https://joya.co.il/אירועים/
//
// Content (Hebrew copy) is lifted from the original page; the layout is a
// fresh, modern design. Images live in /images/joya/ (downloaded from the
// source site). Branch pages, the full menu page and the privacy page are
// linked as placeholders — they'll be built later.
// ---------------------------------------------------------------------------

// External / future assets ---------------------------------------------------
const EVENTS_MENU_PDF =
  "https://joya.co.il/wp-content/uploads/2024/01/%D7%AA%D7%A4%D7%A8%D7%99%D7%98%D7%99-%D7%90%D7%99%D7%A8%D7%95%D7%A2%D7%99%D7%9D-%D7%92%D7%95%D7%99%D7%94-1.pdf";
const PHONE_DISPLAY = "073-7592993";
const PHONE_TEL = "+972737592993";
const CONTACT_NAME = "מעיין";
const FACEBOOK = "https://www.facebook.com/NOUVAJOYA";
const INSTAGRAM = "https://www.instagram.com/joyarest/";

// Branch list (the "סניפים" section + the form dropdown) comes from the shared
// branch data so /joya and the /joya/branches pages never drift apart.

const EVENT_TYPES = [
  { t: "ימי הולדת", d: "חוגגים יום הולדת עם הקרובים סביב שולחן איטלקי עשיר." },
  { t: "חגיגות משפחתיות", d: "ארוחות חג, בריתות ואירועים משפחתיים בכל גודל." },
  { t: "אירועים עסקיים", d: "ארוחות צוות, השקות ואירוחי לקוחות ברמה." },
  { t: "שמחות", d: "אירועים אינטימיים בחדר פרטי או סגירת מסעדה מלאה." },
  { t: "אירועי חברה", d: "מסיבות סוף שנה ואירועי חברה בלתי נשכחים." },
  { t: "ימי גיבוש", d: "ימי גיבוש וצוות סביב אוכל טוב ואווירה חמה." },
];

// Inline SVG line-icons keep the page self-contained (no icon font / CDN).
const ICONS = {
  room: '<path d="M3 21V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v16M3 21h18M9 21v-6h6v6"/>',
  restaurant:
    '<path d="M4 3v7a3 3 0 0 0 6 0V3M7 10v11M17 3c-1.7 0-3 2-3 5s1.3 4 3 4v9"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  projector:
    '<rect x="2" y="7" width="20" height="11" rx="2"/><circle cx="8" cy="12.5" r="2.5"/><path d="M16 11h2"/>',
  sound:
    '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  menu: '<path d="M4 4h16M4 9h16M4 14h10M4 19h10"/>',
};

const FEATURES = [
  { icon: "room", t: "חדרים פרטיים", d: "חלל אינטימי ופרטי לאירוע שלכם." },
  { icon: "restaurant", t: "סגירת מסעדה", d: "סגירת המסעדה כולה לאירוע גדול ומרגש." },
  { icon: "music", t: "מוזיקת רקע", d: "פסקול שמתאים בדיוק לאווירה שתרצו." },
  { icon: "projector", t: "ציוד הקרנה", d: "מסך ומקרן לברכות, מצגות וסרטונים." },
  { icon: "sound", t: "מערכת הגברה", d: "הגברה מקצועית לנאומים ולמוזיקה." },
  { icon: "menu", t: "ייעוץ ובניית תפריט", d: "מנהלת אירועים שמלווה אתכם עד הפרט האחרון." },
];

const GALLERY = Array.from({ length: 12 }, (_, i) => `/images/joya/g-${String(i + 1).padStart(2, "0")}.jpg`);

const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

export const renderJoyaPage = ({ baseUrl = "" } = {}) => {
  const url = `${baseUrl}/joya`;
  const ogImage = `${baseUrl}/images/joya/hero-1.jpg`;

  const shortName = (b) => b.name.replace(/^ג׳ויה\s*/, "");

  const branchChips = BRANCHES.map(
    (b) => `
        <a class="branch-chip" href="/joya/branches/${b.slug}">
          <span class="branch-name">${escapeHtml(shortName(b))}</span>
          ${b.kosher ? '<span class="kosher-tag">כשר</span>' : ""}
        </a>`,
  ).join("");

  const branchOptions = BRANCHES.map(
    (b) =>
      `<option value="${escapeHtml(b.slug)}">${escapeHtml(shortName(b))}${b.kosher ? " (כשר)" : ""}</option>`,
  ).join("");

  const eventTypeCards = EVENT_TYPES.map(
    (e) => `
        <article class="type-card">
          <h3>${escapeHtml(e.t)}</h3>
          <p>${escapeHtml(e.d)}</p>
        </article>`,
  ).join("");

  const featureCards = FEATURES.map(
    (f) => `
        <article class="feature-card">
          <span class="feature-icon">${icon(f.icon)}</span>
          <h3>${escapeHtml(f.t)}</h3>
          <p>${escapeHtml(f.d)}</p>
        </article>`,
  ).join("");

  const galleryItems = GALLERY.map(
    (src, i) =>
      `<figure class="gallery-item"><img src="${src}" alt="אירוע בג׳ויה ${i + 1}" loading="lazy" /></figure>`,
  ).join("");

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>אירועים בג׳ויה | Joya Cucina Italiana</title>
  <meta name="description" content="מסעדת ג׳ויה האיטלקית מזמינה אתכם לחגוג אירועים מ-15 ועד 200 אורחים: ימי הולדת, אירועים עסקיים, שמחות וימי גיבוש, עם אוכל איטלקי אותנטי ואווירה חמה." />
  <link rel="canonical" href="${escapeHtml(url)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="אירועים בג׳ויה | Joya Cucina Italiana" />
  <meta property="og:description" content="חוגגים אירוע? אוכל איטלקי אותנטי, חדרים פרטיים וסגירת מסעדה — מ-15 ועד 200 אורחים." />
  <meta property="og:url" content="${escapeHtml(url)}" />
  <meta property="og:image" content="${escapeHtml(ogImage)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Assistant:wght@300;400;500;600;700&family=Frank+Ruhl+Libre:wght@500;700;900&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/css/joya.css" />
</head>
<body>
  <!-- Header -->
  <header class="site-header" id="top">
    <div class="container header-inner">
      <a class="brand" href="/joya" aria-label="ג׳ויה">
        <img src="/images/joya/logo-dark.png" alt="Joya Cucina Italiana" />
      </a>
      <nav class="main-nav">
        <a href="#about">אודות</a>
        <a href="#services">השירות שלנו</a>
        <a href="#gallery">גלריה</a>
        <a href="#branches">סניפים</a>
        <a href="#lead">צרו קשר</a>
      </nav>
      <a class="phone-cta" href="tel:${PHONE_TEL}">
        <span class="phone-label">${escapeHtml(CONTACT_NAME)}</span>
        <span class="phone-num">${escapeHtml(PHONE_DISPLAY)}</span>
      </a>
    </div>
  </header>

  <!-- Hero -->
  <section class="hero">
    <div class="hero-bg" style="background-image:url('/images/joya/hero-1.jpg')"></div>
    <div class="hero-overlay"></div>
    <div class="container hero-content">
      <p class="eyebrow">Joya · Cucina Italiana</p>
      <h1>אירועים בג׳ויה</h1>
      <p class="hero-quote">"לקרב בין אנשים, זה מה שהאוכל האיטלקי עושה הכי טוב"</p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="#lead">להשארת פרטים</a>
        <a class="btn btn-ghost" href="${escapeHtml(EVENTS_MENU_PDF)}" target="_blank" rel="noopener">תפריט אירועים</a>
      </div>
      <p class="hero-capacity"><strong>15–200</strong> אורחים · חדר פרטי או מסעדה מלאה</p>
    </div>
  </section>

  <!-- About -->
  <section class="about section" id="about">
    <div class="container about-grid">
      <div class="about-text">
        <p class="section-eyebrow">לחגוג באיטלקית</p>
        <h2>אירוע שמרגישים בלב</h2>
        <p>מסעדת ג׳ויה האיטלקית מזמינה אתכם לחגוג אירועים קטנים כגדולים החל מ-15 ועד 200 אורחים. במסעדות הצבעוניות ניתן לקיים אירוע בחדר פרטי ואינטימי או לסגור את המסעדה כולה ולערוך אירוע גדול ומרגש עם אוכל איטלקי אותנטי ואווירה חמה וסוחפת.</p>
        <p>אנו עורכים דרך קבע אירועים עסקיים ושמחות — החל מימי הולדת וחגיגות משפחתיות, ועד לאירועי חברה וימי גיבוש. התפריט האיטלקי העשיר שלנו כולל מגוון מנות מסורתיות עם ניחוחות של איטליה וטעמים של עוד, שיהפכו את האירוע שלכם ליוקרתי ומהנה במיוחד.</p>
        <p>מנהלת האירועים שלנו מלווה אתכם לאורך כל הדרך — מבחירת הסניף והחדר המתאים ועד לבניית תפריט בהתאם לתקציבכם. בכל אירוע ניתן לשנות, להחליף ולהוסיף מנות בהתאם לסוג האירוע ולחוויה שתרצו להעניק לאורחים.</p>
      </div>
      <div class="about-media">
        <img src="/images/joya/hero-2.jpg" alt="חלל אירועים בג׳ויה" loading="lazy" />
      </div>
    </div>
  </section>

  <!-- Stats -->
  <section class="stats">
    <div class="container stats-grid">
      <div class="stat"><span class="stat-num">15–200</span><span class="stat-label">אורחים לאירוע</span></div>
      <div class="stat"><span class="stat-num">10</span><span class="stat-label">סניפים ברחבי הארץ</span></div>
      <div class="stat"><span class="stat-num">חדרים</span><span class="stat-label">פרטיים ואינטימיים</span></div>
      <div class="stat"><span class="stat-num">ליווי</span><span class="stat-label">מנהלת אירועים אישית</span></div>
    </div>
  </section>

  <!-- Event types -->
  <section class="types section" id="types">
    <div class="container">
      <header class="section-head">
        <p class="section-eyebrow">איזה אירוע חוגגים?</p>
        <h2>לכל סיבה למסיבה</h2>
      </header>
      <div class="type-grid">${eventTypeCards}
      </div>
    </div>
  </section>

  <!-- Services -->
  <section class="services section" id="services">
    <div class="container">
      <header class="section-head">
        <p class="section-eyebrow">הכל מאורגן</p>
        <h2>השירות שלנו</h2>
      </header>
      <div class="feature-grid">${featureCards}
      </div>
    </div>
  </section>

  <!-- Gallery -->
  <section class="gallery section" id="gallery">
    <div class="container">
      <header class="section-head">
        <p class="section-eyebrow">רגעים מהמסעדות</p>
        <h2>גלריה</h2>
      </header>
      <div class="gallery-grid">${galleryItems}
      </div>
    </div>
  </section>

  <!-- Branches -->
  <section class="branches section" id="branches">
    <div class="container">
      <header class="section-head">
        <p class="section-eyebrow">איפה חוגגים</p>
        <h2>הסניפים שלנו</h2>
      </header>
      <div class="branch-grid">${branchChips}
      </div>
    </div>
  </section>

  <!-- Lead form -->
  <section class="lead section" id="lead">
    <div class="container lead-grid">
      <div class="lead-intro">
        <p class="section-eyebrow">בואו נחגוג יחד</p>
        <h2>חוגגים אירוע?<br/>השאירו פרטים ונחזור אליכם</h2>
        <p>מנהלת האירועים שלנו תחזור אליכם עם כל הפרטים, תתאים לכם סניף וחדר ותבנה יחד אתכם את התפריט המושלם.</p>
        <a class="lead-phone" href="tel:${PHONE_TEL}">
          לפרטים נוספים: ${escapeHtml(CONTACT_NAME)} · ${escapeHtml(PHONE_DISPLAY)}
        </a>
      </div>

      <form class="lead-form" method="post" action="/joya/inquiry" novalidate>
        <div class="field">
          <label for="name">שם מלא</label>
          <input id="name" name="name" type="text" autocomplete="name" required />
        </div>
        <div class="field-row">
          <div class="field">
            <label for="phone">טלפון</label>
            <input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required />
          </div>
          <div class="field">
            <label for="email">אימייל</label>
            <input id="email" name="email" type="email" autocomplete="email" />
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="guests">מספר אורחים</label>
            <input id="guests" name="guests" type="number" min="15" max="200" inputmode="numeric" placeholder="15–200" />
          </div>
          <div class="field">
            <label for="event_date">תאריך האירוע</label>
            <input id="event_date" name="event_date" type="date" />
          </div>
        </div>
        <div class="field">
          <label for="branch">בחירת סניף</label>
          <select id="branch" name="branch">
            <option value="">בחרו סניף</option>
            ${branchOptions}
          </select>
        </div>
        <div class="field">
          <label for="message">פרטי האירוע (אופציונלי)</label>
          <textarea id="message" name="message" rows="3" placeholder="סוג האירוע, שעה, בקשות מיוחדות..."></textarea>
        </div>
        <label class="consent">
          <input type="checkbox" name="consent" value="1" required />
          <span>קראתי ואני מסכים/ה ל<a href="/joya/privacy" target="_blank" rel="noopener">מדיניות הפרטיות</a>.</span>
        </label>
        <button class="btn btn-primary btn-block" type="submit">שליחה</button>
        <p class="form-note">שדות חובה: שם וטלפון. נחזור אליכם בהקדם.</p>
      </form>
    </div>
  </section>

  <!-- Footer -->
  <footer class="site-footer">
    <div class="container footer-inner">
      <div class="footer-brand">
        <img src="/images/joya/logo-dark.png" alt="Joya Cucina Italiana" />
        <p>אוכל איטלקי אותנטי, אווירה חמה, ואירועים בלתי נשכחים.</p>
      </div>
      <div class="footer-contact">
        <a href="tel:${PHONE_TEL}">${escapeHtml(CONTACT_NAME)} · ${escapeHtml(PHONE_DISPLAY)}</a>
        <div class="footer-social">
          <a href="${FACEBOOK}" target="_blank" rel="noopener" aria-label="Facebook">Facebook</a>
          <a href="${INSTAGRAM}" target="_blank" rel="noopener" aria-label="Instagram">Instagram</a>
        </div>
      </div>
    </div>
    <p class="footer-copy">&copy; ${new Date().getFullYear()} Joya · Allegro Gruppo</p>
  </footer>
</body>
</html>`;
};
