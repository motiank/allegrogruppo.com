// Google Analytics 4 (gtag.js), shared by every page shell in this service.
// Set EVENTS_GA_ID in .env to override the Measurement ID.
const GA_ID = process.env.EVENTS_GA_ID || "G-Z6BVB46PL0";

export const gaSnippet = () => `
  <script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${GA_ID}');
  </script>`;
