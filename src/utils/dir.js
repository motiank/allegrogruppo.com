/**
 * Set document direction based on language
 */
export const setDocumentDirection = (lang) => {
  const html = document.documentElement;
  if (lang === 'he' || lang === 'ar') {
    html.setAttribute('dir', 'rtl');
  } else {
    html.setAttribute('dir', 'ltr');
  }
};

/**
 * Get language from URL parameter
 */
export const getLanguageFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  return params.get('lang') || 'he';
};

