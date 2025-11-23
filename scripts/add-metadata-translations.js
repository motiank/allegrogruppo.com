import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper function to check if text is Hebrew
function isHebrew(text) {
  if (!text || typeof text !== 'string') return false;
  return /[\u0590-\u05FF]/.test(text);
}

// Import translation dictionary from the menu translation script
// This uses the same comprehensive dictionary
const translationDict = {
  en: {
    'שיפוד פילה בקר': 'Beef Fillet Skewer',
    'אנטריקוט': 'Entrecote',
    'קרפציו פילה בקר': 'Beef Fillet Carpaccio',
    'לחם': 'Bread',
    'סאלסיצ׳ה': 'Salsiccia',
    'פנצנלה': 'Panzenella',
    'קפונטה': 'Cappuccino',
    'רוסטביף': 'Roast Beef',
    'סיגר שורט ריב': 'Short Rib Cigar',
    'צלחת נקניקים': 'Sausage Plate',
    'הסופרנוס': 'The Sopranos',
    'שורט ריבס': 'Short Ribs',
    'כריך אנטריקוט': 'Entrecote Sandwich',
    'המבורגר קלאסי': 'Classic Hamburger',
    'המבורגר פיאמונטה': 'Piedmont Hamburger',
    'קריספי צ\'יקן': 'Crispy Chicken',
    'בולונז': 'Bolognese',
    'סלט ברזל': 'Iron Salad',
    'שניצל': 'Schnitzel',
    'שניצל סציליאני': 'Sicilian Schnitzel',
    'פילה בקר': 'Beef Fillet',
    'שיפוד': 'Skewer',
    'קרפציו': 'Carpaccio',
    'פיצה': 'Pizza',
    'פסטה': 'Pasta',
    'סלט': 'Salad',
    'המבורגר': 'Hamburger',
    'עוף': 'Chicken',
    'בקר': 'Beef',
    'דג': 'Fish',
    'סלמון': 'Salmon',
    'טונה': 'Tuna',
  },
  ar: {
    'שיפוד פילה בקר': 'سيخ فيليه لحم بقري',
    'אנטריקוט': 'أنتريكوت',
    'קרפציו פילה בקר': 'كارباتشيو فيليه لحم بقري',
    'לחם': 'خبز',
    'סאלסיצ׳ה': 'سالسيتشا',
    'פנצנלה': 'بانزينيلا',
    'קפונטה': 'كابتشينو',
    'רוסטביף': 'لحم مشوي',
    'סיגר שורט ריב': 'سيجار الأضلاع القصيرة',
    'צלחת נקניקים': 'طبق النقانق',
    'הסופרנוס': 'السوبرانوس',
    'שורט ריבס': 'أضلاع قصيرة',
    'כריך אנטריקוט': 'ساندويتش أنتريكوت',
    'המבורגר קלאסי': 'هامبرجر كلاسيكي',
    'המבורגר פיאמונטה': 'هامبرجر بيدمونت',
    'קריספי צ\'יקן': 'دجاج مقرمش',
    'בולונז': 'بولونيز',
    'סלט ברזל': 'سلطة الحديد',
    'שניצל': 'شنتسل',
    'שניצל סציליאני': 'شنتسل صقلي',
    'פילה בקר': 'فيليه لحم بقري',
    'שיפוד': 'سيخ',
    'קרפציו': 'كارباتشيو',
    'פיצה': 'بيتزا',
    'פסטה': 'باستا',
    'סלט': 'سلطة',
    'המבורגר': 'هامبرجر',
    'עוף': 'دجاج',
    'בקר': 'لحم بقري',
    'דג': 'سمك',
    'סלמון': 'سلمون',
    'טונה': 'تونة',
  },
};

// Helper function to translate dish name
function translateDishName(hebrewName, lang) {
  if (!hebrewName || !isHebrew(hebrewName)) return hebrewName;
  
  const dict = translationDict[lang] || {};
  const trimmed = hebrewName.trim();
  
  // Try exact match first (longer phrases first)
  const sortedKeys = Object.keys(dict).sort((a, b) => b.length - a.length);
  for (const hebrew of sortedKeys) {
    if (trimmed === hebrew || trimmed === hebrew.trim()) {
      return dict[hebrew];
    }
  }
  
  // Try partial matches (for compound names) - longest first
  for (const hebrew of sortedKeys) {
    if (trimmed.includes(hebrew)) {
      // Replace the Hebrew part with translation
      return trimmed.replace(hebrew, dict[hebrew]);
    }
  }
  
  // If no translation found, return Hebrew (better than showing ID)
  return hebrewName;
}

// Read the metadata file
const metadataPath = join(__dirname, '..', 'menu', 'labraca_metadata.json');
console.log('Reading metadata from:', metadataPath);
const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));

// Add nameTranslate to each dish
let translatedCount = 0;
if (metadata.dishMappings) {
  for (const dishId in metadata.dishMappings) {
    const dish = metadata.dishMappings[dishId];
    if (dish.dishName && !dish.nameTranslate) {
      const hebrewName = dish.dishName.trim();
      dish.nameTranslate = {
        he: hebrewName,
        en: translateDishName(hebrewName, 'en'),
        ar: translateDishName(hebrewName, 'ar'),
      };
      translatedCount++;
    }
  }
}

// Write the updated metadata
console.log('Writing updated metadata to:', metadataPath);
writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

console.log(`✅ Added nameTranslate to ${translatedCount} dishes in labraca_metadata.json`);

