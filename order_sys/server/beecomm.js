import express from 'express';
import axios from 'axios';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { validateTransaction, getOrderData } from './pelecard.js';
import { executeSql } from './sources/dbpool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

const {
  BEECOMM_CLIENT_ID,
  BEECOMM_CLIENT_SECRET,
  BEECOMM_API_BASE_URL = 'https://api.beecommcloud.com/v1',
  BEECOMM_RESTAURANT_ID,
  BEECOMM_BRANCH_ID,
  BEECOMM_PUSH_ORDERS = 'true',
} = process.env;

// Create axios instance for Beecomm API
const beecommApi = axios.create({
  baseURL: BEECOMM_API_BASE_URL,
  timeout: 10000,
});

/**
 * Get access token from Beecomm API
 * @returns {Promise<string>} access_token
 */
async function getAccessToken() {
  if (!BEECOMM_CLIENT_ID || !BEECOMM_CLIENT_SECRET) {
    throw new Error('BEECOMM_CLIENT_ID and BEECOMM_CLIENT_SECRET must be set in .env');
  }

  try {
    const params = new URLSearchParams();
    params.append('client_id', BEECOMM_CLIENT_ID);
    params.append('client_secret', BEECOMM_CLIENT_SECRET);

    const { data } = await beecommApi.post('/auth/token', params);

    if (!data.result || !data.access_token) {
      throw new Error(
        `Beecomm auth failed: ${data.message || 'Unknown error'} (requestId=${data.requestId})`
      );
    }

    return data.access_token;
  } catch (error) {
    console.error('[beecomm] getAccessToken error:', error.message);
    throw error;
  }
}

/**
 * Push an order to Beecomm
 * @param {string} accessToken
 * @param {Object} orderPayload
 * @returns {Promise<Object>}
 */
async function pushOrder(accessToken, orderPayload) {
  try {
    const { data } = await beecommApi.post('/order-center/pushOrder', orderPayload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    return data;
  } catch (error) {
    console.error('[beecomm] pushOrder error:', error.message);
    if (error.response) {
      console.error('[beecomm] pushOrder response:', error.response.data);
    }
    throw error;
  }
}

/**
 * Get access list (restaurants & branches) from Beecomm
 * @param {string} accessToken
 * @returns {Promise<Object>}
 */
async function getAccessList(accessToken) {
  try {
    const { data } = await beecommApi.get('/ext/getAccessList', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    return data;
  } catch (error) {
    console.error('[beecomm] getAccessList error:', error.message);
    if (error.response) {
      console.error('[beecomm] getAccessList response:', error.response.data);
    }
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
    console.error('[beecomm] getMenu error:', error.message);
    if (error.response) {
      console.error('[beecomm] getMenu response:', error.response.data);
    }
    throw error;
  }
}

/**
 * Format JSON as pretty HTML
 * @param {Object} data
 * @returns {string}
 */
function formatJsonAsHtml(data) {
  const jsonString = JSON.stringify(data, null, 2);
  const escapedJson = jsonString
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Beecomm Menu</title>
  <style>
    body {
      font-family: 'Courier New', monospace;
      background: #1e1e1e;
      color: #d4d4d4;
      padding: 20px;
      margin: 0;
    }
    pre {
      background: #252526;
      border: 1px solid #3e3e42;
      border-radius: 4px;
      padding: 20px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .key { color: #9cdcfe; }
    .string { color: #ce9178; }
    .number { color: #b5cea8; }
    .boolean { color: #569cd6; }
    .null { color: #569cd6; }
  </style>
</head>
<body>
  <h1>Beecomm Menu</h1>
  <pre>${escapedJson}</pre>
</body>
</html>
  `.trim();
}

/**
 * Structure order data from Pelecard feedback for Beecomm
 * This is a simplified example - you'll need to adapt based on your actual order structure
 * @param {Object} pelecardData - Data from Pelecard feedback
 * @param {Object} orderData - Your internal order data
 * @returns {Object} Beecomm order payload
 */
function structureOrderForBeecomm(pelecardData, orderData) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const purchaseTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  // Extract amount from Pelecard data (in agorot, convert to NIS)
  const totalInAgorot = parseInt(pelecardData.DebitTotal || pelecardData.Total || '0', 10);
  const orderTotal = totalInAgorot / 100;

  // Build order payload according to Beecomm API spec
  // This is a template - you'll need to adapt based on your actual order structure
  const payload = {
    restaurantId: BEECOMM_RESTAURANT_ID,
    branchId: BEECOMM_BRANCH_ID,
    menuRevision: orderData.menuRevision || '', // You should store this when fetching menu
    orderInfo: {
      orderType: 3, // 2 = takeaway, 3 = delivery
      comments: orderData.comments || `Order from Pelecard transaction ${pelecardData.PelecardTransactionId || ''}`,
      discountAmount: 0,
      internalOrderId: pelecardData.ParamX || pelecardData.UserKey || `order-${now.getTime()}`,
      dinnersCount: 1,
      purchaseTime,
      orderTotal,
      dinners: [
        {
          firstName: orderData.customerFirstName || '',
          lastName: orderData.customerLastName || '',
          phoneNumber: orderData.phoneNumber || '',
          emailAddress: orderData.emailAddress || '',
          items: orderData.items || [], // Array of dish items
        },
      ],
      payments: [
        {
          charged: true, // Already charged via Pelecard
          paymentType: 1, // 1=Credit, 2=Cash, etc.
          paymentSum: orderTotal,
          tip: 0,
          cardInfo: {
            approvalNumber: pelecardData.ApprovalNo || pelecardData.DebitApproveNumber || '',
            cardNumber: pelecardData.CreditCardNumber || '',
            cardExpirationDate: pelecardData.CreditCardExpDate || '',
            cardHolderName: pelecardData.CardHolderName || '',
            cvv: 0,
          },
        },
      ],
      deliveryInfo: orderData.deliveryInfo || {},
    },
  };

  return payload;
}

// POST /beecomm/pelecard/placeorder
// This endpoint is called by Pelecard servers (ServerSideGoodFeedbackURL)
// Pelecard may send the body as:
// 1. Raw JSON string (if ServerSideFeedbackContentType is not set or is text/plain)
// 2. Form-encoded with JSON in a field (if resultDataKeyName is set)
// 3. Application/json (if ServerSideFeedbackContentType is application/json)
router.post('/pelecard/placeorder', express.text({ type: ['text/plain', 'text/*'] }), async (req, res) => {
  console.log('[beecomm] Pelecard placeorder received - raw body type:', typeof req.body);

  try {
    // Parse Pelecard feedback data
    // According to Pelecard docs:
    // - If resultDataKeyName is empty: entire request body is JSON
    // - If resultDataKeyName is set: form POST with field containing JSON string
    // - Default Content-Type is application/x-www-form-urlencoded
    // - Can be set to application/json via ServerSideFeedbackContentType
    
    let pelecardData = null;
    
    // Case 1: Body is a raw string (JSON string) - needs parsing
    if (req.body && typeof req.body === 'object' && ( req.body.eatalia_res || req.body.resultDataKeyName)) {

      const jsonField = req.body[ "eatalia_res" || req.body.resultDataKeyName ];
    
      if (typeof jsonField === 'string') {
        try {
          const parsed = JSON.parse(jsonField);
          // Check if parsed result has ResultData wrapper
          console.log('[beecomm] Parsed JSON:', parsed);
          
          if (parsed && typeof parsed === 'object' && parsed.ResultData) {
            pelecardData = parsed.ResultData;
            console.log('[beecomm] Parsed JSON from resultDataKeyName field and extracted ResultData:', req.body.resultDataKeyName);
          } else {
            pelecardData = parsed;
            console.log('[beecomm] Parsed JSON from resultDataKeyName field:', req.body.resultDataKeyName);
          }
        } catch (parseError) {
          console.error('[beecomm] Failed to parse JSON from resultDataKeyName field:', parseError.message);
          return res.status(400).json({
            error: 'Invalid JSON format in resultDataKeyName field',
            message: parseError.message,
          });
        }
      } 
      else {
        console.error('[beecomm] Failed to parse JSON from resultDataKeyName fields eatalia_res or:', parseError.message);
        return res.status(400).json({
          error: 'Invalid JSON format in resultDataKeyName field',
          message: parseError.message,
        });
      }
    }
    
    if (!pelecardData) {
      console.error('[beecomm] Could not parse pelecardData from request body');
      return res.status(400).json({
        error: 'Could not parse Pelecard feedback data',
        message: 'Request body format is not recognized',
      });
    }

    // Extract key fields
    // Note: ServerSideGoodFeedbackURL is only called for successful transactions,
    // so PelecardStatusCode is NOT included in the payload (it's only in landing page parameters)
    const {
      ConfirmationKey,
      UserKey,
      ParamX,
      PelecardTransactionId,
      TransactionId,
      DebitTotal,
      Total,
    } = pelecardData;

    // Validate transaction with Pelecard
    const totalInAgorot = parseInt(DebitTotal || Total || '0', 10);
    const uniqueKey = UserKey || PelecardTransactionId;

    if (!ConfirmationKey || !uniqueKey) {
      console.error('[beecomm] Missing ConfirmationKey or UniqueKey');
      return res.status(400).json({
        error: 'Missing required Pelecard validation parameters',
      });
    }

    const isValid = await validateTransaction(ConfirmationKey, uniqueKey, totalInAgorot);

    if (!isValid) {
      console.error('[beecomm] Pelecard validation failed');
      return res.status(400).json({
        error: 'Transaction validation failed',
      });
    }

    console.log('[beecomm] Pelecard transaction validated successfully');

    // Retrieve order data from storage using ConfirmationKey and orderId
    const storedOrderData = getOrderData(ConfirmationKey, uniqueKey);

    if (!storedOrderData) {
      console.error('[beecomm] Order data not found in storage for ConfirmationKey:', ConfirmationKey, 'orderId:', uniqueKey);
      return res.status(404).json({
        error: 'Order data not found',
        message: 'Order information was not found in storage. It may have expired or was never stored.',
      });
    }

    console.log('[beecomm] Retrieved order data from storage:', storedOrderData);

   
    // Get access token
    const accessToken = await getAccessToken();

    // Extract location data for customer info and delivery
    const locationData = storedOrderData.locationData || {};
    const cartItems = storedOrderData.cartItems || [];

    // Load beecomm metadata to get actual dishIds for drinks and other items
    let beecommMetadata = null;
    try {
      let metadataPath;
      if (process.env.MENU_PATH) {
        // Extract the menu name from MENU_PATH (e.g., "menu/tower_menu.json" -> "tower")
        const menuPath = process.env.MENU_PATH;
        const menuName = menuPath.replace(/^.*\/(\w+)_menu\.json$/, '$1');
        metadataPath = join(__dirname, '..', 'menu', `${menuName}_metadata.json`);
      } else {
        // Default to labraca if MENU_PATH is not set
        metadataPath = join(__dirname, '..', 'menu', 'labraca_metadata.json');
      }
      beecommMetadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    } catch (error) {
      console.warn('[beecomm] Could not load metadata, using cartItem.id as dishId:', error.message);
    }

    // Load beecomm menu to get topping names and costs
    let beecommMenu = null;
    try {
      let menuPath;
      if (process.env.MENU_PATH) {
        // If MENU_PATH is absolute, use it as is; otherwise resolve relative to project root
        menuPath = process.env.MENU_PATH.startsWith('/')
          ? process.env.MENU_PATH
          : join(__dirname, '..', process.env.MENU_PATH);
      } else {
        menuPath = join(__dirname, '..', 'menu', 'bcom_menu.json');
      }
      beecommMenu = JSON.parse(readFileSync(menuPath, 'utf8'));
    } catch (error) {
      console.warn('[beecomm] Could not load menu, topping names and costs may be missing:', error.message);
    }

    // Load meal options config to get prices for side dishes and drinks
    let mealOptionsConfig = null;
    try {
      let mealOptionsPath;
      if (process.env.MENU_PATH) {
        // Extract the menu name from MENU_PATH (e.g., "menu/tower_menu.json" -> "tower")
        const menuPath = process.env.MENU_PATH;
        const menuName = menuPath.replace(/^.*\/(\w+)_menu\.json$/, '$1');
        mealOptionsPath = join(__dirname, '..', 'menu', `${menuName}_menu.json`);
      } else {
        // Default to tower if MENU_PATH is not set
        mealOptionsPath = join(__dirname, '..', 'menu', 'tower_menu.json');
      }
      mealOptionsConfig = JSON.parse(readFileSync(mealOptionsPath, 'utf8'));
    } catch (error) {
      console.warn('[beecomm] Could not load meal options config, side dish/drink prices may be missing:', error.message);
    }

    // Helper function to find option price from meal options config
    const findOptionPriceFromConfig = (optionId, groupId, mealOptionsConfig, mealId = null) => {
      if (!mealOptionsConfig) return null;
      
      // If mealId is provided, try that meal first (more efficient)
      if (mealId && mealOptionsConfig[mealId]) {
        const mealConfig = mealOptionsConfig[mealId];
        if (mealConfig && mealConfig.groups) {
          const group = mealConfig.groups.find(g => g.id === groupId);
          if (group && group.options) {
            const option = group.options.find(o => o.id === optionId);
            if (option && option.price !== undefined) {
              return typeof option.price === 'number' ? option.price : parseFloat(option.price) || 0;
            }
          }
        }
      }
      
      // Fallback: search through all meal configs (in case groupId is shared across meals)
      for (const id in mealOptionsConfig) {
        const mealConfig = mealOptionsConfig[id];
        if (mealConfig && mealConfig.groups) {
          const group = mealConfig.groups.find(g => g.id === groupId);
          if (group && group.options) {
            const option = group.options.find(o => o.id === optionId);
            if (option && option.price !== undefined) {
              return typeof option.price === 'number' ? option.price : parseFloat(option.price) || 0;
            }
          }
        }
      }
      return null;
    };

    // Helper function to find dish info from menu by dishId
    const findDishInfo = (dishId, dishMenu) => {
      if (!dishMenu || !dishMenu.deliveryMenu) return null;
      
      // Search through all categories, subCategories, and dishes
      for (const category of dishMenu.deliveryMenu.categories || []) {
        for (const subCategory of category.subCategories || []) {
          for (const dish of subCategory.dishes || []) {
            // Check if this is the dish we're looking for
            if (dish.dishId === dishId || dish._id === dishId) {
              return {
                dishId: dish.dishId || dish._id,
                name: dish.name || dish.kitchenName || '',
                kitchenName: dish.kitchenName || dish.name || '',
                price: typeof dish.price === 'number' ? dish.price : parseFloat(dish.price) || 0,
              };
            }
          }
        }
      }
      return null;
    };

    // Helper function to find topping info from menu
    const findToppingInfo = (dishId, dishMenu) => {
      if (!dishMenu || !dishMenu.deliveryMenu) return null;
      
      // Search through all categories, subCategories, and dishes
      for (const category of dishMenu.deliveryMenu.categories || []) {
        for (const subCategory of category.subCategories || []) {
          for (const dish of subCategory.dishes || []) {
            // Check if this dish has the topping we're looking for
            for (const toppingGroup of dish.toppingGroups || []) {
              for (const topping of toppingGroup.toppings || []) {
                // Check by dishId (for variable toppings) or _id (for regular toppings)
                if (topping.dishId === dishId || topping._id === dishId) {
                  return {
                    toppingId: topping._id,
                    toppingName: topping.name || topping.kitchenName || '',
                    additionalCost: topping.costAddition || 0,
                  };
                }
              }
            }
          }
        }
      }
      return null;
    };

    // Convert cartItems to Beecomm items format
    // Separate side dishes and drinks into separate items instead of toppings
    const allItems = [];
    
    cartItems.forEach((cartItem) => {
      // Get actual Beecomm dishId from metadata if available
      let beecommDishId = cartItem.id;
      if (beecommMetadata && beecommMetadata.dishMappings && beecommMetadata.dishMappings[cartItem.id]) {
        const dishMapping = beecommMetadata.dishMappings[cartItem.id];
        if (dishMapping.dishId) {
          beecommDishId = dishMapping.dishId;
          console.log(`[beecomm] Mapped ${cartItem.id} to Beecomm dishId: ${beecommDishId}`);
        }
      }

      // Get the dish mapping for this cart item to access groupMappings
      const dishMapping = beecommMetadata && beecommMetadata.dishMappings && beecommMetadata.dishMappings[cartItem.id]
        ? beecommMetadata.dishMappings[cartItem.id]
        : null;

      // Separate selections into toppings vs separate items (side dishes/drinks)
      const toppings = [];
      const separateItems = []; // Side dishes and drinks that should be separate items

      if (cartItem.selections) {
        Object.entries(cartItem.selections).forEach(([groupId, optionIds]) => {
          if (Array.isArray(optionIds)) {
            // Check if this group is side dishes or drinks (groups with IDs starting with tower_side_dishes_ or tower_drinks_)
            const isSideDishOrDrinkGroup = groupId.startsWith('tower_side_dishes_') || groupId.startsWith('tower_drinks_');
            
            optionIds.forEach((optionId) => {
              // Try to find the actual Beecomm dishId for this option
              let beecommOptionDishId = optionId;
              let optionMapping = null;
              let isDish = false;
              let isVariable = false;
              let kitchenName = '';
              
              if (dishMapping && dishMapping.groupMappings) {
                // Find the group mapping for this groupId
                const groupMapping = dishMapping.groupMappings.find(
                  gm => gm.groupId === groupId
                );
                
                if (groupMapping && groupMapping.optionMappings) {
                  // Find the option mapping for this optionId
                  optionMapping = groupMapping.optionMappings.find(
                    om => om.optionId === optionId
                  );
                  
                  if (optionMapping) {
                    beecommOptionDishId = optionMapping.dishId || optionId;
                    kitchenName = optionMapping.kitchenName || optionId;
                    isDish = optionMapping.isDish || false;
                    isVariable = optionMapping.isVariable || false;
                    console.log(`[beecomm] Mapped option ${optionId} (group ${groupId}) to Beecomm dishId: ${beecommOptionDishId}, isDish: ${isDish}, isVariable: ${isVariable}`);
                  }
                }
              }

              // Determine if this should be a separate item or a topping
              // Separate item if: group is side dishes/drinks OR (isDish is true AND isVariable is false)
              const shouldBeSeparateItem = isSideDishOrDrinkGroup || (isDish && !isVariable);

              if (shouldBeSeparateItem) {
                // This should be a separate item (side dish or drink)
                // Find the dish price - first try from meal options config, then from menu
                let dishPrice = 0;
                let dishName = kitchenName || optionId;
                
                // First, try to get price from meal options config (where side dishes/drinks prices are stored)
                const optionPrice = findOptionPriceFromConfig(optionId, groupId, mealOptionsConfig, cartItem.id);
                if (optionPrice !== null) {
                  dishPrice = optionPrice;
                  console.log(`[beecomm] Found price ${dishPrice} for option ${optionId} (group ${groupId}, meal ${cartItem.id}) from meal options config`);
                } else {
                  // Fallback: try to find in Beecomm menu
                  const dishInfo = findDishInfo(beecommOptionDishId, beecommMenu);
                  if (dishInfo) {
                    dishPrice = dishInfo.price;
                    dishName = dishInfo.kitchenName || dishInfo.name;
                  } else {
                    // If not found in menu, try to get name from metadata
                    if (beecommMetadata && beecommMetadata.dishMappings && beecommMetadata.dishMappings[beecommOptionDishId]) {
                      const metadataDish = beecommMetadata.dishMappings[beecommOptionDishId];
                      dishName = metadataDish.kitchenName || metadataDish.dishName || dishName;
                    }
                    // If still not found, price will be 0 (free item)
                    console.warn(`[beecomm] Could not find price for option ${optionId} (dishId: ${beecommOptionDishId}), using price 0`);
                  }
                }

                separateItems.push({
                  dishId: beecommOptionDishId,
                  itemName: dishName,
                  quantity: cartItem.quantity || 1,
                  dishPrice: dishPrice,
                  totalPrice: dishPrice * (cartItem.quantity || 1),
                  isCombo: false,
                  preparationComments: '',
                  remarks: [],
                  toppings: [],
                  subItems: [],
                });
              } else {
                // This is a topping
                const toppingInfo = findToppingInfo(beecommOptionDishId, beecommMenu);
                if (toppingInfo) {
                  toppings.push({
                    toppingId: toppingInfo.toppingId,
                    toppingName: toppingInfo.toppingName,
                    additionalCost: toppingInfo.additionalCost,
                    quantity: 1,
                  });
                } else {
                  // Fallback: use metadata or defaults
                  toppings.push({
                    toppingId: beecommOptionDishId,
                    toppingName: kitchenName || optionId,
                    additionalCost: 0,
                    quantity: 1,
                  });
                }
              }
            });
          }
        });
      }

      // Create main dish item with basePrice (not unitPrice which includes options)
      const basePrice = cartItem.basePrice || 0;
      const mainDishItem = {
        dishId: beecommDishId,
        itemName: cartItem.name || cartItem.id,
        isCombo: false,
        quantity: cartItem.quantity || 1,
        dishPrice: basePrice, // Use basePrice instead of unitPrice
        totalPrice: basePrice * (cartItem.quantity || 1),
        preparationComments: '',
        remarks: [],
        toppings: toppings, // Only actual toppings, not side dishes/drinks
        subItems: [],
      };

      allItems.push(mainDishItem);
      
      // Add separate items for side dishes and drinks
      allItems.push(...separateItems);
    });

    const items = allItems;

    // Use stored order data, merging with any additional data from Pelecard
    const orderData = {
      menuRevision: storedOrderData.menuRevision || '',
      customerFirstName: locationData.firstName || pelecardData.CardHolderName?.split(' ')[0] || '',
      customerLastName: locationData.lastName || pelecardData.CardHolderName?.split(' ').slice(1).join(' ') || '',
      phoneNumber: locationData.phone || pelecardData.CardHolderPhone || '',
      emailAddress: locationData.email || pelecardData.CardHolderEmail || '',
      items: items,
      deliveryInfo: {
        firstName: locationData.firstName || '',
        lastName: locationData.lastName || '',
        phoneNumber: locationData.phone || '',
        cellular: locationData.phone || '',
        building: locationData.building || '',
        floor: locationData.floor || '',
        companyName: locationData.office || '',
        cityName: "BSR - Petch Tikva",
        streetName: "building",
        homeNumber: locationData.building || '',
        formattedAddress: `Formatted :Building : ${locationData.building}, ${locationData.floor}, ${locationData.office}, BSR Petch Tikva`,
        deliveryCost:0,

        // Add other delivery fields as needed
      },
      comments: storedOrderData.comments || `Pelecard transaction: ${PelecardTransactionId}`,
      locationData: locationData,
      cartItems: cartItems,
    };

    // Structure order for Beecomm
    const beecommOrder = structureOrderForBeecomm(pelecardData, orderData);
    // console.log('[beecomm] beecommOrder data:', beecommOrder.orderInfo.payments);

    console.log('[beecomm] beecommOrder pushed:', JSON.stringify(beecommOrder, '\t', 2));
    // Push order to Beecomm
     // Check if order push to Beecomm is enabled
    const pushOrdersEnabled = BEECOMM_PUSH_ORDERS.toLowerCase() === 'true';
    
    if (!pushOrdersEnabled) {
      console.log('[beecomm] Order push to Beecomm is disabled via BEECOMM_PUSH_ORDERS environment variable. Skipping order push.');
      // Return success response to Pelecard even if we skip pushing to Beecomm
      // since the payment transaction was successful
      return res.status(200).json({
        success: true,
        skipped: true,
        message: 'Order push to Beecomm is disabled',
      });
    }

    const result = await pushOrder(accessToken, beecommOrder);

    if (!result.result) {
      console.error('[beecomm] pushOrder failed:', result);
      return res.status(500).json({
        error: 'Failed to push order to Beecomm',
        message: result.message,
        status: result.status,
      });
    }

    console.log('[beecomm] Order pushed successfully:', result.orderNumber);

    // Update order in database with beecom orderNumber
    try {
      const orderId = pelecardData.ParamX || pelecardData.UserKey;
      if (orderId && result.orderNumber) {
        // Get current orderData, add beecomOrderNumber, then update
        const getOrderQuery = `SELECT orderData FROM orders WHERE orderId = :orderId`;
        const getOrderResult = await executeSql(getOrderQuery, { orderId });
        
        if (getOrderResult && getOrderResult[0] && getOrderResult[0].length > 0) {
          const currentOrderData = getOrderResult[0][0].orderData;
          let orderDataObj = typeof currentOrderData === 'string' 
            ? JSON.parse(currentOrderData) 
            : currentOrderData;
          
          // Add beecomOrderNumber to orderData
          orderDataObj.beecomOrderNumber = result.orderNumber;
          
          const updateQuery = `
            UPDATE orders 
            SET orderData = :orderData, updated_at = CURRENT_TIMESTAMP
            WHERE orderId = :orderId
          `;
          await executeSql(updateQuery, { 
            orderId, 
            orderData: JSON.stringify(orderDataObj) 
          });
          console.log('[beecomm] Updated order with beecom orderNumber:', result.orderNumber);
        }
      }
    } catch (updateError) {
      console.error('[beecomm] Error updating order with beecom orderNumber:', updateError);
      // Don't fail the request if update fails
    }

    // Return success response to Pelecard
    res.status(200).json({
      success: true,
      orderNumber: result.orderNumber,
      message: result.message,
    });
  } catch (error) {
    console.error('[beecomm] Error processing placeorder:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

// GET /beecomm/getaccesslist
router.get('/getaccesslist', async (req, res) => {
  try {
    // Get access token
    const accessToken = await getAccessToken();

    // Get access list from Beecomm
    const accessListData = await getAccessList(accessToken);

    if (!accessListData.result) {
      return res.status(500).json({
        error: 'Failed to fetch access list from Beecomm',
        message: accessListData.message,
        status: accessListData.status,
      });
    }

    // Return JSON response
    res.json(accessListData);
  } catch (error) {
    console.error('[beecomm] Error fetching access list:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

// GET /beecomm/getmenu
router.get('/getmenu', async (req, res) => {
  try {
    if (!BEECOMM_RESTAURANT_ID || !BEECOMM_BRANCH_ID) {
      return res.status(500).json({
        error: 'BEECOMM_RESTAURANT_ID and BEECOMM_BRANCH_ID must be set in .env',
      });
    }

    // Get access token
    const accessToken = await getAccessToken();

    // Get menu from Beecomm
    const menuData = await getMenu(accessToken, BEECOMM_RESTAURANT_ID, BEECOMM_BRANCH_ID);

    if (!menuData.result) {
      return res.status(500).json({
        error: 'Failed to fetch menu from Beecomm',
        message: menuData.message,
        status: menuData.status,
      });
    }

    // Format as pretty JSON HTML
    const html = formatJsonAsHtml(menuData);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    console.error('[beecomm] Error fetching menu:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

export default router;

// Export a separate router for API endpoints
export const menuApiRouter = express.Router();

// GET /api/meal-options
menuApiRouter.get('/meal-options', (req, res) => {
  try {
    let menuPath;
    const menuParam = req.query.menu; // e.g., 'labraca', 'tower', etc.
    const organized = req.query.organized === 'true'; // Return organized structure for labraca
    
    if (menuParam) {
      // Use menu parameter to determine menu file
      menuPath = join(__dirname, '..', 'menu', `${menuParam}_menu.json`);
    } else if (process.env.MENU_PATH) {
      // If MENU_PATH is absolute, use it as is; otherwise resolve relative to project root
      menuPath = process.env.MENU_PATH.startsWith('/')
        ? process.env.MENU_PATH
        : join(__dirname, '..', process.env.MENU_PATH);
    } else {
      menuPath = join(__dirname, '..', 'menu', 'mealOptions.json');
    }
    const mealOptions = JSON.parse(readFileSync(menuPath, 'utf8'));
    
    // If menu is organized (has categories) and organized=true, return as-is
    // Otherwise, flatten it for backward compatibility
    if (organized && mealOptions.categories) {
      res.json(mealOptions);
    } else if (mealOptions.categories) {
      // Flatten organized structure for backward compatibility
      const flatMenu = {};
      for (const category of mealOptions.categories) {
        for (const subCategory of category.subCategories) {
          for (const [dishId, dishData] of Object.entries(subCategory.dishes)) {
            flatMenu[dishId] = dishData;
          }
        }
      }
      res.json(flatMenu);
    } else {
      // Already flat structure
      res.json(mealOptions);
    }
  } catch (error) {
    console.error('Error loading meal options:', error);
    res.status(500).json({ error: 'Failed to load meal options' });
  }
});

// GET /api/beecomm-metadata
menuApiRouter.get('/beecomm-metadata', (req, res) => {
  try {
    // Determine which metadata file to use based on menu parameter or MENU_PATH
    let metadataPath;
    const menuParam = req.query.menu; // e.g., 'labraca', 'tower', etc.
    
    if (menuParam) {
      // Use menu parameter to determine metadata file
      metadataPath = join(__dirname, '..', 'menu', `${menuParam}_metadata.json`);
    } else if (process.env.MENU_PATH) {
      // Extract the menu name from MENU_PATH (e.g., "menu/tower_menu.json" -> "tower")
      const menuPath = process.env.MENU_PATH;
      const menuName = menuPath.replace(/^.*\/(\w+)_menu\.json$/, '$1');
      metadataPath = join(__dirname, '..', 'menu', `${menuName}_metadata.json`);
    } else {
      // Default to labraca if MENU_PATH is not set
      metadataPath = join(__dirname, '..', 'menu', 'labraca_metadata.json');
    }
    
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    res.json(metadata);
  } catch (error) {
    console.error('Error loading beecomm metadata:', error);
    // Return empty metadata if file doesn't exist (for backward compatibility)
    res.json({
      menuRevision: '',
      source: 'beecomm',
      dishMappings: {},
    });
  }
});

