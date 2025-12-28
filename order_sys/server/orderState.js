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
  lastUpdatedBy: null, // Admin user who made the change
  manuallySet: false // Track if state was manually set (should not be overridden by auto-activation)
};

// Get shared secret from environment
const SHARED_SECRET = process.env.ORDER_SYSTEM_SECRET || process.env.ADMIN_SECRET || 'change-me-in-production';

// Time-based activation configuration
const DEFAULT_START_TIME = '11:00'; // Default start time in HH:MM format
const DEFAULT_END_TIME = '15:00';   // Default end time in HH:MM format
const START_TIME = process.env.OS_IL_START_TIME || DEFAULT_START_TIME;
const END_TIME = process.env.OS_IL_END_TIME || DEFAULT_END_TIME;
const ISRAEL_TIMEZONE = 'Asia/Jerusalem';

/**
 * Parse time string in HH:MM format to hours and minutes
 * @param {string} timeStr - Time string in HH:MM format
 * @returns {Object|null} Object with hours and minutes, or null if invalid
 */
function parseTime(timeStr) {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    console.warn(`[orderState] Invalid time format: ${timeStr}. Expected HH:MM format.`);
    return null;
  }
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    console.warn(`[orderState] Invalid time values: ${timeStr}. Hours must be 0-23, minutes 0-59.`);
    return null;
  }
  
  return { hours, minutes };
}

/**
 * Get current time in Israel timezone
 * @returns {Object} Object with hours, minutes, and a Date object for Israel time
 */
function getIsraelTime() {
  const now = new Date();
  // Get time components in Israel timezone using Intl API
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: ISRAEL_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  const parts = formatter.formatToParts(now);
  const year = parseInt(parts.find(p => p.type === 'year').value);
  const month = parseInt(parts.find(p => p.type === 'month').value) - 1; // Month is 0-indexed
  const day = parseInt(parts.find(p => p.type === 'day').value);
  const hour = parseInt(parts.find(p => p.type === 'hour').value);
  const minute = parseInt(parts.find(p => p.type === 'minute').value);
  const second = parseInt(parts.find(p => p.type === 'second').value);
  
  // Return both the components and a Date object
  // The Date object is created in local time but represents the Israel time values
  return {
    hours: hour,
    minutes: minute,
    seconds: second,
    date: new Date(year, month, day, hour, minute, second)
  };
}

/**
 * Check if current time is within the active time window (Israel time)
 * @returns {boolean} True if current time is within active hours
 */
function isWithinActiveHours() {
  const startTime = parseTime(START_TIME);
  const endTime = parseTime(END_TIME);
  
  if (!startTime || !endTime) {
    console.warn(`[orderState] Invalid time configuration. Using defaults: ${DEFAULT_START_TIME}-${DEFAULT_END_TIME}`);
    // Fallback to default times
    const defaultStart = parseTime(DEFAULT_START_TIME);
    const defaultEnd = parseTime(DEFAULT_END_TIME);
    if (!defaultStart || !defaultEnd) {
      // If even defaults fail, default to always active
      return true;
    }
    return checkTimeWindow(defaultStart, defaultEnd);
  }
  
  return checkTimeWindow(startTime, endTime);
}

/**
 * Check if current Israel time is within the specified time window
 * @param {Object} startTime - Start time {hours, minutes}
 * @param {Object} endTime - End time {hours, minutes}
 * @returns {boolean} True if within window
 */
function checkTimeWindow(startTime, endTime) {
  const israelNow = getIsraelTime();
  const currentHours = israelNow.hours;
  const currentMinutes = israelNow.minutes;
  const currentTimeMinutes = currentHours * 60 + currentMinutes;
  const startTimeMinutes = startTime.hours * 60 + startTime.minutes;
  const endTimeMinutes = endTime.hours * 60 + endTime.minutes;
  
  // Handle case where end time is after midnight (e.g., 23:00 to 02:00)
  if (endTimeMinutes < startTimeMinutes) {
    // Window spans midnight
    return currentTimeMinutes >= startTimeMinutes || currentTimeMinutes <= endTimeMinutes;
  } else {
    // Normal window within same day
    return currentTimeMinutes >= startTimeMinutes && currentTimeMinutes < endTimeMinutes;
  }
}

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
 * @returns {Object} Current state object with controlsEnabled field
 */
export function getState() {
  // Check if suspend state has expired
  if (currentState.state === ORDER_STATE.SUSPEND && currentState.suspendedUntil) {
    const now = new Date();
    const suspendedUntil = new Date(currentState.suspendedUntil);
    
    if (now >= suspendedUntil) {
      // Auto-resume to active state (if within active hours and not manually shutdown)
      if (!currentState.manuallySet || currentState.state === ORDER_STATE.ACTIVE) {
        currentState = {
          ...currentState,
          state: ORDER_STATE.ACTIVE,
          suspendedUntil: null,
          lastUpdated: new Date().toISOString(),
          lastUpdatedBy: 'system-auto-resume'
        };
        console.log('[orderState] Suspend state expired, auto-resuming to active');
      }
    }
  }
  
  // Check if we're within active hours (used for controls enabled status)
  const withinActiveHours = isWithinActiveHours();
  
  // Apply time-based activation (only if not manually set to SHUTDOWN)
  // If manually set to SHUTDOWN, respect that override
  if (!currentState.manuallySet || currentState.state !== ORDER_STATE.SHUTDOWN) {
    if (withinActiveHours) {
      // Within active hours - ensure state is ACTIVE (unless manually shutdown)
      if (currentState.state !== ORDER_STATE.ACTIVE && currentState.state !== ORDER_STATE.SHUTDOWN) {
        currentState = {
          ...currentState,
          state: ORDER_STATE.ACTIVE,
          suspendedUntil: null,
          lastUpdated: new Date().toISOString(),
          lastUpdatedBy: 'system-time-based-activation'
        };
        console.log(`[orderState] Time-based activation: within active hours (${START_TIME}-${END_TIME} Israel time), setting to ACTIVE`);
      }
    } else {
      // Outside active hours - set to SUSPEND (unless manually shutdown)
      if (currentState.state !== ORDER_STATE.SHUTDOWN) {
        const israelNow = getIsraelTime();
        // Calculate time until start time next
        const startTime = parseTime(START_TIME);
        if (startTime) {
          // Calculate minutes until next start time
          const currentTimeMinutes = israelNow.hours * 60 + israelNow.minutes;
          const startTimeMinutes = startTime.hours * 60 + startTime.minutes;
          
          let minutesUntilStart;
          if (currentTimeMinutes < startTimeMinutes) {
            // Start time is later today
            minutesUntilStart = startTimeMinutes - currentTimeMinutes;
          } else {
            // Start time is tomorrow
            minutesUntilStart = (24 * 60 - currentTimeMinutes) + startTimeMinutes;
          }
          
          // Calculate the next active time in UTC
          const nextActiveTime = new Date(Date.now() + minutesUntilStart * 60 * 1000);
          
          // Update state to SUSPEND if not already, or update suspendedUntil if already suspended
          const wasSuspended = currentState.state === ORDER_STATE.SUSPEND;
          
          currentState = {
            ...currentState,
            state: ORDER_STATE.SUSPEND,
            suspendedUntil: nextActiveTime.toISOString(),
            lastUpdated: new Date().toISOString(),
            lastUpdatedBy: wasSuspended ? 'system-time-based-update' : 'system-time-based-deactivation'
          };
          
          if (!wasSuspended) {
            console.log(`[orderState] Time-based deactivation: outside active hours (${START_TIME}-${END_TIME} Israel time), setting to SUSPEND until ${nextActiveTime.toISOString()}`);
          }
        }
      }
    }
  }
  
  // Return state with controlsEnabled field
  // Controls are only enabled during active hours
  return { 
    ...currentState,
    controlsEnabled: withinActiveHours,
    activeHours: {
      start: START_TIME,
      end: END_TIME
    }
  };
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
  
  // Check if we're within active hours - manual updates are only allowed during active hours
  const withinActiveHours = isWithinActiveHours();
  if (!withinActiveHours) {
    return {
      success: false,
      error: `Manual state changes are not allowed outside active hours (${START_TIME}-${END_TIME} Israel time). The system will automatically activate during active hours.`
    };
  }
  
  // Update state
  const now = new Date();
  let suspendedUntil = null;
  
  // Mark as manually set if state is SHUTDOWN (SHUTDOWN always overrides time-based activation)
  // Setting to ACTIVE manually allows time-based activation to take over again
  // Setting to SUSPEND manually allows time-based activation to take over again after the suspend expires
  const manuallySet = newState === ORDER_STATE.SHUTDOWN;
  
  if (newState === ORDER_STATE.SUSPEND) {
    // Set suspended until 15 minutes from now (unless within time-based window)
    if (withinActiveHours) {
      // If within active hours but manually suspending, use 15 minutes
      suspendedUntil = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
    } else {
      // Outside active hours, calculate until next start time
      const startTime = parseTime(START_TIME);
      if (startTime) {
        const israelNow = getIsraelTime();
        const currentTimeMinutes = israelNow.hours * 60 + israelNow.minutes;
        const startTimeMinutes = startTime.hours * 60 + startTime.minutes;
        
        // Calculate minutes until next start time
        let minutesUntilStart;
        if (currentTimeMinutes < startTimeMinutes) {
          // Start time is later today
          minutesUntilStart = startTimeMinutes - currentTimeMinutes;
        } else {
          // Start time is tomorrow
          minutesUntilStart = (24 * 60 - currentTimeMinutes) + startTimeMinutes;
        }
        
        // Calculate the next active time in UTC
        const nextActiveTime = new Date(Date.now() + minutesUntilStart * 60 * 1000);
        suspendedUntil = nextActiveTime.toISOString();
      } else {
        // Fallback to 15 minutes
        suspendedUntil = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
      }
    }
  }
  
  currentState = {
    state: newState,
    suspendedUntil: suspendedUntil,
    lastUpdated: now.toISOString(),
    lastUpdatedBy: updatedBy,
    manuallySet: manuallySet
  };
  
  console.log(`[orderState] State updated to ${newState} by ${updatedBy}`, {
    state: newState,
    suspendedUntil: suspendedUntil,
    lastUpdated: currentState.lastUpdated,
    manuallySet: manuallySet
  });
  
  // Get updated state with controlsEnabled field
  const updatedState = getState();
  
  return {
    success: true,
    state: updatedState
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

