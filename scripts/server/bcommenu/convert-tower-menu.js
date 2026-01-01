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
// This is the same comprehensive dictionary used in other conversion scripts
const translationDict = {
  en: {
    // Common phrases
    'תוספות לתירס צלוי': 'Extras for Grilled Corn',
    'תוספות': 'Extras',
    'תוספת': 'Extra',
    'סוג פסטה': 'Pasta Type',
    'סוג': 'Type',
    'פסטה בהרכבה': 'Custom Pasta',
    'פסטה': 'Pasta',
    'פטוצ׳יני': 'Fettuccine',
    'פנה': 'Penne',
    'ספגטי ללא גלוטן': 'Gluten-free Spaghetti',
    'ספגטי': 'Spaghetti',
    'ללא גלוטן': 'Gluten-free',
    'פרמז׳ן': 'Parmesan',
    'קוקוס': 'Coconut',
    'צ׳ילי טרי': 'Fresh Chili',
    'חלפיניו': 'Jalapeño',
    'רוטב': 'Sauce',
    'רטבים': 'Sauces',
    'פסטה בולונז': 'Bolognese Pasta',
    'בולונז': 'Bolognese',
    'רוזה': 'Rosa',
    'אלפרדו': 'Alfredo',
    'תירס צלוי': 'Grilled Corn',
    'תירס': 'Corn',
    'צלוי': 'Grilled',
    'חסה': 'Lettuce',
    'עגבנייה': 'Tomato',
    'בצל': 'Onion',
    'מלפפון': 'Cucumber',
    'פלפל': 'Pepper',
    'גבינה': 'Cheese',
    'בשר': 'Meat',
    'עוף': 'Chicken',
    'דג': 'Fish',
    'סלמון': 'Salmon',
    'כריך': 'Sandwich',
    'סלט': 'Salad',
    'צ׳יפס': 'Fries',
    'אורז': 'Rice',
    'לחם': 'Bread',
    'שמנת': 'Cream',
    'קרם': 'Cream',
    'חדש': 'New',
    'שינויים אפשריים בכריך': 'Possible Changes in Sandwich',
    'שינויים': 'Changes',
    'אפשריים': 'Possible',
    'בכריך': 'in Sandwich',
    'מידת עשייה': 'Doneness level',
    'המבורגר קלאסי': 'Classic Hamburger',
    'המבורגר': 'Hamburger',
    'קלאסי': 'Classic',
    'שניצל': 'Schnitzel',
    'סלט ברזל': 'Iron Salad',
    'ברזל': 'Iron',
    'סלט ירוק': 'Green Salad',
    'ירוק': 'Green',
    'תוספת': 'Extra',
    'תפוח אדמה': 'Potato',
    'תפוחי אדמה': 'Potatoes',
    'סלט ירוק  תוספת': 'Green Salad Extra',
    // Description terms
    'גרם': 'grams',
    'לחמניית בריוש': 'brioche bun',
    'מטוגן': 'fried',
    'לחם פריך': 'crispy bread',
    'לימון': 'lemon',
    'רוטב בולונז קלאסי': 'classic bolognese sauce',
    'בשר בקר טחון': 'ground beef',
    'יין אדום': 'red wine',
    'עלים ירוקים': 'green leaves',
    'תרד': 'spinach',
    'עגבניות שרי': 'cherry tomatoes',
    'גבינת פטה': 'feta cheese',
    'אגוזי מלך': 'walnuts',
    'טרי': 'fresh',
    'מלפפון': 'cucumber',
    'אפויים': 'baked',
    'או': 'or',
    'מטוגנים': 'fried',
    'איכותי': 'quality',
    'ירקות צלויים': 'grilled vegetables',
    'תבלינים': 'spices',
    'צלוי על הגריל': 'grilled',
    'דק': 'thin',
    'גבינת פרמזן': 'parmesan cheese',
    'רוקט': 'arugula',
    'שמן זית': 'olive oil',
    'איטלקי': 'Italian',
    'מתובל': 'seasoned',
    'חריף קלות': 'slightly spicy',
    'מיובש': 'dried',
    'בזיליקום': 'basil',
    'סיציליאנית': 'Sicilian',
    'חצילים': 'eggplant',
    'זיתים': 'olives',
    'צלפים': 'capers',
    'חתוך דק': 'thinly sliced',
    'רוטב חרדל': 'mustard sauce',
    'צלוי לאט': 'slow roasted',
    'ירקות שורש': 'root vegetables',
    'מוצרלה': 'mozzarella',
    'פפרוני': 'pepperoni',
    'פטריות': 'mushrooms',
    'גבינת גורגונזולה': 'gorgonzola cheese',
    'רוטב טרטר': 'tartar sauce',
    'נתחי עוף': 'chicken pieces',
    'רוטב דבש חריף': 'spicy honey sauce',
    'רוטב עגבניות': 'tomato sauce',
    'ירקות': 'vegetables',
    'ירקות טריים': 'fresh vegetables',
    'רוטב': 'sauce',
    'שיפודי כבש': 'lamb skewers',
    'תבלינים מזרחיים': 'Middle Eastern spices',
    'משתנה לפי היום': 'varies by day',
    'של השף': "chef's",
    'מנת ספיישל': 'special dish',
    'עגלה': 'veal',
    'סציליאני': 'Sicilian',
    'ועגבניה': 'and tomato',
    'ועגבנייה': 'and tomato',
    '250': '250',
  },
  ar: {
    // Common phrases
    'תוספות לתירס צלוי': 'إضافات للذرة المشوية',
    'תוספות': 'إضافات',
    'תוספת': 'إضافة',
    'סוג פסטה': 'نوع الباستا',
    'סוג': 'نوع',
    'פסטה בהרכבה': 'باستا مخصصة',
    'פסטה': 'باستا',
    'פטוצ׳יני': 'فيتوتشيني',
    'פנה': 'بيني',
    'ספגטי ללא גלוטן': 'سباغيتي خالية من الغلوتين',
    'ספגטי': 'سباغيتي',
    'ללא גלוטן': 'خالي من الغلوتين',
    'פרמז׳ן': 'بارميزان',
    'קוקוס': 'جوز الهند',
    'צ׳ילי טרי': 'فلفل حار طازج',
    'חלפיניו': 'هالبينو',
    'רוטב': 'صلصة',
    'רטבים': 'صلصات',
    'פסטה בולונז': 'باستا بولونيز',
    'בולונז': 'بولونيز',
    'רוזה': 'روزا',
    'אלפרדו': 'ألفريدو',
    'תירס צלוי': 'ذرة مشوية',
    'תירס': 'ذرة',
    'צלוי': 'مشوي',
    'חסה': 'خس',
    'עגבנייה': 'طماطم',
    'בצל': 'بصل',
    'מלפפון': 'خيار',
    'פלפל': 'فلفل',
    'גבינה': 'جبن',
    'בשר': 'لحم',
    'עוף': 'دجاج',
    'דג': 'سمك',
    'סלמון': 'سلمون',
    'כריך': 'ساندويتش',
    'סלט': 'سلطة',
    'צ׳יפס': 'بطاطا مقلية',
    'אורז': 'أرز',
    'לחם': 'خبز',
    'שמנת': 'كريمة',
    'קרם': 'كريمة',
    'חדש': 'جديد',
    'שינויים אפשריים בכריך': 'تغييرات محتملة في الساندويتش',
    'שינויים': 'تغييرات',
    'אפשריים': 'محتملة',
    'בכריך': 'في الساندويتش',
    'מידת עשייה': 'مستوى النضج',
    'המבורגר קלאסי': 'هامبرجر كلاسيكي',
    'המבורגר': 'هامبرجر',
    'קלאסי': 'كلاسيكي',
    'שניצל': 'شنتسل',
    'סלט ברזל': 'سلطة الحديد',
    'ברזל': 'حديد',
    'סלט ירוק': 'سلطة خضراء',
    'ירוק': 'أخضر',
    'תוספת': 'إضافة',
    'תפוח אדמה': 'بطاطا',
    'תפוחי אדמה': 'بطاطا',
    'סלט ירוק  תוספת': 'سلطة خضراء إضافية',
    // Description terms
    'גרם': 'جرام',
    'לחמניית בريוש': 'كعكة بريوش',
    'מטוגן': 'مقلي',
    'לחם פריך': 'خبز مقرمش',
    'לימון': 'ليمون',
    'רוטב בולונז קלאסי': 'صلصة بولونيز كلاسيكية',
    'בשר בקר טחון': 'لحم بقري مفروم',
    'יין אדום': 'نبيذ أحمر',
    'עלים ירוקים': 'أوراق خضراء',
    'תרד': 'سبانخ',
    'עגבניות שרי': 'طماطم كرزية',
    'גבינת פטה': 'جبنة فيتا',
    'אגוזי מלך': 'جوز',
    'טרי': 'طازج',
    'מלפפון': 'خيار',
    'אפויים': 'مخبوز',
    'או': 'أو',
    'מטוגנים': 'مقلية',
    'איכותי': 'عالي الجودة',
    'ירקות צלויים': 'خضار مشوية',
    'תבלינים': 'توابل',
    'צלוי על הגריל': 'مشوي على الشواية',
    'דק': 'رقيق',
    'גבינת פרמזן': 'جبنة بارميزان',
    'רוקט': 'جرجير',
    'שמן זית': 'زيت زيتون',
    'איטלקי': 'إيطالي',
    'מתובל': 'متبل',
    'חריף קלות': 'حار قليلاً',
    'מיובש': 'مجفف',
    'בזיליקום': 'ريحان',
    'סיציליאנית': 'صقلية',
    'חצילים': 'باذنجان',
    'זיתים': 'زيتون',
    'צלפים': 'قبار',
    'חתוך דק': 'مقطع رقيق',
    'רוטב חרדל': 'صلصة خردل',
    'צלוי לאט': 'مشوي ببطء',
    'ירקות שורש': 'خضار جذرية',
    'מוצרלה': 'موتزاريلا',
    'פפרוני': 'بيبروني',
    'פטריות': 'فطر',
    'גבינת גורגונזולה': 'جبنة جورجونزولا',
    'רוטב טרטר': 'صلصة التارتار',
    'נתחי עוף': 'قطع دجاج',
    'רוטב דבש חריף': 'صلصة عسل حارة',
    'רוטב עגבניות': 'صلصة الطماطم',
    'ירקות': 'خضار',
    'ירקות טריים': 'خضار طازجة',
    'רוטב': 'صلصة',
    'שיפודי כבש': 'أسياخ لحم الضأن',
    'תבלינים מזרחיים': 'توابل شرقية',
    'משתנה לפי היום': 'يتغير حسب اليوم',
    'של השף': 'الشيف',
    'מנת ספיישל': 'طبق خاص',
    'עגלה': 'عجل',
    'סציליאני': 'صقلية',
    'ועגבניה': 'وطماطم',
    'ועגבנייה': 'وطماطم',
    '250': '250',
  },
  ru: {
    // Common phrases
    'תוספות לתירס צלוי': 'Добавки к жареной кукурузе',
    'תוספות': 'Добавки',
    'תוספת': 'Добавка',
    'סוג פסטה': 'Тип пасты',
    'סוג': 'Тип',
    'פסטה בהרכבה': 'Паста на заказ',
    'פסטה': 'Паста',
    'פטוצ׳יני': 'Феттучине',
    'פנה': 'Пенне',
    'ספגטי ללא גלוטן': 'Спагетти без глютена',
    'ספגטי': 'Спагетти',
    'ללא גלוטן': 'Без глютена',
    'פרמז׳ן': 'Пармезан',
    'קוקוס': 'Кокос',
    'צ׳ילי טרי': 'Свежий перец чили',
    'חלפיניו': 'Халапеньо',
    'רוטב': 'Соус',
    'רטבים': 'Соусы',
    'פסטה בולונז': 'Паста болоньезе',
    'בולונז': 'Болоньезе',
    'רוזה': 'Роза',
    'אלפרדו': 'Альфредо',
    'תירס צלוי': 'Жареная кукуруза',
    'תירס': 'Кукуруза',
    'צלוי': 'Жареный',
    'חסה': 'Салат',
    'עגבנייה': 'Помидор',
    'בצל': 'Лук',
    'מלפפון': 'Огурец',
    'פלפל': 'Перец',
    'גבינה': 'Сыр',
    'בשר': 'Мясо',
    'עוף': 'Курица',
    'דג': 'Рыба',
    'סלמון': 'Лосось',
    'כריך': 'Сэндвич',
    'סלט': 'Салат',
    'צ׳יפס': 'Картофель фри',
    'אורז': 'Рис',
    'לחם': 'Хлеб',
    'שמנת': 'Сливки',
    'קרם': 'Сливки',
    'חדש': 'Новый',
    'שינויים אפשריים בכריך': 'Возможные изменения в сэндвиче',
    'שינויים': 'Изменения',
    'אפשריים': 'Возможные',
    'בכריך': 'в сэндвиче',
    'מידת עשייה': 'Уровень прожарки',
    'המבורגר קלאסי': 'Классический гамбургер',
    'המבורגר': 'Гамбургер',
    'קלאסי': 'Классический',
    'שניצל': 'Шницель',
    'סלט ברזל': 'Железный салат',
    'ברזל': 'Железо',
    'סלט ירוק': 'Зеленый салат',
    'ירוק': 'Зеленый',
    'תוספת': 'Добавка',
    'תפוח אדמה': 'Картофель',
    'תפוחי אדמה': 'Картофель',
    'סלט ירוק  תוספת': 'Зеленый салат дополнительно',
    // Description terms
    'גרם': 'грамм',
    'לחמניית בריוש': 'булочка бриошь',
    'מטוגן': 'жареный',
    'לחם פריך': 'хрустящий хлеб',
    'לימון': 'лимон',
    'רוטב בולונז קלאסי': 'классический соус болоньезе',
    'בשר בקר טחון': 'говяжий фарш',
    'יין אדום': 'красное вино',
    'עלים ירוקים': 'зеленые листья',
    'תרד': 'шпинат',
    'עגבניות שרי': 'черри помидоры',
    'גבינת פטה': 'сыр фета',
    'אגוזי מלך': 'грецкие орехи',
    'טרי': 'свежий',
    'מלפפון': 'огурец',
    'אפויים': 'запеченный',
    'או': 'или',
    'מטוגנים': 'жареный',
    'איכותי': 'качественный',
    'ירקות צלויים': 'жареные овощи',
    'תבלינים': 'специи',
    'צלוי על הגריל': 'жареный на гриле',
    'דק': 'тонкий',
    'גבינת פרמזן': 'сыр пармезан',
    'רוקט': 'руккола',
    'שמן זית': 'оливковое масло',
    'איטלקי': 'итальянский',
    'מתובל': 'приправленный',
    'חריף קלות': 'слегка острый',
    'מיובש': 'сушеный',
    'בזיליקום': 'базилик',
    'סיציליאנית': 'сицилийский',
    'חצילים': 'баклажан',
    'זיתים': 'оливки',
    'צלפים': 'каперсы',
    'חתוך דק': 'тонко нарезанный',
    'רוטב חרדל': 'горчичный соус',
    'צלוי לאט': 'медленно жареный',
    'ירקות שורש': 'корнеплоды',
    'מוצרלה': 'моцарелла',
    'פפרוני': 'пепперони',
    'פטריות': 'грибы',
    'גבינת גורגונזולה': 'сыр горгонзола',
    'רוטב טרטר': 'соус тартар',
    'נתחי עוף': 'кусочки курицы',
    'רוטב דבש חריף': 'острый медовый соус',
    'רוטב עגבניות': 'томатный соус',
    'ירקות': 'овощи',
    'ירקות טריים': 'свежие овощи',
    'רוטב': 'соус',
    'שיפודי כבש': 'шашлык из баранины',
    'תבלינים מזרחיים': 'восточные специи',
    'משתנה לפי היום': 'меняется в зависимости от дня',
    'של השף': 'шеф-повара',
    'מנת ספיישל': 'особое блюдо',
    'עגלה': 'телятина',
    'סציליאני': 'сицилийский',
    'ועגבניה': 'и помидор',
    'ועגבנייה': 'и помидор',
    '250': '250',
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
    if (translated.includes(hebrew)) {
      // Replace all occurrences of the Hebrew phrase with its translation
      translated = translated.replace(new RegExp(hebrew.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), dict[hebrew]);
    }
  }
  
  // If we still have Hebrew characters, try word-by-word translation
  if (isHebrew(translated)) {
    // Split by common separators and translate each word
    const words = translated.split(/[\s,]+/).filter(w => w.trim());
    const translatedWords = words.map(word => {
      const trimmedWord = word.trim();
      if (!trimmedWord || !isHebrew(trimmedWord)) return trimmedWord;
      // Try to find translation for this word
      for (const hebrew of sortedKeys) {
        if (trimmedWord === hebrew || trimmedWord.includes(hebrew)) {
          return dict[hebrew] || trimmedWord;
        }
      }
      return trimmedWord;
    });
    translated = translatedWords.join(' ');
  }
  
  // Clean up extra spaces
  translated = translated.replace(/\s+/g, ' ').trim();
  
  return translated;
}

// Helper function to get proper translation
// If translation exists and is not Hebrew, use it; otherwise try to translate or use fallback
function getTranslation(hebrewText, nameTranslate, lang) {
  // If we have a translation for this language
  if (nameTranslate && nameTranslate[lang]) {
    const translation = nameTranslate[lang].trim();
    // If translation exists and is not just Hebrew text, use it
    if (translation && !isHebrew(translation)) {
      return translation;
    }
  }
  
  // If no proper translation, try to translate from Hebrew
  return translateHebrew(hebrewText, lang);
}

// Read the beecomm menu file
const beecommMenuPath = join(__dirname, '..', 'order_sys', 'menu', 'bcom_menu.json');
const menuOutputPath = join(__dirname, '..', 'order_sys', 'menu', 'tower_menu.json');
const metadataOutputPath = join(__dirname, '..', 'order_sys', 'menu', 'tower_metadata.json');
const descriptionsPath = join(__dirname, '..', 'order_sys', 'menu', 'bcom_descriptions.json');
const drinksMenuPath = join(__dirname, '..', 'order_sys', 'menu', 'drinks_menu.json');

console.log('Reading beecomm menu from:', beecommMenuPath);
const beecommMenu = JSON.parse(readFileSync(beecommMenuPath, 'utf8'));

// Load custom descriptions if the file exists
let customDescriptions = {};
try {
  if (readFileSync(descriptionsPath, 'utf8')) {
    customDescriptions = JSON.parse(readFileSync(descriptionsPath, 'utf8'));
    console.log(`Loaded ${Object.keys(customDescriptions).length} custom descriptions from ${descriptionsPath}`);
  }
} catch (error) {
  console.log('No custom descriptions file found, using descriptions from menu');
}

// Extract menu revision
const menuRevision = beecommMenu.menuRevision || '';

// Target subcategory ID
const targetSubCategoryId = '692701798a6115e55335288a';

// Function to find and extract dishes from the target subcategory
function extractDishesFromSubCategory(categories, subCategoryId) {
  const dishes = [];
  
  for (const category of categories) {
    if (category.subCategories && Array.isArray(category.subCategories)) {
      for (const subCategory of category.subCategories) {
        if (subCategory._id === subCategoryId) {
          console.log(`Found target subcategory: "${subCategory.name}" (${subCategoryId})`);
          if (subCategory.dishes && Array.isArray(subCategory.dishes)) {
            console.log(`Found ${subCategory.dishes.length} dishes in subcategory`);
            for (const dish of subCategory.dishes) {
              dishes.push(dish);
            }
          }
          return dishes;
        }
      }
    }
  }
  
  console.warn(`Subcategory ${subCategoryId} not found!`);
  return dishes;
}

// Function to convert a dish to our menu format
function convertDish(dish) {
  // Use dishId as the key
  const dishKey = dish.dishId || dish._id;
  
  if (!dishKey) {
    console.warn('Dish missing dishId/_id:', dish.name);
    return null;
  }
  
  // Get base price (convert to number)
  const basePrice = typeof dish.price === 'number' ? dish.price : parseFloat(dish.price) || 0;
  
  // Convert toppingsGroups to groups format - matching mealOptions.json structure exactly
  const groups = [];
  
  if (dish.toppingsGroups && Array.isArray(dish.toppingsGroups)) {
    for (const toppingGroup of dish.toppingsGroups) {
      // Determine if it's single or multiple selection
      const minQuantity = toppingGroup.minQuantity || 0;
      const maxQuantity = toppingGroup.maxQuantity || null;
      const isSingle = maxQuantity === 1 || (minQuantity === 1 && maxQuantity === 1);
      
      // Create group matching mealOptions.json structure exactly
      const group = {
        id: toppingGroup._id, // Use _id as the group id
        type: isSingle ? 'single' : 'multiple',
        title: {
          he: toppingGroup.name || '',
          en: getTranslation(toppingGroup.name, toppingGroup.nameTranslate, 'en'),
          ar: getTranslation(toppingGroup.name, toppingGroup.nameTranslate, 'ar'),
          ru: getTranslation(toppingGroup.name, toppingGroup.nameTranslate, 'ru'),
        },
        required: minQuantity > 0,
      };
      
      // Add min/max for multiple selection (only for multiple type)
      if (!isSingle) {
        group.min = minQuantity;
        group.max = maxQuantity;
      }
      
      // Convert toppings to options - matching mealOptions.json structure exactly
      const options = [];
      if (toppingGroup.toppings && Array.isArray(toppingGroup.toppings)) {
        for (const topping of toppingGroup.toppings) {
          const option = {
            id: topping._id, // Use _id as the option id
            price: topping.costAddition || 0,
            label: {
              he: topping.name || '',
              en: getTranslation(topping.name, topping.nameTranslate, 'en'),
              ar: getTranslation(topping.name, topping.nameTranslate, 'ar'),
              ru: getTranslation(topping.name, topping.nameTranslate, 'ru'),
            },
          };
          options.push(option);
        }
      }
      
      group.options = options;
      groups.push(group);
    }
  }
  
  // Build the dish object - matching mealOptions.json structure exactly (only basePrice and groups)
  const convertedDish = {
    basePrice,
    groups,
  };
  
  // Store beecomm metadata separately for order submission
  // Use custom description if available, otherwise use dish description
  const customDescription = customDescriptions[dishKey] || null;
  const finalDescription = customDescription || dish.description || null;
  
  // Create description translations
  const descriptionTranslate = {};
  if (finalDescription) {
    descriptionTranslate.he = finalDescription;
    // Try to translate description to English, Arabic, and Russian
    const enTranslation = translateHebrew(finalDescription, 'en');
    const arTranslation = translateHebrew(finalDescription, 'ar');
    const ruTranslation = translateHebrew(finalDescription, 'ru');
    // Only use translation if it's actually different from Hebrew (contains non-Hebrew characters)
    descriptionTranslate.en = isHebrew(enTranslation) ? null : enTranslation;
    descriptionTranslate.ar = isHebrew(arTranslation) ? null : arTranslation;
    descriptionTranslate.ru = isHebrew(ruTranslation) ? null : ruTranslation;
  } else {
    descriptionTranslate.he = null;
    descriptionTranslate.en = null;
    descriptionTranslate.ar = null;
    descriptionTranslate.ru = null;
  }
  
  const beecommData = {
    dishId: dish.dishId,
    dishName: dish.name,
    kitchenName: dish.kitchenName || dish.name,
    imagePath: dish.imagePath || null,
    description: finalDescription,
    descriptionTranslate: descriptionTranslate,
    oneLiner: dish.oneLiner || null,
    tags: dish.tags || [],
    prepareTime: dish.prepareTime || 0,
    isCombo: dish.isCombo || false,
    nameTranslate: {
      he: dish.name || '',
      en: getTranslation(dish.name, dish.nameTranslate, 'en'),
      ar: getTranslation(dish.name, dish.nameTranslate, 'ar'),
      ru: getTranslation(dish.name, dish.nameTranslate, 'ru'),
    },
    // Store group and option mappings for order submission
    groupMappings: dish.toppingsGroups?.map(tg => ({
      groupId: tg._id,
      groupName: tg.name,
      minQuantity: tg.minQuantity || 0,
      maxQuantity: tg.maxQuantity || null,
      allowAboveLimit: tg.allowAboveLimit || false,
      costAboveLimit: tg.costAboveLimit || 0,
      optionMappings: tg.toppings?.map(t => ({
        optionId: t._id,
        dishId: t.dishId,
        kitchenName: t.kitchenName || t.name,
        isDish: t.isDish || false,
        isVariable: t.isVariable || false,
      })) || [],
    })) || [],
  };
  
  return { key: dishKey, dish: convertedDish, beecommData };
}

// Extract dishes from target subcategory
console.log(`Extracting dishes from subcategory: ${targetSubCategoryId}`);
const allDishes = extractDishesFromSubCategory(beecommMenu.deliveryMenu?.categories || [], targetSubCategoryId);

if (allDishes.length === 0) {
  console.error('❌ No dishes found in target subcategory!');
  process.exit(1);
}

console.log(`Found ${allDishes.length} dishes`);

// Identify side dishes/options that should be added to main dishes
// These are typically items with lower prices or "תוספת" in the name
const SIDE_DISH_INDICATORS = {
  priceThreshold: 20, // Items with price <= 20 are likely sides
  namePatterns: ['תוספת', 'תפוח אדמה', 'סלט ירוק'], // Items with these in name
};

function isSideDish(dish) {
  const price = typeof dish.price === 'number' ? dish.price : parseFloat(dish.price) || 0;
  const name = dish.name || '';
  
  // Check if price is below threshold
  if (price <= SIDE_DISH_INDICATORS.priceThreshold) {
    return true;
  }
  
  // Check if name contains side dish patterns
  for (const pattern of SIDE_DISH_INDICATORS.namePatterns) {
    if (name.includes(pattern)) {
      return true;
    }
  }
  
  return false;
}

// Separate main dishes from side dishes
const mainDishes = [];
const sideDishes = [];

for (const dish of allDishes) {
  if (isSideDish(dish)) {
    sideDishes.push(dish);
    console.log(`  → Identified as side dish: ${dish.name} (price: ${dish.price})`);
  } else {
    mainDishes.push(dish);
  }
}

console.log(`  Main dishes: ${mainDishes.length}`);
console.log(`  Side dishes: ${sideDishes.length}`);

// Convert all dishes
console.log('Converting dishes to menu format...');
const menu = {};
const beecommMetadata = {
  menuRevision,
  source: 'beecomm',
  generatedAt: new Date().toISOString(),
  totalDishes: mainDishes.length, // Only count main dishes
  dishMappings: {},
};

// First, convert main dishes only (exclude side dishes from menu)
for (const dish of mainDishes) {
  const result = convertDish(dish);
  if (result) {
    menu[result.key] = result.dish;
    // Store beecomm data separately for order submission
    beecommMetadata.dishMappings[result.key] = result.beecommData;
  }
}

// Note: Side dishes are added as options, not as separate menu items
// They will still be in metadata for order submission but not in the main menu

// Then, add side dishes as options to main dishes
// For tower menu, add sides to Hamburger and Schnitzel
const hamburgerDishId = '668e21afff9c99b7862ec370';
const schnitzelDishId = '65d1bc9314ed0ca1e102f839';

// Create a side dishes group for hamburger and schnitzel
if (sideDishes.length > 0 && (menu[hamburgerDishId] || menu[schnitzelDishId])) {
  // Generate a unique group ID for side dishes
  const sideDishGroupId = 'tower_side_dishes_' + Date.now();
  
  const sideDishGroup = {
    id: sideDishGroupId,
    type: 'multiple',
    title: {
      he: 'תוספות',
      en: 'Sides',
      ar: 'إضافات',
      ru: 'Добавки',
    },
    required: false,
    min: 0,
    max: null,
    options: [],
  };
  
  // Convert side dishes to options
  for (const sideDish of sideDishes) {
    const price = typeof sideDish.price === 'number' ? sideDish.price : parseFloat(sideDish.price) || 0;
    const sideDishId = sideDish.dishId || sideDish._id;
    const sideDishDescription = customDescriptions[sideDishId] || sideDish.description || null;
    
    // Create description translations for side dish
    const sideDishDescriptionTranslate = {};
    if (sideDishDescription) {
      sideDishDescriptionTranslate.he = sideDishDescription;
      const enTranslation = translateHebrew(sideDishDescription, 'en');
      const arTranslation = translateHebrew(sideDishDescription, 'ar');
      const ruTranslation = translateHebrew(sideDishDescription, 'ru');
      // Only use translation if it's actually different from Hebrew
      sideDishDescriptionTranslate.en = isHebrew(enTranslation) ? null : enTranslation;
      sideDishDescriptionTranslate.ar = isHebrew(arTranslation) ? null : arTranslation;
      sideDishDescriptionTranslate.ru = isHebrew(ruTranslation) ? null : ruTranslation;
    } else {
      sideDishDescriptionTranslate.he = null;
      sideDishDescriptionTranslate.en = null;
      sideDishDescriptionTranslate.ar = null;
      sideDishDescriptionTranslate.ru = null;
    }
    
    const option = {
      id: sideDishId,
      price: price,
      label: {
        he: sideDish.name || '',
        en: getTranslation(sideDish.name, sideDish.nameTranslate, 'en'),
        ar: getTranslation(sideDish.name, sideDish.nameTranslate, 'ar'),
        ru: getTranslation(sideDish.name, sideDish.nameTranslate, 'ru'),
      },
    };
    sideDishGroup.options.push(option);
    
    // Also add to metadata for order submission
    for (const dishId of [hamburgerDishId, schnitzelDishId]) {
      if (beecommMetadata.dishMappings[dishId]) {
        // Add to groupMappings
        if (!beecommMetadata.dishMappings[dishId].groupMappings) {
          beecommMetadata.dishMappings[dishId].groupMappings = [];
        }
        
        // Check if side dish group already exists
        let groupMapping = beecommMetadata.dishMappings[dishId].groupMappings.find(
          gm => gm.groupId === sideDishGroupId
        );
        
        if (!groupMapping) {
          groupMapping = {
            groupId: sideDishGroupId,
            groupName: 'תוספות',
            minQuantity: 0,
            maxQuantity: null,
            allowAboveLimit: false,
            costAboveLimit: 0,
            optionMappings: [],
          };
          beecommMetadata.dishMappings[dishId].groupMappings.push(groupMapping);
        }
        
        // Create metadata entry for side dish if it doesn't exist
        if (!beecommMetadata.dishMappings[sideDishId]) {
          beecommMetadata.dishMappings[sideDishId] = {
            dishId: sideDishId,
            dishName: sideDish.name,
            kitchenName: sideDish.kitchenName || sideDish.name,
            imagePath: sideDish.imagePath || null,
            description: sideDishDescription,
            descriptionTranslate: sideDishDescriptionTranslate,
            oneLiner: sideDish.oneLiner || null,
            tags: sideDish.tags || [],
            prepareTime: sideDish.prepareTime || 0,
            isCombo: sideDish.isCombo || false,
            nameTranslate: {
              he: sideDish.name || '',
              en: getTranslation(sideDish.name, sideDish.nameTranslate, 'en'),
              ar: getTranslation(sideDish.name, sideDish.nameTranslate, 'ar'),
              ru: getTranslation(sideDish.name, sideDish.nameTranslate, 'ru'),
            },
            groupMappings: [],
          };
        }
        
        groupMapping.optionMappings.push({
          optionId: sideDishId,
          dishId: sideDishId,
          kitchenName: sideDish.kitchenName || sideDish.name,
          isDish: true,
          isVariable: false,
        });
      }
    }
  }
  
  // Add the side dish group to hamburger and schnitzel
  if (menu[hamburgerDishId]) {
    menu[hamburgerDishId].groups.push(sideDishGroup);
  }
  if (menu[schnitzelDishId]) {
    menu[schnitzelDishId].groups.push({ ...sideDishGroup }); // Create a copy
  }
  
  console.log(`  → Added ${sideDishes.length} side dishes as options to Hamburger and Schnitzel`);
}

// Load drinks menu if it exists and add as option group to all meals
let drinksMenu = {};
try {
  if (readFileSync(drinksMenuPath, 'utf8')) {
    drinksMenu = JSON.parse(readFileSync(drinksMenuPath, 'utf8'));
    console.log(`Loaded ${Object.keys(drinksMenu).length} drinks from ${drinksMenuPath}`);
    
    // Define metadata for each drink type (will generate bottle and can variants)
    // Mapping drink base IDs to their Beecomm dish IDs and translations
    const drinksBaseMetadata = {
      'drink_water': {
        dishId: '64be9cad4d58c3aa744f53d8', // מינרלים זכוכית* (Mineral water)
        baseName: {
          he: 'מים',
          en: 'Water',
          ar: 'ماء',
          ru: 'Вода'
        },
        description: {
          he: 'מים מינרליים',
          en: 'Mineral water',
          ar: 'ماء معدني',
          ru: 'Минеральная вода'
        }
      },
      'drink_sparkling_water': {
        dishId: '64be9cc34d58c3aa744f53d9', // ספרייט* (Sprite - used as sparkling water)
        baseName: {
          he: 'מים מוגזים',
          en: 'Sparkling Water',
          ar: 'ماء فوار',
          ru: 'Газированная вода'
        },
        description: {
          he: 'מים מוגזים (סודה)',
          en: 'Sparkling water (soda)',
          ar: 'ماء فوار (صودا)',
          ru: 'Газированная вода (содовая)'
        }
      },
      'drink_cola_zero': {
        dishId: '64be9c944d58c3aa744f53d7', // קולה זירו* (Cola Zero)
        baseName: {
          he: 'קולה זירו',
          en: 'Cola Zero',
          ar: 'كولا زيرو',
          ru: 'Кола Зеро'
        },
        description: {
          he: 'קוקה קולה זירו',
          en: 'Coca Cola Zero',
          ar: 'كوكا كولا زيرو',
          ru: 'Кока-Кола Зеро'
        }
      },
      'drink_coca_cola': {
        dishId: '64be9c704d58c3aa744f53d6', // קולה* (Cola)
        baseName: {
          he: 'קוקה קולה',
          en: 'Coca Cola',
          ar: 'كوكا كولا',
          ru: 'Кока-Кола'
        },
        description: {
          he: 'קוקה קולה קלאסית',
          en: 'Classic Coca Cola',
          ar: 'كوكا كولا كلاسيكية',
          ru: 'Классическая Кока-Кола'
        }
      }
    };
    
    // Generate single variant for each drink
    const drinkVariants = [];
    for (const [drinkId, drinkData] of Object.entries(drinksMenu)) {
      const baseMetadata = drinksBaseMetadata[drinkId];
      if (!baseMetadata) {
        console.warn(`  → Warning: No metadata found for drink ${drinkId}, skipping`);
        continue;
      }
      
      // Generate single variant with price
      if (drinkData.price !== undefined) {
        drinkVariants.push({
          id: drinkId,
          baseId: drinkId,
          price: drinkData.price,
          dishId: baseMetadata.dishId,
          nameTranslate: {
            he: baseMetadata.baseName.he,
            en: baseMetadata.baseName.en,
            ar: baseMetadata.baseName.ar,
            ru: baseMetadata.baseName.ru
          },
          descriptionTranslate: {
            he: baseMetadata.description.he,
            en: baseMetadata.description.en,
            ar: baseMetadata.description.ar,
            ru: baseMetadata.description.ru
          }
        });
      }
    }
    
    // Add drinks metadata to beecommMetadata for each variant
    for (const variant of drinkVariants) {
      beecommMetadata.dishMappings[variant.id] = {
        dishId: variant.dishId, // Use actual Beecomm dishId
        dishName: variant.nameTranslate.he,
        kitchenName: variant.nameTranslate.he,
        imagePath: null,
        description: variant.descriptionTranslate.he,
        descriptionTranslate: variant.descriptionTranslate,
        oneLiner: null,
        tags: [],
        prepareTime: 0,
        isCombo: false,
        nameTranslate: variant.nameTranslate,
        groupMappings: [],
      };
    }
    
    console.log(`  → Added ${drinkVariants.length} drink variants to metadata`);
    
    // Add drinks as an option group to all meals
    // Generate a unique group ID for drinks
    const drinksGroupId = 'tower_drinks_' + Date.now();
    
    const drinksGroup = {
      id: drinksGroupId,
      type: 'multiple',
      title: {
        he: 'משקאות',
        en: 'Drinks',
        ar: 'مشروبات',
        ru: 'Напитки'
      },
      required: false,
      min: 0,
      max: null,
      options: [],
    };
    
    // Convert drink variants to options
    for (const variant of drinkVariants) {
      const option = {
        id: variant.id,
        price: variant.price,
        label: variant.nameTranslate,
      };
      drinksGroup.options.push(option);
      
      // Also add to metadata groupMappings for each meal
      for (const mealId of Object.keys(menu)) {
        if (beecommMetadata.dishMappings[mealId]) {
          // Add to groupMappings
          if (!beecommMetadata.dishMappings[mealId].groupMappings) {
            beecommMetadata.dishMappings[mealId].groupMappings = [];
          }
          
          // Check if drinks group already exists
          let groupMapping = beecommMetadata.dishMappings[mealId].groupMappings.find(
            gm => gm.groupId === drinksGroupId
          );
          
          if (!groupMapping) {
            groupMapping = {
              groupId: drinksGroupId,
              groupName: 'משקאות',
              minQuantity: 0,
              maxQuantity: null,
              allowAboveLimit: false,
              costAboveLimit: 0,
              optionMappings: [],
            };
            beecommMetadata.dishMappings[mealId].groupMappings.push(groupMapping);
          }
          
          groupMapping.optionMappings.push({
            optionId: variant.id,
            dishId: variant.dishId, // Use actual Beecomm dishId
            kitchenName: variant.nameTranslate.he,
            isDish: true,
            isVariable: false,
          });
        }
      }
    }
    
    // Add the drinks group to all meals
    for (const mealId of Object.keys(menu)) {
      menu[mealId].groups.push({ ...drinksGroup }); // Create a copy for each meal
    }
    
    console.log(`  → Added ${drinksGroup.options.length} drink options to all ${Object.keys(menu).length} meals`);
  }
} catch (error) {
  console.log('No drinks menu file found, skipping drinks merge');
}

// Create the final output - matching mealOptions.json structure exactly (no _metadata at root)
// Do NOT merge drinks into root - they are now part of meal groups
const output = {
  ...menu,
};

// Write menu file (matching mealOptions.json structure)
console.log('Writing menu to:', menuOutputPath);
writeFileSync(menuOutputPath, JSON.stringify(output, null, 2), 'utf8');

// Write beecomm metadata separately for order submission
console.log('Writing tower metadata to:', metadataOutputPath);
writeFileSync(metadataOutputPath, JSON.stringify(beecommMetadata, null, 2), 'utf8');

console.log(`✅ Successfully converted ${allDishes.length} dishes to ${menuOutputPath}`);
console.log(`✅ Beecomm metadata saved to ${metadataOutputPath}`);
console.log(`Menu revision: ${menuRevision}`);
console.log('\n📝 Next steps:');
console.log('   1. Review tower_menu.json and fix any remaining translations');
console.log('   2. Review tower_metadata.json and fix any remaining translations');
console.log('   3. Run the translation fix script if needed: node scripts/fix-tower-translations.js');

