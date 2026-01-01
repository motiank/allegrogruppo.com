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
    // Phrases (check these first for exact matches)
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
    // Phrases (check these first for exact matches)
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
    // Description terms
    'גרם': 'جرام',
    'לחמניית בריוש': 'كعكة بريوش',
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
const beecommMenuPath = join(__dirname, '..', 'propmpts', 'labraca.json');
const outputPath = join(__dirname, '..', 'menu', 'labraca_menu.json');
const descriptionsPath = join(__dirname, '..', 'order_sys', 'menu', 'bcom_descriptions.json');

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

// Function to extract all dishes from categories and subcategories
function extractAllDishes(categories) {
  const dishes = [];
  
  for (const category of categories) {
    if (category.subCategories && Array.isArray(category.subCategories)) {
      for (const subCategory of category.subCategories) {
        if (subCategory.dishes && Array.isArray(subCategory.dishes)) {
          for (const dish of subCategory.dishes) {
            dishes.push(dish);
          }
        }
      }
    }
  }
  
  return dishes;
}

// Function to convert a dish to our menu format
function convertDish(dish) {
  // Use dishId as the key, or generate a slug from name if dishId doesn't exist
  const dishKey = dish.dishId || dish._id || dish.name.toLowerCase().replace(/\s+/g, '_');
  
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
    // Try to translate description to English and Arabic
    const enTranslation = translateHebrew(finalDescription, 'en');
    const arTranslation = translateHebrew(finalDescription, 'ar');
    // Only use translation if it's actually different from Hebrew (contains non-Hebrew characters)
    descriptionTranslate.en = isHebrew(enTranslation) ? finalDescription : enTranslation;
    descriptionTranslate.ar = isHebrew(arTranslation) ? finalDescription : arTranslation;
  } else {
    descriptionTranslate.he = null;
    descriptionTranslate.en = null;
    descriptionTranslate.ar = null;
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

// Extract all dishes
console.log('Extracting dishes from categories...');
const allDishes = extractAllDishes(beecommMenu.deliveryMenu?.categories || []);

console.log(`Found ${allDishes.length} dishes`);

// Convert all dishes
console.log('Converting dishes to menu format...');
const menu = {};
const beecommMetadata = {
  menuRevision,
  source: 'beecomm',
  generatedAt: new Date().toISOString(),
  totalDishes: allDishes.length,
  dishMappings: {},
};

for (const dish of allDishes) {
  const { key, dish: convertedDish, beecommData } = convertDish(dish);
  menu[key] = convertedDish;
  // Store beecomm data separately for order submission
  beecommMetadata.dishMappings[key] = beecommData;
}

// Create the final output - matching mealOptions.json structure exactly (no _metadata at root)
const output = {
  ...menu,
};

// Write menu file (matching mealOptions.json structure)
console.log('Writing menu to:', outputPath);
writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');

// Write beecomm metadata separately for order submission
const beecommMetadataPath = join(__dirname, '..', 'menu', 'labraca_metadata.json');
console.log('Writing labraca metadata to:', beecommMetadataPath);
writeFileSync(beecommMetadataPath, JSON.stringify(beecommMetadata, null, 2), 'utf8');

console.log(`✅ Successfully converted ${allDishes.length} dishes to ${outputPath}`);
console.log(`✅ Beecomm metadata saved to ${beecommMetadataPath}`);
console.log(`Menu revision: ${menuRevision}`);

