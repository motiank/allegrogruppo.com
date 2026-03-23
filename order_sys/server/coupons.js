import express from 'express';
import { executeSql } from './sources/dbpool.js';
import { getAccessToken, pushOrder } from './beecomm.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const {
  BEECOMM_RESTAURANT_ID,
  BEECOMM_BRANCH_ID,
  BEECOMM_PUSH_ORDERS = 'true',
} = process.env;

const router = express.Router();

/**
 * Check coupon and process order if valid
 * This endpoint validates the coupon and processes the order server-side
 * Client should NOT place orders - only follow server instructions
 */
router.post('/check', express.json(), async (req, res) => {
  try {
    const { couponCode, orderId, orderData: requestOrderData } = req.body || {};

    if (!orderId) {
      return res.status(400).json({
        action: 'payment',
        error: 'orderId is required',
      });
    }

    // If no coupon code, proceed to payment
    if (!couponCode || typeof couponCode !== 'string' || !couponCode.trim()) {
      return res.json({
        action: 'payment', // No coupon, proceed to payment
        valid: false,
      });
    }

    const code = couponCode.trim();

    // Query coupon from database
    const query = `
      SELECT coupon_id, name, type, created_at, expired_at, used_at, cancelled_at
      FROM coupons
      WHERE name = :code
      LIMIT 1
    `;

    const [rows] = await executeSql(query, { code });

    if (!rows || rows.length === 0) {
      return res.json({
        action: 'payment', // Invalid coupon, proceed to payment
        valid: false,
        error: 'Coupon not found',
      });
    }

    const coupon = rows[0];

    // Check if cancelled
    if (coupon.cancelled_at) {
      return res.json({
        action: 'payment', // Cancelled coupon, proceed to payment
        valid: false,
        error: 'Coupon has been cancelled',
      });
    }

    // Check if already used
    if (coupon.used_at) {
      return res.json({
        action: 'payment', // Used coupon, proceed to payment
        valid: false,
        error: 'Coupon has already been used',
      });
    }

    // Check if expired
    if (coupon.expired_at) {
      const expiredDate = new Date(coupon.expired_at);
      const now = new Date();
      if (expiredDate < now) {
        return res.json({
          action: 'payment', // Expired coupon, proceed to payment
          valid: false,
          error: 'Coupon has expired',
        });
      }
    }

    // Coupon is valid - process order server-side
    if (!requestOrderData) {
      return res.status(400).json({
        action: 'payment',
        error: 'orderData is required for coupon orders',
      });
    }

    // Process the coupon order (reuse logic from placeorder endpoint)
    try {
      const result = await processCouponOrder(orderId, code, coupon, requestOrderData);
      
      return res.json({
        action: 'thankYou', // Valid coupon, order processed, skip payment
        valid: true,
        coupon: {
          coupon_id: coupon.coupon_id,
          name: coupon.name,
          type: coupon.type,
        },
        orderNumber: result.orderNumber,
        message: 'Coupon validated and order processed successfully.',
      });
    } catch (orderError) {
      console.error('[coupons] Error processing coupon order:', orderError);
      return res.status(500).json({
        action: 'payment', // On order processing error, proceed to payment
        valid: false,
        error: 'Failed to process coupon order',
        message: orderError.message,
      });
    }
  } catch (error) {
    console.error('[coupons] Error checking coupon:', error);
    return res.status(500).json({
      action: 'payment', // On error, proceed to payment
      valid: false,
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * Calculate discount based on coupon type
 * @param {string} couponType - The coupon type (e.g., "AFB", "Affiliate First Bonus")
 * @param {number} originalTotal - The original order total before discount
 * @returns {number} The discount amount to apply
 */
function calculateDiscountByType(couponType, originalTotal) {
  if (!couponType) {
    return 0;
  }

  const type = couponType.trim().toUpperCase();
  
  // AFB (Affiliate First Bonus) = 100% discount
  // Check for both "AFB" abbreviation and full name "Affiliate First Bonus"
  if (type === 'AFB' || type === 'AFFILIATE FIRST BONUS' || type.includes('AFFILIATE FIRST BONUS')) {
    return originalTotal; // 100% discount = full amount
  }

  // Add more coupon types here as needed
  // Example:
  // if (type === 'PERCENTAGE_10') {
  //   return originalTotal * 0.10; // 10% discount
  // }
  // if (type === 'FIXED_5') {
  //   return 5; // Fixed ₪5 discount
  // }

  // Default: no discount
  return 0;
}

/**
 * Structure order for Beecomm when using a coupon
 * Applies discount based on coupon type
 */
function structureOrderForBeecommWithCoupon(orderData, couponType) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const purchaseTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  
  // Calculate original total from items (before discount)
  const originalTotal = orderData.items?.reduce((sum, item) => {
    const itemTotal = (item.dishPrice || 0) * (item.quantity || 1);
    const toppingsTotal = (item.toppings || []).reduce((tSum, topping) => {
      return tSum + (topping.additionalCost || 0) * (topping.quantity || 1);
    }, 0);
    return sum + itemTotal + toppingsTotal;
  }, 0) || 0;

  // Calculate discount based on coupon type
  const discountAmount = calculateDiscountByType(couponType, originalTotal);
  
  // Calculate final total after discount
  const orderTotal = Math.max(0, originalTotal - discountAmount);

  // Determine payment type based on discount
  // If 100% discount (free), use paymentType 3 (Coupon/Free)
  // Otherwise, use paymentType 1 (Credit) but with reduced amount
  const isFreeOrder = discountAmount >= originalTotal;
  const paymentType = isFreeOrder ? 3 : 1; // 1=Credit, 3=Coupon/Free
  const paymentSum = isFreeOrder ? 0 : orderTotal;
  const charged = !isFreeOrder; // Only charge if not free

  // Build order payload with proper discount
  const payload = {
    restaurantId: BEECOMM_RESTAURANT_ID,
    branchId: BEECOMM_BRANCH_ID,
    menuRevision: orderData.menuRevision || '',
    orderInfo: {
      orderType: 3, // 2 = takeaway, 3 = delivery
      comments: orderData.comments || `Order with coupon: ${orderData.couponCode || ''} (Type: ${couponType || 'N/A'})`,
      discountAmount: discountAmount, // Discount amount applied
      internalOrderId: orderData.orderId || `coupon-order-${now.getTime()}`,
      dinnersCount: 1,
      purchaseTime,
      orderTotal: orderTotal, // Final total after discount
      dinners: [
        {
          firstName: orderData.locationData?.name?.split(' ')[0] || '',
          lastName: orderData.locationData?.name?.split(' ').slice(1).join(' ') || '',
          phoneNumber: orderData.locationData?.phone || '',
          emailAddress: '',
          items: orderData.items || [],
        },
      ],
      payments: [
        {
          charged: charged, // true if needs payment, false if free
          paymentType: paymentType, // 1=Credit, 3=Coupon/Free
          paymentSum: paymentSum, // Amount to charge (0 if free)
          tip: 0,
          cardInfo: isFreeOrder ? null : {
            approvalNumber: '',
            cardNumber: '',
            cardExpirationDate: '',
            cardHolderName: '',
            cvv: 0,
          },
        },
      ],
      deliveryInfo: orderData.deliveryInfo || {},
    },
  };

  console.log('[coupons] Order structured with discount:', {
    couponType,
    originalTotal,
    discountAmount,
    orderTotal,
    paymentType,
    paymentSum,
    charged,
  });

  return payload;
}

/**
 * Process coupon order (extracted for reuse)
 * This function processes the order server-side when coupon is valid
 */
async function processCouponOrder(orderId, couponCode, coupon, requestOrderData) {
  console.log('[coupons] Processing coupon order:', { orderId, couponCode });

  // Load beecomm metadata and menu (similar to pelecard flow)
  let beecommMetadata = null;
  let beecommMenu = null;
  let mealOptionsConfig = null;

  try {
    const metadataPath = join(__dirname, '../menu/tower_metadata.json');
    beecommMetadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  } catch (error) {
    console.warn('[coupons] Could not load metadata:', error.message);
  }

  try {
    const menuPath = join(__dirname, '../menu/tower_menu.json');
    beecommMenu = JSON.parse(readFileSync(menuPath, 'utf8'));
  } catch (error) {
    console.warn('[coupons] Could not load menu:', error.message);
  }

  try {
    const mealOptionsPath = join(__dirname, '../menu/mealOptions.json');
    mealOptionsConfig = JSON.parse(readFileSync(mealOptionsPath, 'utf8'));
  } catch (error) {
    console.warn('[coupons] Could not load meal options config:', error.message);
  }

  // Process cart items - reuse the same structure as beecomm.js
  const cartItems = requestOrderData?.cartItems || [];
  const locationData = requestOrderData?.locationData || {};

  // Helper functions (simplified versions from beecomm.js)
  const findDishInfo = (dishId, menu) => {
    if (!menu || !menu.dishes) return null;
    return menu.dishes.find((d) => d.dishId === dishId) || null;
  };

  const findToppingInfo = (toppingId, menu) => {
    if (!menu || !menu.toppings) return null;
    return menu.toppings.find((t) => t.toppingId === toppingId) || null;
  };

  const findOptionPriceFromConfig = (optionId, groupId, config, mealId) => {
    if (!config || !config[mealId] || !config[mealId].groups) return null;
    const group = config[mealId].groups.find((g) => g.id === groupId);
    if (!group || !group.options) return null;
    const option = group.options.find((o) => o.id === optionId);
    return option?.price !== undefined ? option.price : null;
  };

  // Convert cartItems to Beecomm items format (similar to beecomm.js)
  const allItems = [];

  cartItems.forEach((cartItem) => {
    // Get actual Beecomm dishId from metadata if available
    let beecommDishId = cartItem.id;
    if (beecommMetadata && beecommMetadata.dishMappings && beecommMetadata.dishMappings[cartItem.id]) {
      const dishMapping = beecommMetadata.dishMappings[cartItem.id];
      if (dishMapping.dishId) {
        beecommDishId = dishMapping.dishId;
      }
    }

    const dishMapping = beecommMetadata?.dishMappings?.[cartItem.id] || null;

    // Separate selections into toppings vs separate items
    const toppings = [];
    const separateItems = [];

    if (cartItem.selections) {
      Object.entries(cartItem.selections).forEach(([groupId, optionIds]) => {
        if (Array.isArray(optionIds)) {
          const isSideDishOrDrinkGroup = groupId.startsWith('tower_side_dishes_') || groupId.startsWith('tower_drinks_');

          optionIds.forEach((optionId) => {
            let beecommOptionDishId = optionId;
            let optionMapping = null;
            let isDish = false;
            let isVariable = false;
            let kitchenName = '';

            if (dishMapping && dishMapping.groupMappings) {
              const groupMapping = dishMapping.groupMappings.find((gm) => gm.groupId === groupId);
              if (groupMapping && groupMapping.optionMappings) {
                optionMapping = groupMapping.optionMappings.find((om) => om.optionId === optionId);
                if (optionMapping) {
                  beecommOptionDishId = optionMapping.dishId || optionId;
                  kitchenName = optionMapping.kitchenName || optionId;
                  isDish = optionMapping.isDish || false;
                  isVariable = optionMapping.isVariable || false;
                }
              }
            }

            const shouldBeSeparateItem = isSideDishOrDrinkGroup || (isDish && !isVariable);

            if (shouldBeSeparateItem) {
              let dishPrice = 0;
              let dishName = kitchenName || optionId;

              const optionPrice = findOptionPriceFromConfig(optionId, groupId, mealOptionsConfig, cartItem.id);
              if (optionPrice !== null) {
                dishPrice = optionPrice;
              } else {
                const dishInfo = findDishInfo(beecommOptionDishId, beecommMenu);
                if (dishInfo) {
                  dishPrice = dishInfo.price;
                  dishName = dishInfo.kitchenName || dishInfo.name;
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
              const toppingInfo = findToppingInfo(beecommOptionDishId, beecommMenu);
              if (toppingInfo) {
                toppings.push({
                  toppingId: toppingInfo.toppingId,
                  toppingName: toppingInfo.toppingName,
                  additionalCost: toppingInfo.additionalCost,
                  quantity: 1,
                });
              } else {
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

    // Create main dish item
    const basePrice = cartItem.basePrice || 0;
    const mainDishItem = {
      dishId: beecommDishId,
      itemName: cartItem.name || cartItem.id,
      isCombo: false,
      quantity: cartItem.quantity || 1,
      dishPrice: basePrice,
      totalPrice: basePrice * (cartItem.quantity || 1),
      preparationComments: '',
      remarks: [],
      toppings: toppings,
      subItems: [],
    };

    allItems.push(mainDishItem);
    allItems.push(...separateItems);
  });

  const items = allItems;

  // Calculate original total from items (before discount)
  const originalTotal = items.reduce((sum, item) => {
    const itemTotal = (item.dishPrice || 0) * (item.quantity || 1);
    const toppingsTotal = (item.toppings || []).reduce((tSum, topping) => {
      return tSum + (topping.additionalCost || 0) * (topping.quantity || 1);
    }, 0);
    return sum + itemTotal + toppingsTotal;
  }, 0);

  // Calculate discount based on coupon type
  const couponType = coupon.type || '';
  const discountAmount = calculateDiscountByType(couponType, originalTotal);
  const finalTotal = Math.max(0, originalTotal - discountAmount);

  // Prepare order data for beecomm (matching structure from beecomm.js)
  const orderData = {
    menuRevision: requestOrderData?.menuRevision || '',
    customerFirstName: locationData.name?.split(' ')[0] || '',
    customerLastName: locationData.name?.split(' ').slice(1).join(' ') || '',
    phoneNumber: locationData.phone || '',
    emailAddress: '',
    items: items,
    deliveryInfo: {
      firstName: locationData.name?.split(' ')[0] || '',
      lastName: locationData.name?.split(' ').slice(1).join(' ') || '',
      phoneNumber: locationData.phone || '',
      cellular: locationData.phone || '',
      building: locationData.building || '',
      floor: locationData.floor || '',
      companyName: locationData.office || '',
      cityName: 'BSR - Petch Tikva',
      streetName: 'building',
      homeNumber: locationData.building || '',
      formattedAddress: `Building: ${locationData.building}, ${locationData.floor}, ${locationData.office}, BSR Petch Tikva`,
      deliveryCost: 0,
    },
    comments: `Coupon order: ${couponCode.trim()} (Type: ${couponType})`,
    locationData: locationData,
    cartItems: cartItems,
    couponCode: couponCode.trim(),
    couponType: couponType,
    originalTotal: originalTotal,
    discountAmount: discountAmount,
    finalTotal: finalTotal,
  };

  // Insert order into database first
  const customerName = locationData?.name || null;
  const phone = locationData?.phone || null;

  const orderDataJson = {
    ...orderData,
    cartItems: cartItems,
    locationData: locationData,
    menuRevision: requestOrderData?.menuRevision || '',
    total: finalTotal, // Store final total after discount
    originalTotal: originalTotal, // Store original total
    discountAmount: discountAmount, // Store discount amount
    orderId: `${orderId}`,
    couponCode: couponCode.trim(),
    couponType: couponType,
  };

  const insertQuery = `
    INSERT INTO orders (orderId, total, currency, language, customer_name, phone, orderData, status)
    VALUES (:orderId, :total, :currency, :language, :customer_name, :phone, :orderData, :status)
    ON DUPLICATE KEY UPDATE
      total = VALUES(total),
      currency = VALUES(currency),
      language = VALUES(language),
      customer_name = VALUES(customer_name),
      phone = VALUES(phone),
      orderData = VALUES(orderData),
      updated_at = CURRENT_TIMESTAMP
  `;

  const insertParams = {
    orderId: `${orderId}`,
    total: finalTotal, // Store final total after discount
    currency: '1',
    language: 'HE',
    customer_name: customerName,
    phone: phone,
    orderData: JSON.stringify(orderDataJson),
    status: 'open',
  };

  await executeSql(insertQuery, insertParams);
  console.log('[coupons] Order inserted into database:', orderId, {
    originalTotal,
    discountAmount,
    finalTotal,
    couponType,
  });

  // Structure order for Beecomm with coupon type for discount calculation
  const beecommOrder = structureOrderForBeecommWithCoupon(orderData, couponType);

  console.log('[coupons] beecommOrder to push:', JSON.stringify(beecommOrder, null, 2));

  // Push order to Beecomm
  const pushOrdersEnabled = BEECOMM_PUSH_ORDERS.toLowerCase() === 'true';

  if (!pushOrdersEnabled) {
    console.log('[coupons] Order push to Beecomm is disabled. Skipping order push.');
    // Mark coupon as used even if push is disabled
    await executeSql(
      'UPDATE coupons SET used_at = CURRENT_TIMESTAMP WHERE coupon_id = :coupon_id',
      { coupon_id: coupon.coupon_id }
    );
    return { orderNumber: null, skipped: true };
  }

  // Get access token and push order
  const accessToken = await getAccessToken();
  const result = await pushOrder(accessToken, beecommOrder);

  if (!result.result) {
    console.error('[coupons] pushOrder failed:', result);
    throw new Error(result.message || 'Failed to push order to Beecomm');
  }

  console.log('[coupons] Order pushed successfully:', result.orderNumber);

  // Mark coupon as used
  await executeSql(
    'UPDATE coupons SET used_at = CURRENT_TIMESTAMP WHERE coupon_id = :coupon_id',
    { coupon_id: coupon.coupon_id }
  );
  console.log('[coupons] Coupon marked as used:', couponCode);

  // Update order in database with beecom orderNumber
  if (result.orderNumber) {
    try {
      const getOrderQuery = `SELECT orderData FROM orders WHERE orderId = :orderId`;
      const getOrderResult = await executeSql(getOrderQuery, { orderId: `${orderId}` });

      if (getOrderResult && getOrderResult[0] && getOrderResult[0].length > 0) {
        const currentOrderData = getOrderResult[0][0].orderData;
        let orderDataObj = typeof currentOrderData === 'string' ? JSON.parse(currentOrderData) : currentOrderData;

        orderDataObj.beecomOrderNumber = result.orderNumber;

        const updateQuery = `
          UPDATE orders 
          SET orderData = :orderData, updated_at = CURRENT_TIMESTAMP
          WHERE orderId = :orderId
        `;
        await executeSql(updateQuery, {
          orderId: `${orderId}`,
          orderData: JSON.stringify(orderDataObj),
        });
        console.log('[coupons] Updated order with beecom orderNumber:', result.orderNumber);
      }
    } catch (updateError) {
      console.error('[coupons] Error updating order with beecom orderNumber:', updateError);
    }
  }

  return { orderNumber: result.orderNumber, skipped: false };
}

/**
 * Legacy endpoint - kept for backward compatibility
 * New flow should use /check endpoint instead
 */
router.post('/placeorder', express.json(), async (req, res) => {
  console.log('[coupons] Coupon placeorder received (legacy endpoint):', req.body);

  try {
    const {
      orderId,
      couponCode,
      orderData: requestOrderData,
    } = req.body || {};

    if (!orderId || !couponCode || !requestOrderData) {
      return res.status(400).json({
        error: 'orderId, couponCode, and orderData are required',
      });
    }

    // Validate coupon
    const validateQuery = `
      SELECT coupon_id, name, type, created_at, expired_at, used_at, cancelled_at
      FROM coupons
      WHERE name = :code
      LIMIT 1
    `;

    const [couponRows] = await executeSql(validateQuery, { code: couponCode.trim() });

    if (!couponRows || couponRows.length === 0) {
      return res.status(400).json({
        error: 'Coupon not found',
      });
    }

    const coupon = couponRows[0];

    // Check if cancelled
    if (coupon.cancelled_at) {
      return res.status(400).json({
        error: 'Coupon has been cancelled',
      });
    }

    // Check if already used
    if (coupon.used_at) {
      return res.status(400).json({
        error: 'Coupon has already been used',
      });
    }

    // Check if expired
    if (coupon.expired_at) {
      const expiredDate = new Date(coupon.expired_at);
      const now = new Date();
      if (expiredDate < now) {
        return res.status(400).json({
          error: 'Coupon has expired',
        });
      }
    }

    // Process order using shared function
    const result = await processCouponOrder(orderId, couponCode.trim(), coupon, requestOrderData);

    return res.status(200).json({
      success: true,
      orderNumber: result.orderNumber,
      message: result.skipped ? 'Order push to Beecomm is disabled' : 'Order processed successfully',
    });
  } catch (error) {
    console.error('[coupons] Error processing coupon order:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

export default router;
