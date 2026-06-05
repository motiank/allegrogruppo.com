import { escapeHtml } from "./html.js";

// Shared chrome (document shell + header + footer) for Joya-branded pages,
// so /joya and the /joya/branches/* pages look identical and stay in sync.

export const PHONE_TEL = "+972737592993";
export const PHONE_DISPLAY = "073-7592993";
export const CONTACT_NAME = "מעיין";
export const FACEBOOK = "https://www.facebook.com/NOUVAJOYA";
export const INSTAGRAM = "https://www.instagram.com/joyarest/";

// Header. `home` controls whether nav anchors are local (#) or jump to /joya.
export const joyaHeader = ({ home = false } = {}) => {
  const a = (hash, label) =>
    `<a href="${home ? "" : "/joya"}#${hash}">${label}</a>`;
  return `
  <header class="site-header" id="top">
    <div class="container header-inner">
      <a class="brand" href="/joya" aria-label="ג׳ויה">
        <img src="/images/joya/logo-dark.png" alt="Joya Cucina Italiana" />
      </a>
      <nav class="main-nav">
        ${a("about", "אודות")}
        ${a("services", "אירועים")}
        <a href="/joya/branches">סניפים</a>
        ${a("gallery", "גלריה")}
        ${a("lead", "צרו קשר")}
      </nav>
      <a class="phone-cta" href="tel:${PHONE_TEL}">
        <span class="phone-label">${escapeHtml(CONTACT_NAME)}</span>
        <span class="phone-num">${escapeHtml(PHONE_DISPLAY)}</span>
      </a>
    </div>
  </header>`;
};

export const joyaFooter = () => `
  <footer class="site-footer">
    <div class="container footer-inner">
      <div class="footer-brand">
        <img src="/images/joya/logo-dark.png" alt="Joya Cucina Italiana" />
        <p>אוכל איטלקי אותנטי, אווירה חמה, ואירועים בלתי נשכחים.</p>
      </div>
      <div class="footer-contact">
        <a href="tel:${PHONE_TEL}">${escapeHtml(CONTACT_NAME)} · ${escapeHtml(PHONE_DISPLAY)}</a>
        <div class="footer-social">
          <a href="${FACEBOOK}" target="_blank" rel="noopener">Facebook</a>
          <a href="${INSTAGRAM}" target="_blank" rel="noopener">Instagram</a>
        </div>
      </div>
    </div>
    <p class="footer-copy">&copy; ${new Date().getFullYear()} Joya · Allegro Gruppo</p>
  </footer>`;

// Full RTL document shell with shared fonts + stylesheet.
export const joyaDoc = ({
  title,
  description = "",
  canonical = "",
  ogImage = "",
  ogType = "website",
  body,
}) => `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  ${description ? `<meta name="description" content="${escapeHtml(description)}" />` : ""}
  ${canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}" />` : ""}
  <meta property="og:type" content="${escapeHtml(ogType)}" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  ${description ? `<meta property="og:description" content="${escapeHtml(description)}" />` : ""}
  ${canonical ? `<meta property="og:url" content="${escapeHtml(canonical)}" />` : ""}
  ${ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}" />` : ""}
  <meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Assistant:wght@300;400;500;600;700&family=Frank+Ruhl+Libre:wght@500;700;900&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/css/joya.css" />
</head>
<body>
${body}
</body>
</html>`;
