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

// Comprehensive translation dictionary for all dish names
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
    'סינטה עגלה': 'Veal Sirloin',
    'מנת ספיישל': 'Special Dish',
    'עוף משקולות': 'Chicken Weights',
    'רבע עוף': 'Quarter Chicken',
    'קבב טלה': 'Lamb Kebab',
    'תפוחי אדמה': 'Potatoes',
    'פריט כללי': 'General Item',
    'סכו"ם': 'Cutlery',
    'סלט ירוק  תוספת': 'Green Salad Extra',
    'הערה למטבח': 'Kitchen Note',
    'בראוניז טבעוני': 'Vegan Brownies',
    'סורבה': 'Sorbet',
    'ג\'סמין': 'Jasmine',
    'תפוזים': 'Oranges',
    'הערה בר': 'Bar Note',
    'קולה': 'Cola',
    'קולה זירו': 'Coke Zero',
    'ספרייט': 'Sprite',
    'ספרייט זירו': 'Sprite Zero',
    'פיוזטי': 'Fusetti',
    'מינרלים זכוכית': 'Mineral Water Glass',
    'פרללה גדול': 'Large Perella',
    'פרללה קטן': 'Small Perella',
    'ענבים': 'Grapes',
    'גסמין גאז': 'Jasmine Gaz',
    'אספרסו': 'Espresso',
    'אספרסו ארוך': 'Long Espresso',
    'תה': 'Tea',
    'קפה שחור': 'Black Coffee',
    'מורטי בקבוק': 'Moretti Bottle',
    'סטלה בקבוק': 'Stella Bottle',
    'כוס סירה ירדן אדום': 'Glass Syrah Jordan Red',
    'סירה ירדן': 'Syrah Jordan',
    'פטיט סירה כוס': 'Petit Syrah Glass',
    'פטיט סירה בקבוק': 'Petit Syrah Bottle',
    'בקבוק קיאנטי': 'Chianti Bottle',
    'כוס קיאנטי': 'Chianti Glass',
    'בקבוק שרדונה תל פארס לבן, רקאנטי': 'Chardonnay Tel Farès White Bottle, Recanti',
    'כוס שרדונה תל פארס לבן, רקאנטי': 'Chardonnay Tel Farès White Glass, Recanti',
    'ירדן גוורץ': 'Jordan Gewürztraminer',
    'כוס ירדן גוורץ': 'Jordan Gewürztraminer Glass',
    'כוס יראון רוזה הרי גליל': 'Yiron Rosé Galilee Mountains Glass',
    'יראון רוזה': 'Yiron Rosé',
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
    'סינטה עגלה': 'لحم عجل سيرلون',
    'מנת ספיישל': 'طبق خاص',
    'עוף משקולות': 'دجاج بأوزان',
    'רבע עוף': 'ربع دجاج',
    'קבב טלה': 'كباب خروف',
    'תפוחי אדמה': 'بطاطا',
    'פריט כללי': 'عنصر عام',
    'סכו"ם': 'أدوات المائدة',
    'סלט ירוק  תוספת': 'سلطة خضراء إضافية',
    'הערה למטבח': 'ملاحظة للمطبخ',
    'בראוניז טבעוני': 'براونيز نباتي',
    'סורבה': 'سوربيت',
    'ג\'סמין': 'ياسمين',
    'תפוזים': 'برتقال',
    'הערה בר': 'ملاحظة للبار',
    'קולה': 'كولا',
    'קולה זירו': 'كولا زيرو',
    'ספרייט': 'سبرايت',
    'ספרייט זירו': 'سبرايت زيرو',
    'פיוזטי': 'فوزيتي',
    'מינרלים זכוכית': 'مياه معدنية كوب',
    'פרללה גדול': 'بيريلا كبير',
    'פרללה קטן': 'بيريلا صغير',
    'ענבים': 'عنب',
    'גסמין גאז': 'ياسمين غاز',
    'אספרסו': 'إسبرسو',
    'אספרסו ארוך': 'إسبرسو طويل',
    'תה': 'شاي',
    'קפה שחור': 'قهوة سوداء',
    'מורטי בקבוק': 'موريتي زجاجة',
    'סטלה בקבוק': 'ستيلا زجاجة',
    'כוס סירה ירדן אדום': 'كوب سيراه الأردن الأحمر',
    'סירה ירדן': 'سيراه الأردن',
    'פטיט סירה כוס': 'بيتي سيراه كوب',
    'פטיט סירה בקבוק': 'بيتي سيراه زجاجة',
    'בקבוק קיאנטי': 'كيانتي زجاجة',
    'כוס קיאנטי': 'كيانتي كوب',
    'בקבוק שרדונה תל פארס לבן, רקאנטי': 'شاردونيه تل فارس أبيض زجاجة، ريكانتي',
    'כוס שרדונה תל פארס לבן, רקאנטי': 'شاردونيه تل فارس أبيض كوب، ريكانتي',
    'ירדן גוורץ': 'الأردن جيفورزترامينر',
    'כוס ירדן גוורץ': 'الأردن جيفورزترامينر كوب',
    'כוס יראון רוזה הרי גליל': 'يرون روزيه جبال الجليل كوب',
    'יראון רוזה': 'يرون روزيه',
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

// Add or update nameTranslate for each dish
let translatedCount = 0;
if (metadata.dishMappings) {
  for (const dishId in metadata.dishMappings) {
    const dish = metadata.dishMappings[dishId];
    if (dish.dishName) {
      const hebrewName = dish.dishName.trim();
      const currentEn = dish.nameTranslate?.en || '';
      const currentAr = dish.nameTranslate?.ar || '';
      
      // Check if translation is needed (missing or contains Hebrew)
      const needsTranslation = !dish.nameTranslate || 
                               isHebrew(currentEn) || 
                               isHebrew(currentAr);
      
      if (needsTranslation) {
        dish.nameTranslate = {
          he: hebrewName,
          en: translateDishName(hebrewName, 'en'),
          ar: translateDishName(hebrewName, 'ar'),
        };
        translatedCount++;
      }
    }
  }
}

// Write the updated metadata
console.log('Writing updated metadata to:', metadataPath);
writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

console.log(`✅ Updated nameTranslate for ${translatedCount} dishes in labraca_metadata.json`);
