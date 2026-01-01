import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper function to check if text is Hebrew (contains Hebrew characters)
function isHebrew(text) {
  if (!text || typeof text !== 'string') return false;
  return /[\u0590-\u05FF]/.test(text);
}

// Translation dictionary - comprehensive dictionary for tower menu
const translationDict = {
  en: {
    'מידת עשייה': 'Doneness level',
    'המבורגר קלאסי': 'Classic Hamburger',
    'המבורגר': 'Hamburger',
    'קלאסי': 'Classic',
    'שניצל': 'Schnitzel',
    'פסטה בולונז': 'Bolognese Pasta',
    'בולונז': 'Bolognese',
    'סלט ברזל': 'Iron Salad',
    'ברזל': 'Iron',
    'סלט ירוק': 'Green Salad',
    'ירוק': 'Green',
    'תוספת': 'Extra',
    'תפוח אדמה': 'Potato',
    'תפוחי אדמה': 'Potatoes',
    'סלט ירוק  תוספת': 'Green Salad Extra',
  },
  ar: {
    'מידת עשייה': 'مستوى النضج',
    'המבורגר קלאסי': 'هامبرجر كلاسيكي',
    'המבורגר': 'هامبرجر',
    'קלאסי': 'كلاسيكي',
    'שניצל': 'شنتسل',
    'פסטה בולונז': 'باستا بولونيز',
    'בולונז': 'بولونيز',
    'סלט ברזל': 'سلطة الحديد',
    'ברזל': 'حديد',
    'סלט ירוק': 'سلطة خضراء',
    'ירוק': 'أخضر',
    'תוספת': 'إضافة',
    'תפוח אדמה': 'بطاطا',
    'תפוחי אדמה': 'بطاطا',
    'סלט ירוק  תוספת': 'سلطة خضراء إضافية',
  },
};

// Helper function to translate Hebrew text
function translateHebrew(hebrewText, lang) {
  if (!hebrewText || !isHebrew(hebrewText)) return hebrewText;
  
  const dict = translationDict[lang] || {};
  let translated = hebrewText.trim();
  
  // First, try to find exact phrase matches (longer phrases first)
  const sortedKeys = Object.keys(dict).sort((a, b) => b.length - a.length);
  for (const hebrew of sortedKeys) {
    if (translated === hebrew || translated === hebrew.trim()) {
      return dict[hebrew];
    }
  }
  
  // Try partial matches (for compound names) - longest first
  for (const hebrew of sortedKeys) {
    if (translated.includes(hebrew)) {
      // Replace the Hebrew part with translation
      return translated.replace(hebrew, dict[hebrew]);
    }
  }
  
  // If no translation found, return Hebrew (better than showing ID)
  return hebrewText;
}

// Function to fix translations in an object
function fixTranslations(obj) {
  if (Array.isArray(obj)) {
    return obj.map(item => fixTranslations(item));
  } else if (obj && typeof obj === 'object') {
    const fixed = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'title' || key === 'label') {
        // This is a translation object
        if (value && typeof value === 'object' && 'he' in value && 'en' in value && 'ar' in value) {
          const he = value.he?.trim() || '';
          const en = value.en?.trim() || '';
          const ar = value.ar?.trim() || '';
          
          // Check if all three are the same Hebrew text (missing translation)
          if (he && isHebrew(he) && he === en && he === ar) {
            fixed[key] = {
              he: he,
              en: translateHebrew(he, 'en'),
              ar: translateHebrew(he, 'ar'),
            };
          } else {
            // Check if en or ar are Hebrew when they shouldn't be
            let fixedEn = en;
            let fixedAr = ar;
            
            if (en && isHebrew(en)) {
              fixedEn = translateHebrew(en, 'en');
            } else if (!en && he) {
              fixedEn = translateHebrew(he, 'en');
            }
            
            if (ar && isHebrew(ar)) {
              fixedAr = translateHebrew(ar, 'ar');
            } else if (!ar && he) {
              fixedAr = translateHebrew(he, 'ar');
            }
            
            fixed[key] = {
              he: he,
              en: fixedEn,
              ar: fixedAr,
            };
          }
        } else {
          fixed[key] = fixTranslations(value);
        }
      } else if (key === 'nameTranslate') {
        // Handle nameTranslate in metadata
        if (value && typeof value === 'object' && 'he' in value && 'en' in value && 'ar' in value) {
          const he = value.he?.trim() || '';
          const en = value.en?.trim() || '';
          const ar = value.ar?.trim() || '';
          
          // Check if translations are needed
          const needsTranslation = !value || isHebrew(en) || isHebrew(ar);
          
          if (needsTranslation) {
            fixed[key] = {
              he: he,
              en: isHebrew(en) ? translateHebrew(he, 'en') : (en || translateHebrew(he, 'en')),
              ar: isHebrew(ar) ? translateHebrew(he, 'ar') : (ar || translateHebrew(he, 'ar')),
            };
          } else {
            fixed[key] = value;
          }
        } else {
          fixed[key] = fixTranslations(value);
        }
      } else {
        fixed[key] = fixTranslations(value);
      }
    }
    return fixed;
  }
  return obj;
}

// Read the tower menu file
const menuPath = join(__dirname, '..', 'menu', 'tower_menu.json');
console.log('Reading tower menu from:', menuPath);
const menu = JSON.parse(readFileSync(menuPath, 'utf8'));

// Fix translations
console.log('Fixing translations...');
const fixedMenu = fixTranslations(menu);

// Write the fixed menu back
console.log('Writing fixed menu to:', menuPath);
writeFileSync(menuPath, JSON.stringify(fixedMenu, null, 2), 'utf8');

// Also fix metadata file
const metadataPath = join(__dirname, '..', 'menu', 'tower_metadata.json');
console.log('Reading tower metadata from:', metadataPath);
const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));

console.log('Fixing metadata translations...');
const fixedMetadata = fixTranslations(metadata);

console.log('Writing fixed metadata to:', metadataPath);
writeFileSync(metadataPath, JSON.stringify(fixedMetadata, null, 2), 'utf8');

console.log('✅ Successfully fixed translations in tower_menu.json and tower_metadata.json');

