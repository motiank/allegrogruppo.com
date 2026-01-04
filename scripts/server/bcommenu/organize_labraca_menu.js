import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Organize labraca menu by categories and subcategories
 * This script reads the flat menu structure and reorganizes it based on
 * the original beecomm data structure
 */
async function organizeMenu() {
  // Read the original beecomm data to get category/subcategory structure
  const originalDataPath = join(__dirname, '..', '..', '..', 'propmpts', 'labraca.json');
  const originalData = JSON.parse(readFileSync(originalDataPath, 'utf8'));
  
  // Read the current flat menu
  const menuPath = join(__dirname, '..', '..', '..', 'order_sys', 'menu', 'labraca_menu.json');
  const flatMenu = JSON.parse(readFileSync(menuPath, 'utf8'));
  
  // Read metadata for dish information
  const metadataPath = join(__dirname, '..', '..', '..', 'order_sys', 'menu', 'labraca_metadata.json');
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  
  // Build a map of dishId -> category/subcategory info from original data
  const dishCategoryMap = {};
  
  const categories = originalData.deliveryMenu?.categories || [];
  for (const category of categories) {
    const categoryId = category._id;
    const categoryName = category.name;
    const categoryNameTranslate = category.nameTranslate || {};
    
    if (category.subCategories && Array.isArray(category.subCategories)) {
      for (const subCategory of category.subCategories) {
        const subCategoryId = subCategory._id;
        const subCategoryName = subCategory.name;
        const subCategoryNameTranslate = subCategory.nameTranslate || {};
        
        if (subCategory.dishes && Array.isArray(subCategory.dishes)) {
          for (const dish of subCategory.dishes) {
            const dishId = dish.dishId || dish._id;
            if (dishId) {
              dishCategoryMap[dishId] = {
                categoryId,
                categoryName,
                categoryNameTranslate,
                subCategoryId,
                subCategoryName,
                subCategoryNameTranslate,
                sortIndex: category.sortIndex || 0,
                subCategorySortIndex: subCategory.sortIndex || 0,
              };
            }
          }
        }
      }
    }
  }
  
  // Organize menu by categories and subcategories
  const organizedMenu = {
    categories: [],
  };
  
  // Group dishes by category
  const categoryMap = {};
  
  for (const [dishId, dishData] of Object.entries(flatMenu)) {
    const categoryInfo = dishCategoryMap[dishId];
    
    if (!categoryInfo) {
      console.warn(`⚠️  Dish ${dishId} not found in category map, skipping`);
      continue;
    }
    
    const { categoryId, categoryName, categoryNameTranslate, subCategoryId, subCategoryName, subCategoryNameTranslate, sortIndex, subCategorySortIndex } = categoryInfo;
    
    // Initialize category if not exists
    if (!categoryMap[categoryId]) {
      categoryMap[categoryId] = {
        id: categoryId,
        name: categoryName,
        nameTranslate: categoryNameTranslate,
        sortIndex: sortIndex,
        subCategories: {},
      };
    }
    
    // Initialize subcategory if not exists
    if (!categoryMap[categoryId].subCategories[subCategoryId]) {
      categoryMap[categoryId].subCategories[subCategoryId] = {
        id: subCategoryId,
        name: subCategoryName,
        nameTranslate: subCategoryNameTranslate,
        sortIndex: subCategorySortIndex,
        dishes: {},
      };
    }
    
    // Add dish to subcategory
    categoryMap[categoryId].subCategories[subCategoryId].dishes[dishId] = dishData;
  }
  
  // Convert to array format and sort
  for (const categoryId in categoryMap) {
    const category = categoryMap[categoryId];
    const subCategoriesArray = [];
    
    for (const subCategoryId in category.subCategories) {
      const subCategory = category.subCategories[subCategoryId];
      subCategoriesArray.push({
        id: subCategory.id,
        name: subCategory.name,
        nameTranslate: subCategory.nameTranslate,
        sortIndex: subCategory.sortIndex,
        dishes: subCategory.dishes,
      });
    }
    
    // Sort subcategories by sortIndex
    subCategoriesArray.sort((a, b) => (a.sortIndex || 0) - (b.sortIndex || 0));
    
    organizedMenu.categories.push({
      id: category.id,
      name: category.name,
      nameTranslate: category.nameTranslate,
      sortIndex: category.sortIndex,
      subCategories: subCategoriesArray,
    });
  }
  
  // Sort categories by sortIndex
  organizedMenu.categories.sort((a, b) => (a.sortIndex || 0) - (b.sortIndex || 0));
  
  // Write organized menu
  const outputPath = join(__dirname, '..', '..', '..', 'order_sys', 'menu', 'labraca_menu.json');
  writeFileSync(outputPath, JSON.stringify(organizedMenu, null, 2), 'utf8');
  
  console.log(`✅ Organized menu with ${organizedMenu.categories.length} categories`);
  for (const category of organizedMenu.categories) {
    const totalDishes = category.subCategories.reduce((sum, sub) => sum + Object.keys(sub.dishes).length, 0);
    console.log(`  - ${category.name}: ${category.subCategories.length} subcategories, ${totalDishes} dishes`);
  }
}

organizeMenu().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
