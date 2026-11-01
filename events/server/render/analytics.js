// Google tag (Tag Manager container), shared by every page shell in this service.
// Set EVENTS_GTM_ID in .env to override the container ID.
const GTM_ID = process.env.EVENTS_GTM_ID || "GTM-PHLC7V6S";

// Goes immediately after the opening <head> tag, per Google's install instructions.
// Only one Google tag per page.
export const gtmHeadSnippet = () => `
  <script async src="https://www.googletagmanager.com/gtm.js?id=${GTM_ID}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
  </script>`;
