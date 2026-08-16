// Google Tag Manager, shared by every page shell in this service.
// Set EVENTS_GTM_ID in .env to override the container ID.
const GTM_ID = process.env.EVENTS_GTM_ID || "GTM-WHSP2KRX";

// Goes as early as possible in <head>, per Google's own install instructions.
export const gtmHeadSnippet = () => `
  <!-- Google Tag Manager -->
  <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
  new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
  j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
  'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
  })(window,document,'script','dataLayer','${GTM_ID}');</script>
  <!-- End Google Tag Manager -->`;

// Goes immediately after the opening <body> tag (noscript fallback).
export const gtmBodySnippet = () => `
  <!-- Google Tag Manager (noscript) -->
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${GTM_ID}"
  height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
  <!-- End Google Tag Manager (noscript) -->`;
