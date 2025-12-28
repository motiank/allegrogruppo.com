/**
 * Order System State Management
 * Manages the state of the order system (active, shutdown, suspend)
 * and provides secure communication with admin service
 */

// Order system states
export const ORDER_STATE = {
  ACTIVE: 'active',
  SHUTDOWN: 'shutdown',
  SUSPEND: 'suspend'
};

// In-memory state storage
let currentState = {
  state: ORDER_STATE.ACTIVE,
  suspendedUntil: null, // ISO timestamp when suspend state should end
  lastUpdated: new Date().toISOString(),
  lastUpdatedBy: null // Admin user who made the change
};

// Get shared secret from environment
const SHARED_SECRET = process.env.ORDER_SYSTEM_SECRET || process.env.ADMIN_SECRET || 'change-me-in-production';

/**
 * Verify authentication token from admin service
 * @param {string} token - Authentication token
 * @returns {boolean} - True if token is valid
 */
export function verifyAuthToken(token) {
  if (!token) {
    return false;
  }
  
  // Simple token-based auth - in production, consider using JWT or more secure method
  return token === SHARED_SECRET;
}

/**
 * Get current order system state
 * @returns {Object} Current state object
 */
export function getState() {
  // Check if suspend state has expired
  if (currentState.state === ORDER_STATE.SUSPEND && currentState.suspendedUntil) {
    const now = new Date();
    const suspendedUntil = new Date(currentState.suspendedUntil);
    
    if (now >= suspendedUntil) {
      // Auto-resume to active state
      currentState = {
        state: ORDER_STATE.ACTIVE,
        suspendedUntil: null,
        lastUpdated: new Date().toISOString(),
        lastUpdatedBy: 'system-auto-resume'
      };
      console.log('[orderState] Suspend state expired, auto-resuming to active');
    }
  }
  
  return { ...currentState };
}

/**
 * Check if orders are currently enabled
 * @returns {boolean} - True if orders can be placed
 */
export function areOrdersEnabled() {
  const state = getState();
  return state.state === ORDER_STATE.ACTIVE;
}

/**
 * Get status message for customers based on current state
 * @param {string} language - Language code (he, en, ar, ru)
 * @returns {Object} Status message object with title and message
 */
export function getStatusMessage(language = 'he') {
  const state = getState();
  
  const messages = {
    he: {
      shutdown: {
        title: 'הזמנות מושבתות זמנית',
        message: 'מערכת ההזמנות מושבתת כרגע. אנא נסו שוב מאוחר יותר.'
      },
      suspend: {
        title: 'הזמנות מושעות זמנית',
        message: 'מערכת ההזמנות מושעת זמנית. אנא נסו שוב בעוד כמה דקות.'
      },
      active: {
        title: '',
        message: ''
      }
    },
    en: {
      shutdown: {
        title: 'Orders Temporarily Disabled',
        message: 'The ordering system is currently disabled. Please try again later.'
      },
      suspend: {
        title: 'Orders Temporarily Suspended',
        message: 'The ordering system has been temporarily suspended. Please try again in a few minutes.'
      },
      active: {
        title: '',
        message: ''
      }
    },
    ar: {
      shutdown: {
        title: 'الطلبات معطلة مؤقتاً',
        message: 'نظام الطلبات معطل حالياً. يرجى المحاولة مرة أخرى لاحقاً.'
      },
      suspend: {
        title: 'الطلبات معطلة مؤقتاً',
        message: 'تم تعليق نظام الطلبات مؤقتاً. يرجى المحاولة مرة أخرى بعد بضع دقائق.'
      },
      active: {
        title: '',
        message: ''
      }
    },
    ru: {
      shutdown: {
        title: 'Заказы временно отключены',
        message: 'Система заказов в настоящее время отключена. Пожалуйста, попробуйте позже.'
      },
      suspend: {
        title: 'Заказы временно приостановлены',
        message: 'Система заказов временно приостановлена. Пожалуйста, попробуйте через несколько минут.'
      },
      active: {
        title: '',
        message: ''
      }
    }
  };
  
  const langMessages = messages[language] || messages.he;
  
  if (state.state === ORDER_STATE.SHUTDOWN) {
    return langMessages.shutdown;
  } else if (state.state === ORDER_STATE.SUSPEND) {
    // Calculate remaining time if suspended
    let message = langMessages.suspend.message;
    if (state.suspendedUntil) {
      const now = new Date();
      const until = new Date(state.suspendedUntil);
      const minutesLeft = Math.ceil((until - now) / (1000 * 60));
      if (minutesLeft > 0) {
        if (language === 'he') {
          message = `מערכת ההזמנות מושעת זמנית. אנא נסו שוב בעוד ${minutesLeft} דקות.`;
        } else if (language === 'en') {
          message = `The ordering system has been temporarily suspended. Please try again in ${minutesLeft} minutes.`;
        } else if (language === 'ar') {
          message = `تم تعليق نظام الطلبات مؤقتاً. يرجى المحاولة مرة أخرى بعد ${minutesLeft} دقائق.`;
        } else if (language === 'ru') {
          message = `Система заказов временно приостановлена. Пожалуйста, попробуйте через ${minutesLeft} минут.`;
        }
      }
    }
    return {
      title: langMessages.suspend.title,
      message: message
    };
  }
  
  return langMessages.active;
}

/**
 * Update order system state (called by admin service)
 * @param {string} newState - New state (active, shutdown, suspend)
 * @param {string} authToken - Authentication token
 * @param {string} updatedBy - Admin user who made the change
 * @returns {Object} Result object with success status
 */
export function updateState(newState, authToken, updatedBy = 'admin') {
  // Verify authentication
  if (!verifyAuthToken(authToken)) {
    return {
      success: false,
      error: 'Unauthorized: Invalid authentication token'
    };
  }
  
  // Validate state
  if (!Object.values(ORDER_STATE).includes(newState)) {
    return {
      success: false,
      error: `Invalid state. Must be one of: ${Object.values(ORDER_STATE).join(', ')}`
    };
  }
  
  // Update state
  const now = new Date();
  let suspendedUntil = null;
  
  if (newState === ORDER_STATE.SUSPEND) {
    // Set suspended until 15 minutes from now
    suspendedUntil = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  }
  
  currentState = {
    state: newState,
    suspendedUntil: suspendedUntil,
    lastUpdated: now.toISOString(),
    lastUpdatedBy: updatedBy
  };
  
  console.log(`[orderState] State updated to ${newState} by ${updatedBy}`, {
    state: newState,
    suspendedUntil: suspendedUntil,
    lastUpdated: currentState.lastUpdated
  });
  
  return {
    success: true,
    state: { ...currentState }
  };
}

/**
 * Notify admin service about a new order
 * @param {Object} orderData - Order data to send to admin
 * @returns {Promise<boolean>} - True if notification was successful
 */
export async function notifyAdmin(orderData) {
  const adminUrl = process.env.ADMIN_SERVICE_URL || 'http://localhost:3021';
  const notifyEndpoint = `${adminUrl}/admin/orders/notify`;
  
  try {
    const response = await globalThis.fetch(notifyEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SHARED_SECRET}`
      },
      body: JSON.stringify({
        type: 'new_order',
        timestamp: new Date().toISOString(),
        order: orderData
      })
    });
    
    if (response.ok) {
      console.log('[orderState] Successfully notified admin about new order:', orderData.orderId);
      return true;
    } else {
      console.warn('[orderState] Failed to notify admin, status:', response.status);
      return false;
    }
  } catch (error) {
    console.error('[orderState] Error notifying admin:', error.message);
    // Don't throw - notification failure shouldn't block order processing
    return false;
  }
}

