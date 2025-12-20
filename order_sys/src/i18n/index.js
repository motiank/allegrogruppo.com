import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import he from './locales/he/common.json';
import en from './locales/en/common.json';
import ar from './locales/ar/common.json';
import ru from './locales/ru/common.json';
import { getLanguageFromUrl, setDocumentDirection } from '../utils/dir.js';

const lang = getLanguageFromUrl();
setDocumentDirection(lang);

i18n
  .use(initReactI18next)
  .init({
    resources: {
      he: { translation: he },
      en: { translation: en },
      ar: { translation: ar },
      ru: { translation: ru },
    },
    lng: lang,
    fallbackLng: 'he',
    interpolation: {
      escapeValue: false,
    },
  });

// Update direction when language changes
i18n.on('languageChanged', (lng) => {
  setDocumentDirection(lng);
});

export default i18n;

