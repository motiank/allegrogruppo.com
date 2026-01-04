import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import dotenv from 'dotenv';
import { translationDict, isHebrew, translateHebrew, getTranslation } from './translation-dict.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create axios instance for Beecomm API
const beecommApi = axios.create({
  baseURL: process.env.BEECOMM_API_BASE_URL || 'https://api.beecommcloud.com/v1',
  timeout: 30000,
});

/**
 * Get access token from Beecomm API
 * @returns {Promise<string>} access_token
 */
async function getAccessToken() {
  const clientId = process.env.BEECOMM_CLIENT_ID;
  const clientSecret = process.env.BEECOMM_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    throw new Error('BEECOMM_CLIENT_ID and BEECOMM_CLIENT_SECRET must be set in .env');
  }

  try {
    const params = new URLSearchParams();
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);

    const { data } = await beecommApi.post('/auth/token', params);

    if (!data.result || !data.access_token) {
      throw new Error(
        `Beecomm auth failed: ${data.message || 'Unknown error'} (requestId=${data.requestId})`
      );
    }

    return data.access_token;
  } catch (error) {
    console.error('[import_bcom_menu] getAccessToken error:', error.message);
    throw error;
  }
}

/**
 * Get full menu from Beecomm
 * @param {string} accessToken
 * @param {string} restaurantId
 * @param {string} branchId
 * @returns {Promise<Object>}
 */
async function getMenu(accessToken, restaurantId, branchId) {
  try {
    const { data } = await beecommApi.post(
      '/order-center/getMenu',
      {
        restaurantId,
        branchId,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    return data;
  } catch (error) {
    console.error('[import_bcom_menu] getMenu error:', error.message);
    if (error.response) {
      console.error('[import_bcom_menu] getMenu response:', error.response.data);
    }
    throw error;
  }
}

/**
 * Extract dishes from categories/subcategories based on config filters
 * Returns dishes with category/subcategory metadata if organized structure is needed
 */
function extractDishesFromCategories(categories, config) {
  const dishes = [];
  const categoryFilters = config.categories || [];
  const subCategoryFilters = config.subCategories || [];
  const includeSubCategories = config.includeSubCategories !== false; // Default to true
  const organized = config.organized === true; // Whether to preserve category structure
  
  for (const category of categories) {
    // Check if category should be included
    const categoryMatch = categoryFilters.length === 0 || 
      categoryFilters.some(filter => {
        if (typeof filter === 'string') {
          return category._id === filter || category.name === filter;
        }
        if (filter.id) {
          return category._id === filter.id;
        }
        if (filter.name) {
          return category.name === filter.name;
        }
        return false;
      });
    
    if (!categoryMatch) {
      continue;
    }
    
    if (category.subCategories && Array.isArray(category.subCategories)) {
      for (const subCategory of category.subCategories) {
        // Check if subcategory should be included
        const subCategoryMatch = subCategoryFilters.length === 0 || 
          subCategoryFilters.some(filter => {
            if (typeof filter === 'string') {
              return subCategory._id === filter || subCategory.name === filter;
            }
            if (filter.id) {
              return subCategory._id === filter.id;
            }
            if (filter.name) {
              return subCategory.name === filter.name;
            }
            return false;
          });
        
        if (includeSubCategories && subCategoryMatch) {
          console.log(`  → Including subcategory: "${subCategory.name}" (${subCategory._id})`);
          if (subCategory.dishes && Array.isArray(subCategory.dishes)) {
            console.log(`    Found ${subCategory.dishes.length} dishes`);
            for (const dish of subCategory.dishes) {
              if (organized) {
                // Add category/subcategory metadata to dish
                dishes.push({
                  ...dish,
                  _categoryId: category._id,
                  _categoryName: category.name,
                  _categoryNameTranslate: category.nameTranslate || {},
                  _categorySortIndex: category.sortIndex || 0,
                  _subCategoryId: subCategory._id,
                  _subCategoryName: subCategory.name,
                  _subCategoryNameTranslate: subCategory.nameTranslate || {},
                  _subCategorySortIndex: subCategory.sortIndex || 0,
                });
              } else {
                dishes.push(dish);
              }
            }
          }
        }
      }
    }
  }
  
  return dishes;
}

/**
 * Convert a dish to our menu format
 */
function convertDish(dish, customDescriptions = {}) {
  const dishKey = dish.dishId || dish._id;
  
  if (!dishKey) {
    console.warn('Dish missing dishId/_id:', dish.name);
    return null;
  }
  
  const basePrice = typeof dish.price === 'number' ? dish.price : parseFloat(dish.price) || 0;
  const groups = [];
  
  if (dish.toppingsGroups && Array.isArray(dish.toppingsGroups)) {
    for (const toppingGroup of dish.toppingsGroups) {
      const minQuantity = toppingGroup.minQuantity || 0;
      const maxQuantity = toppingGroup.maxQuantity || null;
      const isSingle = maxQuantity === 1 || (minQuantity === 1 && maxQuantity === 1);
      
      const group = {
        id: toppingGroup._id,
        type: isSingle ? 'single' : 'multiple',
        title: {
          he: toppingGroup.name || '',
          en: getTranslation(toppingGroup.name, toppingGroup.nameTranslate, 'en'),
          ar: getTranslation(toppingGroup.name, toppingGroup.nameTranslate, 'ar'),
          ru: getTranslation(toppingGroup.name, toppingGroup.nameTranslate, 'ru'),
        },
        required: minQuantity > 0,
      };
      
      if (!isSingle) {
        group.min = minQuantity;
        group.max = maxQuantity;
      }
      
      const options = [];
      if (toppingGroup.toppings && Array.isArray(toppingGroup.toppings)) {
        for (const topping of toppingGroup.toppings) {
          const option = {
            id: topping._id,
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
  
  const convertedDish = {
    basePrice,
    groups,
  };
  
  // Store beecomm metadata separately
  const customDescription = customDescriptions[dishKey] || null;
  const finalDescription = customDescription || dish.description || null;
  
  const descriptionTranslate = {};
  if (finalDescription) {
    descriptionTranslate.he = finalDescription;
    const enTranslation = translateHebrew(finalDescription, 'en');
    const arTranslation = translateHebrew(finalDescription, 'ar');
    const ruTranslation = translateHebrew(finalDescription, 'ru');
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

/**
 * Main function
 */
async function main() {
  // Get config file path from command line argument
  const configPath = process.argv[2];
  
  if (!configPath) {
    console.error('Usage: node import_bcom_menu.js <config-file.json>');
    console.error('Example: node import_bcom_menu.js labraca.json');
    process.exit(1);
  }
  
  // Read configuration file
  let config;
  try {
    const configContent = readFileSync(configPath, 'utf8');
    config = JSON.parse(configContent);
    console.log(`✅ Loaded configuration from: ${configPath}`);
  } catch (error) {
    console.error(`❌ Failed to read config file: ${configPath}`, error.message);
    process.exit(1);
  }
  
  // Get restaurantId and branchId from config or environment variables
  const restaurantId = config.restaurantId || process.env.BEECOMM_RESTAURANT_ID;
  const branchId = config.branchId || process.env.BEECOMM_BRANCH_ID;
  
  // Validate required fields
  if (!restaurantId || !branchId) {
    console.error('❌ Configuration must include restaurantId and branchId, or set BEECOMM_RESTAURANT_ID and BEECOMM_BRANCH_ID in .env');
    process.exit(1);
  }
  
  console.log(`📋 Using restaurantId: ${restaurantId}`);
  console.log(`📋 Using branchId: ${branchId}`);
  
  if (!config.outputMenuFile || !config.outputMetadataFile) {
    console.error('❌ Configuration must include outputMenuFile and outputMetadataFile');
    process.exit(1);
  }
  
  // Load custom descriptions if specified
  let customDescriptions = {};
  if (config.customDescriptionsFile) {
    try {
      const descriptionsPath = join(__dirname, '..', '..', '..', config.customDescriptionsFile);
      const descriptionsContent = readFileSync(descriptionsPath, 'utf8');
      customDescriptions = JSON.parse(descriptionsContent);
      console.log(`✅ Loaded ${Object.keys(customDescriptions).length} custom descriptions`);
    } catch (error) {
      console.log(`⚠️  Could not load custom descriptions: ${error.message}`);
    }
  }
  
  // Load drinks menu if specified
  let drinksMenu = {};
  if (config.drinksMenuFile) {
    try {
      const drinksPath = join(__dirname, '..', '..', '..', config.drinksMenuFile);
      const drinksContent = readFileSync(drinksPath, 'utf8');
      drinksMenu = JSON.parse(drinksContent);
      console.log(`✅ Loaded ${Object.keys(drinksMenu).length} drinks`);
    } catch (error) {
      console.log(`⚠️  Could not load drinks menu: ${error.message}`);
    }
  }
  
  // Get access token
  console.log('🔐 Authenticating with Beecomm API...');
  const accessToken = await getAccessToken();
  console.log('✅ Authentication successful');
  
  // Get menu from Beecomm
  console.log(`📥 Fetching menu from Beecomm (restaurantId: ${restaurantId}, branchId: ${branchId})...`);
  const menuData = await getMenu(accessToken, restaurantId, branchId);
  
  if (!menuData.result) {
    console.error('❌ Failed to fetch menu:', menuData.message);
    process.exit(1);
  }
  
  const menuRevision = menuData.menuRevision || '';
  const categories = menuData.deliveryMenu?.categories || [];
  console.log(`✅ Menu fetched successfully (revision: ${menuRevision}, ${categories.length} categories)`);
  
  // Extract dishes based on config filters
  console.log('🔍 Extracting dishes based on configuration filters...');
  const allDishes = extractDishesFromCategories(categories, config);
  
  if (allDishes.length === 0) {
    console.error('❌ No dishes found matching the configuration filters!');
    process.exit(1);
  }
  
  console.log(`✅ Found ${allDishes.length} dishes`);
  
  // Identify side dishes if configured
  const SIDE_DISH_INDICATORS = config.sideDishIndicators || {
    priceThreshold: 20,
    namePatterns: ['תוספת', 'תפוח אדמה', 'סלט ירוק'],
  };
  
  function isSideDish(dish) {
    const price = typeof dish.price === 'number' ? dish.price : parseFloat(dish.price) || 0;
    const name = dish.name || '';
    
    if (price <= SIDE_DISH_INDICATORS.priceThreshold) {
      return true;
    }
    
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
  
  // Convert dishes
  console.log('🔄 Converting dishes to menu format...');
  const organized = config.organized === true;
  let menu = organized ? { categories: [] } : {};
  const beecommMetadata = {
    menuRevision,
    source: 'beecomm',
    generatedAt: new Date().toISOString(),
    totalDishes: mainDishes.length,
    dishMappings: {},
  };
  
  if (organized) {
    // Build organized structure by categories and subcategories
    const categoryMap = {};
    
    for (const dish of mainDishes) {
      const result = convertDish(dish, customDescriptions);
      if (!result) continue;
      
      const categoryId = dish._categoryId;
      const subCategoryId = dish._subCategoryId;
      
      if (!categoryId || !subCategoryId) {
        console.warn(`⚠️  Dish ${result.key} missing category/subcategory info, skipping organization`);
        // Fallback to flat structure for this dish
        if (!menu.dishes) menu.dishes = {};
        menu.dishes[result.key] = result.dish;
        beecommMetadata.dishMappings[result.key] = result.beecommData;
        continue;
      }
      
      // Initialize category if not exists
      if (!categoryMap[categoryId]) {
        categoryMap[categoryId] = {
          id: categoryId,
          name: dish._categoryName,
          nameTranslate: dish._categoryNameTranslate || {},
          sortIndex: dish._categorySortIndex || 0,
          subCategories: {},
        };
      }
      
      // Initialize subcategory if not exists
      if (!categoryMap[categoryId].subCategories[subCategoryId]) {
        categoryMap[categoryId].subCategories[subCategoryId] = {
          id: subCategoryId,
          name: dish._subCategoryName,
          nameTranslate: dish._subCategoryNameTranslate || {},
          sortIndex: dish._subCategorySortIndex || 0,
          dishes: {},
        };
      }
      
      // Add dish to subcategory
      categoryMap[categoryId].subCategories[subCategoryId].dishes[result.key] = result.dish;
      beecommMetadata.dishMappings[result.key] = result.beecommData;
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
      
      menu.categories.push({
        id: category.id,
        name: category.name,
        nameTranslate: category.nameTranslate,
        sortIndex: category.sortIndex,
        subCategories: subCategoriesArray,
      });
    }
    
    // Sort categories by sortIndex
    menu.categories.sort((a, b) => (a.sortIndex || 0) - (b.sortIndex || 0));
    
    console.log(`✅ Organized menu with ${menu.categories.length} categories`);
    for (const category of menu.categories) {
      const totalDishes = category.subCategories.reduce((sum, sub) => sum + Object.keys(sub.dishes).length, 0);
      console.log(`  - ${category.name}: ${category.subCategories.length} subcategories, ${totalDishes} dishes`);
    }
  } else {
    // Convert main dishes to flat structure
    for (const dish of mainDishes) {
      const result = convertDish(dish, customDescriptions);
      if (result) {
        menu[result.key] = result.dish;
        beecommMetadata.dishMappings[result.key] = result.beecommData;
      }
    }
  }
  
  // Add side dishes as options if configured
  if (sideDishes.length > 0 && config.addSideDishesTo) {
    const sideDishGroupId = config.sideDishGroupId || `side_dishes_${Date.now()}`;
    const sideDishGroup = {
      id: sideDishGroupId,
      type: 'multiple',
      title: config.sideDishGroupTitle || {
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
    
    for (const sideDish of sideDishes) {
      const price = typeof sideDish.price === 'number' ? sideDish.price : parseFloat(sideDish.price) || 0;
      const sideDishId = sideDish.dishId || sideDish._id;
      const sideDishDescription = customDescriptions[sideDishId] || sideDish.description || null;
      
      const sideDishDescriptionTranslate = {};
      if (sideDishDescription) {
        sideDishDescriptionTranslate.he = sideDishDescription;
        const enTranslation = translateHebrew(sideDishDescription, 'en');
        const arTranslation = translateHebrew(sideDishDescription, 'ar');
        const ruTranslation = translateHebrew(sideDishDescription, 'ru');
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
      
      // Add to metadata
      for (const dishId of config.addSideDishesTo) {
        if (beecommMetadata.dishMappings[dishId]) {
          if (!beecommMetadata.dishMappings[dishId].groupMappings) {
            beecommMetadata.dishMappings[dishId].groupMappings = [];
          }
          
          let groupMapping = beecommMetadata.dishMappings[dishId].groupMappings.find(
            gm => gm.groupId === sideDishGroupId
          );
          
          if (!groupMapping) {
            groupMapping = {
              groupId: sideDishGroupId,
              groupName: sideDishGroup.title.he,
              minQuantity: 0,
              maxQuantity: null,
              allowAboveLimit: false,
              costAboveLimit: 0,
              optionMappings: [],
            };
            beecommMetadata.dishMappings[dishId].groupMappings.push(groupMapping);
          }
          
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
    
    // Add side dish group to specified dishes
    if (organized) {
      // Find dishes in organized structure and add side dish groups
      for (const category of menu.categories) {
        for (const subCategory of category.subCategories) {
          for (const dishId of config.addSideDishesTo) {
            if (subCategory.dishes[dishId]) {
              subCategory.dishes[dishId].groups.push({ ...sideDishGroup });
            }
          }
        }
      }
    } else {
      for (const dishId of config.addSideDishesTo) {
        if (menu[dishId]) {
          menu[dishId].groups.push({ ...sideDishGroup });
        }
      }
    }
    
    console.log(`  → Added ${sideDishes.length} side dishes as options to ${config.addSideDishesTo.length} dishes`);
  }
  
  // Add drinks menu if configured
  if (Object.keys(drinksMenu).length > 0 && config.addDrinksTo) {
    const drinksGroupId = config.drinksGroupId || `drinks_${Date.now()}`;
    const drinksGroup = {
      id: drinksGroupId,
      type: 'multiple',
      title: config.drinksGroupTitle || {
        he: 'משקאות',
        en: 'Drinks',
        ar: 'مشروبات',
        ru: 'Напитки',
      },
      required: false,
      min: 0,
      max: null,
      options: [],
    };
    
    // Get drink metadata from config or use defaults
    const drinksMetadata = config.drinksMetadata || {};
    
    // Convert drinks to options
    const drinkVariants = [];
    for (const [drinkId, drinkData] of Object.entries(drinksMenu)) {
      const drinkMetadata = drinksMetadata[drinkId];
      
      if (!drinkMetadata) {
        console.warn(`  → Warning: No metadata found for drink ${drinkId}, skipping`);
        continue;
      }
      
      if (drinkData.price !== undefined) {
        drinkVariants.push({
          id: drinkId,
          price: drinkData.price,
          dishId: drinkMetadata.dishId,
          nameTranslate: drinkMetadata.nameTranslate || drinkMetadata.baseName || {},
          descriptionTranslate: drinkMetadata.descriptionTranslate || drinkMetadata.description || {},
        });
      }
    }
    
    // Add drinks metadata to beecommMetadata for each variant
    for (const variant of drinkVariants) {
      beecommMetadata.dishMappings[variant.id] = {
        dishId: variant.dishId,
        dishName: variant.nameTranslate.he || variant.id,
        kitchenName: variant.nameTranslate.he || variant.id,
        imagePath: null,
        description: variant.descriptionTranslate.he || null,
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
    
    // Convert drink variants to options
    for (const variant of drinkVariants) {
      const option = {
        id: variant.id,
        price: variant.price,
        label: variant.nameTranslate,
      };
      drinksGroup.options.push(option);
      
      // Add to metadata groupMappings for each meal
      for (const mealId of config.addDrinksTo) {
        if (beecommMetadata.dishMappings[mealId]) {
          if (!beecommMetadata.dishMappings[mealId].groupMappings) {
            beecommMetadata.dishMappings[mealId].groupMappings = [];
          }
          
          let groupMapping = beecommMetadata.dishMappings[mealId].groupMappings.find(
            gm => gm.groupId === drinksGroupId
          );
          
          if (!groupMapping) {
            groupMapping = {
              groupId: drinksGroupId,
              groupName: drinksGroup.title.he,
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
            dishId: variant.dishId,
            kitchenName: variant.nameTranslate.he || variant.id,
            isDish: true,
            isVariable: false,
          });
        }
      }
    }
    
    // Add drinks group to specified dishes
    if (organized) {
      // Find dishes in organized structure and add drinks groups
      for (const category of menu.categories) {
        for (const subCategory of category.subCategories) {
          for (const mealId of config.addDrinksTo) {
            if (subCategory.dishes[mealId]) {
              subCategory.dishes[mealId].groups.push({ ...drinksGroup });
            }
          }
        }
      }
    } else {
      for (const mealId of config.addDrinksTo) {
        if (menu[mealId]) {
          menu[mealId].groups.push({ ...drinksGroup });
        }
      }
    }
    
    console.log(`  → Added ${drinksGroup.options.length} drink options to ${config.addDrinksTo.length} meals`);
  }
  
  // Write output files
  const menuOutputPath = join(__dirname, '..', '..', '..', config.outputMenuFile);
  const metadataOutputPath = join(__dirname, '..', '..', '..', config.outputMetadataFile);
  
  console.log(`💾 Writing menu to: ${menuOutputPath}`);
  writeFileSync(menuOutputPath, JSON.stringify(menu, null, 2), 'utf8');
  
  console.log(`💾 Writing metadata to: ${metadataOutputPath}`);
  writeFileSync(metadataOutputPath, JSON.stringify(beecommMetadata, null, 2), 'utf8');
  
  console.log(`\n✅ Successfully imported ${mainDishes.length} dishes`);
  console.log(`✅ Menu saved to: ${config.outputMenuFile}`);
  console.log(`✅ Metadata saved to: ${config.outputMetadataFile}`);
  console.log(`📋 Menu revision: ${menuRevision}`);
}

// Run main function
main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
