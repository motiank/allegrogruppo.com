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

// Translation dictionary for common Hebrew food terms and phrases
const translationDict = {
  en: {
    // Common phrases
    'אפשר להוריד מכנפיים': 'Can remove from wings',
    'שומשום': 'Sesame',
    'בצל ירוק': 'Green Onion',
    'בצל ירוק ': 'Green Onion',
    'ניתן להוסיף לכריך עוף': 'Can add to chicken sandwich',
    'תירס מעודכן': 'Updated corn',
    'קרמשניט בדיקה': 'Cream cheese test',
    'תוספת עוף': 'Extra Chicken',
    'טופו': 'Tofu',
    'טופו ': 'Tofu',
    'שינויים לרול': 'Roll changes',
    'בצלחת': 'On plate',
    'בצק כפול': 'Double dough',
    'תוספת בתשלום לרול?': 'Paid extras for the roll?',
    'ת. ביצת עין': 'Fried Egg',
    'אסאדו מפורק': 'Pulled Asado',
    'תוספת גבינה בדיקה': 'Extra cheese',
    'זיתי קלמטה': 'Kalamata Olives',
    'בטטה': 'Sweet Potato',
    'ירקות לבחירה': 'Vegetables to choose',
    'תוספות לבחירה': 'Extras to choose',
    'שתיה לבחירה': 'Drink to choose',
    'ציפס': 'French Fries',
    'ציפס ': 'French Fries',
    'כדורי פירה': 'Mashed Potato Balls',
    'טבעות בצל': 'Onion Rings',
    'קוקה קולה': 'Coca-Cola',
    'קוקה קולה ': 'Coca-Cola',
    'קולה זירו': 'Coca-Cola Zero',
    'ספרייט': 'Sprite',
    'ספרייט זירו': 'Sprite Zero',
    'בחירת רוטב': 'Sauce selection',
    'בחירת רוטב ': 'Sauce selection',
    'פסטה בולונז': 'Bolognese Pasta',
    'פסטה בולונז  מ': 'Bolognese Pasta',
    'פלפל שיפקה': 'Shifka Pepper',
    'גזר': 'Carrot',
    'ירקות בפנים או בצד?': 'Vegetables inside or on the side?',
    'ירקות בפנים': 'Vegetables inside',
    'ירקות בצד': 'Vegetables on the side',
    'בלי ירקות בכלל': 'No vegetables at all',
    'סלמון לסלט': 'Salmon for salad',
    'תוספת בקר': 'Extra beef',
    'להוסיף לטורטייה עוף של עמית': 'Add to Amit\'s chicken tortilla',
    'סלט קיסר': 'Caesar Salad',
    'להוסיף קצפת?': 'Add whipped cream?',
    'תוספת קצפת': 'Extra whipped cream',
    'תותים': 'Strawberries',
    'אגוזים': 'Nuts',
    'הערות מנות ילדים': 'Kids meal notes',
    'אורז או נודלס': 'Rice or noodles',
    'אורז מטוגן': 'Fried rice',
    'אורז מטוגן ': 'Fried rice',
    'נודלס': 'Noodles',
    'אורז גדול': 'Large rice',
    'חריף / חריף בצד': 'Spicy / Spicy on the side',
    'בלי חריף': 'Without spicy',
    'חריף בצד': 'Spicy on the side',
    'מידת עשייה': 'Doneness level',
    'תוספת עוף לסלט ברזל': 'Extra chicken for iron salad',
    'חזה עוף': 'Chicken breast',
    'מידות עשייה לה בראצה secondi': 'Doneness levels for la brace secondi',
    'הערות לקפה': 'Coffee notes',
    'חלב שיבולת': 'Oat milk',
    'חלב דל': 'Low-fat milk',
    'קצף': 'Foam',
  },
  ar: {
    // Common phrases
    'אפשר להוריד מכנפיים': 'يمكن إزالة من الأجنحة',
    'שומשום': 'سمسم',
    'בצל ירוק': 'بصل أخضر',
    'בצל ירוק ': 'بصل أخضر',
    'ניתן להוסיף לכריך עוף': 'يمكن إضافة إلى ساندويتش الدجاج',
    'תירס מעודכן': 'ذرة محدثة',
    'קרמשניט בדיקה': 'جبن كريمي للاختبار',
    'תוספת עוף': 'إضافة دجاج',
    'טופו': 'توفو',
    'טופו ': 'توفو',
    'שינויים לרول': 'تغييرات الرول',
    'בצלחת': 'في الطبق',
    'בצק כפול': 'عجين مزدوج',
    'תוספת בתשלום לרול?': 'إضافات مدفوعة للرول؟',
    'ת. ביצת עין': 'بيض مقلي',
    'אסאדו מפורק': 'أسادو مفروم',
    'תוספת גבינה בדיקה': 'جبن إضافي',
    'זיתي קלמטה': 'زيتون كالاماتا',
    'בטטה': 'بطاطا حلوة',
    'ירקות לבחירה': 'خضار للاختيار',
    'תוספות לבחירה': 'إضافات للاختيار',
    'שתיה לבחירה': 'مشروب للاختيار',
    'ציפס': 'بطاطا مقلية',
    'ציפס ': 'بطاطا مقلية',
    'כדורי פירה': 'كرات البطاطا المهروسة',
    'טבעות בצל': 'حلقات البصل',
    'קוקה קולה': 'كوكا كولا',
    'קוקה קולה ': 'كوكا كولا',
    'קולה זירو': 'كوكا كولا زيرو',
    'ספרייט': 'سبرايت',
    'ספרייט זירו': 'سبرايت زيرو',
    'בחירת רוטב': 'اختيار الصلصة',
    'בחירת רוטב ': 'اختيار الصلصة',
    'פסטה בולונז': 'باستا بولونيز',
    'פסטה בולונז  מ': 'باستا بولونيز',
    'פלפל שיפקה': 'فلفل شيفكا',
    'גזר': 'جزر',
    'ירקות בפנים או בצד?': 'الخضار في الداخل أم على الجانب؟',
    'ירקות בפנים': 'الخضار في الداخل',
    'ירקות בצד': 'الخضار على الجانب',
    'בלי ירקות בכלל': 'بدون خضار على الإطلاق',
    'סלמון לסלט': 'سلمون للسلطة',
    'תוספת בקר': 'لحم بقري إضافي',
    'להוסיף לטורטייה עוף של עמית': 'إضافة إلى تورتيلا دجاج أميت',
    'סלט קיסר': 'سلطة قيصر',
    'להוסיף קצפת?': 'إضافة كريمة مخفوقة؟',
    'תוספת קצפת': 'كريمة مخفوقة إضافية',
    'תותים': 'فراولة',
    'אגוזים': 'مكسرات',
    'הערות מנות ילדים': 'ملاحظات وجبات الأطفال',
    'אורז או נודלס': 'أرز أم نودلز',
    'אורז מטוגן': 'أرز مقلي',
    'אורז מטוגן ': 'أرز مقلي',
    'נודלס': 'نودلز',
    'אורז גדול': 'أرز كبير',
    'חריף / חריף בצד': 'حار / حار على الجانب',
    'בלי חריף': 'بدون حار',
    'חריף בצד': 'حار على الجانب',
    'מידת עשייה': 'مستوى النضج',
    'תוספת עוף לסלט ברזל': 'إضافة دجاج لسلطة الحديد',
    'חזה עוף': 'صدر دجاج',
    'מידות עשייה לה בראצה secondi': 'مستويات النضج للبراسي الثانية',
    'הערות לקפה': 'ملاحظات القهوة',
    'חלב שיבולת': 'حليب الشوفان',
    'חלב דל': 'حليب قليل الدسم',
    'קצף': 'رغوة',
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
  
  // If translation didn't work, return Hebrew as fallback
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
      } else {
        fixed[key] = fixTranslations(value);
      }
    }
    return fixed;
  }
  return obj;
}

// Read the labraca menu file
const menuPath = join(__dirname, '..', 'menu', 'labraca_menu.json');
console.log('Reading labraca menu from:', menuPath);
const menu = JSON.parse(readFileSync(menuPath, 'utf8'));

// Fix translations
console.log('Fixing translations...');
const fixedMenu = fixTranslations(menu);

// Write the fixed menu back
console.log('Writing fixed menu to:', menuPath);
writeFileSync(menuPath, JSON.stringify(fixedMenu, null, 2), 'utf8');

console.log('✅ Successfully fixed translations in labraca_menu.json');

