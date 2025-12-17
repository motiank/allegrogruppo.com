import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read the beecomm menu file
const beecommMenuPath = join(__dirname, '..', 'order_sys', 'menu', 'bcom_menu.json');
const descriptionsOutputPath = join(__dirname, '..', 'order_sys', 'menu', 'bcom_descriptions.json');

console.log('Reading beecomm menu from:', beecommMenuPath);
const beecommMenu = JSON.parse(readFileSync(beecommMenuPath, 'utf8'));

// Extract all unique dishes
const dishes = {};

function extractDishes(categories) {
  for (const cat of categories || []) {
    if (cat.subCategories) {
      for (const sub of cat.subCategories || []) {
        if (sub.dishes) {
          for (const dish of sub.dishes) {
            if (dish.dishId && !dishes[dish.dishId]) {
              dishes[dish.dishId] = {
                name: dish.name || dish.kitchenName || 'Unknown',
                description: '' // Empty description to be filled by user
              };
            }
          }
        }
      }
    }
  }
}

extractDishes(beecommMenu.deliveryMenu?.categories || []);

// Add example description for hamburger
const hamburgerId = '668e21afff9c99b7862ec370';
if (dishes[hamburgerId]) {
  dishes[hamburgerId].description = '250  גרם , לחמניית בריוש, חסה , בצל  ועגבניה';
}

// Create the descriptions object
const descriptions = {};
for (const [dishId, dish] of Object.entries(dishes)) {
  descriptions[dishId] = dish.description;
}

// Write the descriptions file
console.log('Writing descriptions to:', descriptionsOutputPath);
writeFileSync(descriptionsOutputPath, JSON.stringify(descriptions, null, 2), 'utf8');

console.log(`✅ Successfully created descriptions file with ${Object.keys(dishes).length} dishes`);
console.log(`📝 Edit ${descriptionsOutputPath} to add Hebrew descriptions for each dish`);

