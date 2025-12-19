// Default image for dishes when no image is provided
const DEFAULT_DISH_IMAGE = '/resources/images/default-dish-image.svg';

/**
 * Resolves dish image using 3-layer priority:
 * 1. Image from menu (menuImage) - highest priority
 * 2. Image from images map JSON (imagesMap) - middle priority (keyed by dish ID)
 * 3. Default image - lowest priority/fallback
 * 
 * @param {string} dishId - The dish/meal ID (API ID for dynamic meals, or dish name for hardcoded)
 * @param {string|null|undefined} menuImage - Image from menu data
 * @param {Object<string, string>} imagesMap - Map of dish IDs to image URLs
 * @returns {string} Resolved image URL
 */
export const resolveDishImage = (dishId, menuImage, imagesMap = {}) => {
  // Layer 1: Use image from menu if available and valid
  if (menuImage && menuImage.trim() !== '') {
    return menuImage;
  }
  
  // Layer 2: Use image from images map if available (keyed by dish ID)
  if (imagesMap && imagesMap[dishId] && imagesMap[dishId].trim() !== '') {
    return imagesMap[dishId];
  }
  
  // Layer 3: Fallback to default image
  return DEFAULT_DISH_IMAGE;
};

export { DEFAULT_DISH_IMAGE };
