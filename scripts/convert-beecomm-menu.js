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
    if (translated === hebrew || translated.includes(hebrew)) {
      translated = translated.replace(new RegExp(hebrew.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), dict[hebrew]);
      // If we got an exact match, return it
      if (translated !== hebrewText && !isHebrew(translated)) {
        return translated.trim();
      }
    }
  }
  
  // If translation didn't work, return Hebrew as fallback
  return hebrewText;
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
const beecommMenuPath = join(__dirname, '..', 'propmpts', 'bc_sandbox_menu.json');
const outputPath = join(__dirname, '..', 'menu', 'beecomm_menu.json');

console.log('Reading beecomm menu from:', beecommMenuPath);
const beecommMenu = JSON.parse(readFileSync(beecommMenuPath, 'utf8'));

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
  const beecommData = {
    dishId: dish.dishId,
    dishName: dish.name,
    kitchenName: dish.kitchenName || dish.name,
    imagePath: dish.imagePath || null,
    description: dish.description || null,
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
const beecommMetadataPath = join(__dirname, '..', 'menu', 'beecomm_metadata.json');
console.log('Writing beecomm metadata to:', beecommMetadataPath);
writeFileSync(beecommMetadataPath, JSON.stringify(beecommMetadata, null, 2), 'utf8');

console.log(`✅ Successfully converted ${allDishes.length} dishes to ${outputPath}`);
console.log(`✅ Beecomm metadata saved to ${beecommMetadataPath}`);
console.log(`Menu revision: ${menuRevision}`);

