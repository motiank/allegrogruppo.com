/**
 * Order System State Management
 * Manages the state of the order system (active, shutdown, suspend)
 * and provides secure communication with admin service
 */

// Order system states
export const ORDER_STATE = {
  ACTIVE: 'active',
  SHUTDOWN: 'shutdown',
  PAUSE: 'pause',
  SUSPEND: 'suspend'
};

// In-memory state storage
let currentState = {
  state: ORDER_STATE.ACTIVE,
  suspendedUntil: null, // ISO timestamp when pause state should end (for pause only)
  lastUpdated: new Date().toISOString(),
  lastUpdatedBy: null, // Admin user who made the change
  manuallySet: false // Track if state was manually set (should not be overridden by auto-activation for shutdown/suspend)
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
  //  console.log(`[orderState] getIsraelTime: ${now}`);
  const parts = formatter.formatToParts(now);
  const year = parseInt(parts.find(p => p.type === 'year').value);
  const month = parseInt(parts.find(p => p.type === 'month').value) - 1; // Month is 0-indexed
  const day = parseInt(parts.find(p => p.type === 'day').value);
  let hour = parseInt(parts.find(p => p.type === 'hour').value);
  const minute = parseInt(parts.find(p => p.type === 'minute').value);
  const second = parseInt(parts.find(p => p.type === 'second').value);

  hour = hour > 23 ? 0 : hour;
  
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
 * Determine if current time is before opening hours or after closing hours
 * @returns {string|null} 'before_hours', 'after_hours', or null if within hours
 */
export function getTimeStatus() {
  const startTime = parseTime(START_TIME);
  const endTime = parseTime(END_TIME);
  
  if (!startTime || !endTime) {
    return null;
  }
  
  const israelNow = getIsraelTime();
  const currentTimeMinutes = israelNow.hours * 60 + israelNow.minutes;
  const startTimeMinutes = startTime.hours * 60 + startTime.minutes;
  const endTimeMinutes = endTime.hours * 60 + endTime.minutes;
  
  // Handle case where end time is after midnight (e.g., 23:00 to 02:00)
  if (endTimeMinutes < startTimeMinutes) {
    // Window spans midnight
    if (currentTimeMinutes > endTimeMinutes && currentTimeMinutes < startTimeMinutes) {
      return 'after_hours';
    }
    // Otherwise within hours
    return null;
  } else {
    // Normal window within same day
    if (currentTimeMinutes < startTimeMinutes) {
      return 'before_hours';
    } else if (currentTimeMinutes >= endTimeMinutes) {
      return 'after_hours';
    }
    // Otherwise within hours
    return null;
  }
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
  // Check if pause state has expired
  if (currentState.state === ORDER_STATE.PAUSE && currentState.suspendedUntil) {
    const now = new Date();
    const suspendedUntil = new Date(currentState.suspendedUntil);

    if (now >= suspendedUntil) {
      if (currentState.manuallySet) {
        // Manually set pause expired - clear manual flag and allow time-based behavior
        currentState = {
          ...currentState,
          manuallySet: false,
          lastUpdated: new Date().toISOString(),
          lastUpdatedBy: 'manual-pause-expired'
        };
        console.log('[orderState] Manually set pause expired, clearing manuallySet flag - time-based activation will determine next state');
      } else {
        // System pause expired - time-based behavior will fill in below
        console.log('[orderState] System pause expired, time-based activation will determine next state');
      }
    }
  }

  // Check if we're within active hours (used for controls enabled status)
  const withinActiveHours = isWithinActiveHours();

  const isManualPause = currentState.manuallySet && currentState.state === ORDER_STATE.PAUSE && currentState.suspendedUntil;
  const isManualSuspend = currentState.manuallySet && currentState.state === ORDER_STATE.SUSPEND;
  const isManualShutdown = currentState.manuallySet && currentState.state === ORDER_STATE.SHUTDOWN;

  // If state is manually locked to shutdown or suspend, keep it as-is
  if (!isManualShutdown && !isManualSuspend) {
    // Manual pause or time-based pause (with expired check above)
    if (!isManualPause) {
      if (withinActiveHours) {
        if (currentState.state !== ORDER_STATE.ACTIVE) {
          currentState = {
            ...currentState,
            state: ORDER_STATE.ACTIVE,
            suspendedUntil: null,
            manuallySet: false,
            lastUpdated: new Date().toISOString(),
            lastUpdatedBy: 'system-time-based-activation'
          };
          console.log(`[orderState] Time-based activation: within active hours (${START_TIME}-${END_TIME} Israel time), setting to ACTIVE`);
        }
      } else {
        if (currentState.state !== ORDER_STATE.SHUTDOWN && currentState.state !== ORDER_STATE.SUSPEND) {
          const israelNow = getIsraelTime();
          const startTime = parseTime(START_TIME);
          if (startTime) {
            const currentTimeMinutes = israelNow.hours * 60 + israelNow.minutes;
            const startTimeMinutes = startTime.hours * 60 + startTime.minutes;

            let minutesUntilStart;
            if (currentTimeMinutes < startTimeMinutes) {
              minutesUntilStart = startTimeMinutes - currentTimeMinutes;
            } else {
              minutesUntilStart = (24 * 60 - currentTimeMinutes) + startTimeMinutes;
            }

            const nextActiveTime = new Date(Date.now() + minutesUntilStart * 60 * 1000);

            const wasPaused = currentState.state === ORDER_STATE.PAUSE;
            currentState = {
              ...currentState,
              state: ORDER_STATE.PAUSE,
              suspendedUntil: nextActiveTime.toISOString(),
              manuallySet: false,
              lastUpdated: new Date().toISOString(),
              lastUpdatedBy: wasPaused ? 'system-time-based-update' : 'system-time-based-deactivation'
            };

            if (!wasPaused) {
              console.log(`[orderState] Time-based deactivation: outside active hours (${START_TIME}-${END_TIME} Israel time), setting to PAUSE until ${nextActiveTime.toISOString()}`);
            }
          }
        }
      }
    }
  }

  // Return state with controlsEnabled field
  // Controls are enabled when system is paused or manually overridden; otherwise depend on active hours
  const controlsEnabled =
    currentState.state === ORDER_STATE.PAUSE ||
    currentState.manuallySet ||
    withinActiveHours;

  return {
    ...currentState,
    controlsEnabled,
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
 * Format minutes as HH:MM
 * @param {number} minutes - Total minutes
 * @returns {string} Formatted time as HH:MM
 */
function formatTimeRemaining(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
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
        title: 'סיימנו להיום',
        message: 'מחר ב־{START_TIME} חוזרים\nעם אוכל מצוין ומחירים מפתיעים.'
      },
      suspend: {
        title: 'המטבח עובד במלוא הקצב 🔥',
        message: 'כרגע לא יכולים לקבל הזמנות נוספות.'
      },
      preOpening: {
        title: '☀️ בוקר טוב!',
        message: 'המערכת סגורה כרגע, אנחנו בהכנות אחרונות.'
      },
      afterClosing: {
        title: 'סיימנו להיום',
        message: 'מחר ב־{START_TIME} חוזרים\nעם אוכל מצוין ומחירים מפתיעים.'
      },
      active: {
        title: '',
        message: ''
      }
    },
    en: {
      shutdown: {
        title: 'We finished for today',
        message: 'Tomorrow at {START_TIME} we\'re back\nwith excellent food and surprising prices.'
      },
      suspend: {
        title: 'Orders Temporarily Suspended',
        message: 'The ordering system has been temporarily suspended. Please try again in a few minutes.'
      },
      preOpening: {
        title: '☀️ Good morning!',
        message: 'The system is currently closed, we\'re doing final preparations.'
      },
      afterClosing: {
        title: 'We finished for today',
        message: 'Tomorrow at {START_TIME} we\'re back\nwith excellent food and surprising prices.'
      },
      active: {
        title: '',
        message: ''
      }
    },
    ar: {
      shutdown: {
        title: 'انتهينا لهذا اليوم',
        message: 'غداً في {START_TIME} نعود\nمع طعام ممتاز وأسعار مفاجئة.'
      },
      suspend: {
        title: 'الطلبات معطلة مؤقتاً',
        message: 'تم تعليق نظام الطلبات مؤقتاً. يرجى المحاولة مرة أخرى بعد بضع دقائق.'
      },
      preOpening: {
        title: '☀️ صباح الخير!',
        message: 'النظام مغلق حالياً، نحن في التحضيرات النهائية.'
      },
      afterClosing: {
        title: 'انتهينا لهذا اليوم',
        message: 'غداً في {START_TIME} نعود\nمع طعام ممتاز وأسعار مفاجئة.'
      },
      active: {
        title: '',
        message: ''
      }
    },
    ru: {
      shutdown: {
        title: 'Мы закончили на сегодня',
        message: 'Завтра в {START_TIME} возвращаемся\nс отличной едой и удивительными ценами.'
      },
      suspend: {
        title: 'Заказы временно приостановлены',
        message: 'Система заказов временно приостановлена. Пожалуйста, попробуйте через несколько минут.'
      },
      preOpening: {
        title: '☀️ Доброе утро!',
        message: 'Система в настоящее время закрыта, мы делаем последние приготовления.'
      },
      afterClosing: {
        title: 'Мы закончили на сегодня',
        message: 'Завтра в {START_TIME} возвращаемся\nс отличной едой и удивительными ценами.'
      },
      active: {
        title: '',
        message: ''
      }
    }
  };
  
  const langMessages = messages[language] || messages.he;
  
  if (state.state === ORDER_STATE.SHUTDOWN) {
    // Use the same message as after closing
    if (language === 'he') {
      const messageText = langMessages.shutdown.message.replace('{START_TIME}', START_TIME);
      return {
        title: langMessages.shutdown.title,
        message: `<pre>${messageText}</pre>`
      };
    } else if (language === 'en') {
      const messageText = langMessages.shutdown.message.replace('{START_TIME}', START_TIME);
      return {
        title: langMessages.shutdown.title,
        message: `<pre>${messageText}</pre>`
      };
    } else if (language === 'ar') {
      const messageText = langMessages.shutdown.message.replace('{START_TIME}', START_TIME);
      return {
        title: langMessages.shutdown.title,
        message: `<pre>${messageText}</pre>`
      };
    } else if (language === 'ru') {
      const messageText = langMessages.shutdown.message.replace('{START_TIME}', START_TIME);
      return {
        title: langMessages.shutdown.title,
        message: `<pre>${messageText}</pre>`
      };
    }
    // Fallback
    const messageText = langMessages.shutdown.message.replace('{START_TIME}', START_TIME);
    return {
      title: langMessages.shutdown.title,
      message: `<pre>${messageText}</pre>`
    };
  } else if (state.state === ORDER_STATE.PAUSE || state.state === ORDER_STATE.SUSPEND) {
    const israelNow = getIsraelTime();
    const startTime = parseTime(START_TIME);
    const endTime = parseTime(END_TIME);

    let minutesUntilStart = 0;
    if (state.suspendedUntil) {
      const now = new Date();
      const until = new Date(state.suspendedUntil);
      minutesUntilStart = Math.ceil((until - now) / (1000 * 60));
    }

    let isPreOpening = false;
    if (startTime && endTime) {
      const currentTimeMinutes = israelNow.hours * 60 + israelNow.minutes;
      const startTimeMinutes = startTime.hours * 60 + startTime.minutes;
      const endTimeMinutes = endTime.hours * 60 + endTime.minutes;

      if (endTimeMinutes < startTimeMinutes) {
        if (currentTimeMinutes > endTimeMinutes && currentTimeMinutes < startTimeMinutes) {
          isPreOpening = true;
        }
      } else {
        if (currentTimeMinutes < startTimeMinutes) {
          isPreOpening = true;
        }
      }
    }

    if (isPreOpening && minutesUntilStart > 0 && state.state === ORDER_STATE.PAUSE) {
      const timeStr = formatTimeRemaining(minutesUntilStart);
      if (language === 'he') {
        return {
          title: langMessages.preOpening.title,
          message: `<pre>${langMessages.preOpening.message}\nנפתח בעוד ${timeStr} כדאי לחזור!</pre>`
        };
      } else if (language === 'en') {
        return {
          title: langMessages.preOpening.title,
          message: `<pre>${langMessages.preOpening.message}\nWill open in ${timeStr}, worth coming back!</pre>`
        };
      } else if (language === 'ar') {
        return {
          title: langMessages.preOpening.title,
          message: `<pre>${langMessages.preOpening.message}\nسيفتح خلال ${timeStr}، يستحق العودة!</pre>`
        };
      } else if (language === 'ru') {
        return {
          title: langMessages.preOpening.title,
          message: `<pre>${langMessages.preOpening.message}\nОткроется через ${timeStr}, стоит вернуться!</pre>`
        };
      }
    }

    let message = '';
    let title = '';

    if (state.state === ORDER_STATE.PAUSE) {
      title = langMessages.suspend.title;
      message = langMessages.suspend.message;

      if (state.suspendedUntil && minutesUntilStart > 0) {
        if (language === 'he') {
          message = `<pre>${langMessages.suspend.message}\nתנו לנו עוד ${minutesUntilStart} דקות — שווה לחזור.</pre>`;
        } else if (language === 'en') {
          message = `<pre>The kitchen is working at full speed 🔥\nCurrently cannot accept additional orders.\nGive us ${minutesUntilStart} more minutes — worth coming back.</pre>`;
        } else if (language === 'ar') {
          message = `<pre>المطبخ يعمل بكامل طاقته 🔥\nحالياً لا يمكننا قبول طلبات إضافية.\nامنحونا ${minutesUntilStart} دقائق أخرى — يستحق العودة.</pre>`;
        } else if (language === 'ru') {
          message = `<pre>Кухня работает на полную мощность 🔥\nВ настоящее время не можем принимать дополнительные заказы.\nДайте нам еще ${minutesUntilStart} минут — стоит вернуться.</pre>`;
        }
      } else {
        message = `<pre>${message}</pre>`;
      }
    } else {
      // Manual suspend (indefinite)
      title = language === 'he' ? 'המערכת בהשהיה' : language === 'ar' ? 'النظام معطل' : language === 'ru' ? 'Система приостановлена' : 'System Suspended';
      message = language === 'he'
        ? '<pre>המערכת מושבתת עד שינוי ידני של סטטוס.</pre>'
        : language === 'ar'
          ? '<pre>النظام معطل حتى שינוי يدوي للحالة.</pre>'
          : language === 'ru'
            ? '<pre>Система приостановлена до ручного изменения состояния.</pre>'
            : '<pre>The system is suspended until manually changed.</pre>';
    }

    return { title, message };
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

  // Check if we're within active hours - manual updates are typically only allowed during active hours
  // but allow updates when system is in pause/suspend/shutdown to enable admin override.
  const withinActiveHours = isWithinActiveHours();
  const allowManualUpdate =
    withinActiveHours ||
    currentState.state === ORDER_STATE.PAUSE ||
    currentState.state === ORDER_STATE.SUSPEND ||
    currentState.state === ORDER_STATE.SHUTDOWN;

  if (!allowManualUpdate) {
    return {
      success: false,
      error: `Manual state changes are not allowed outside active hours (${START_TIME}-${END_TIME} Israel time), except when system is in manual pause/suspend/shutdown state.`
    };
  }

  const now = new Date();
  let suspendedUntil = null;
  let manuallySet = false;

  switch (newState) {
    case ORDER_STATE.ACTIVE:
      manuallySet = false;
      suspendedUntil = null;
      break;
    case ORDER_STATE.SHUTDOWN:
      manuallySet = true;
      suspendedUntil = null;
      break;
    case ORDER_STATE.PAUSE:
      manuallySet = true;
      suspendedUntil = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
      break;
    case ORDER_STATE.SUSPEND:
      manuallySet = true;
      suspendedUntil = null; // indefinite until manual change
      break;
    default:
      manuallySet = false;
      suspendedUntil = null;
  }

  currentState = {
    state: newState,
    suspendedUntil,
    lastUpdated: now.toISOString(),
    lastUpdatedBy: updatedBy,
    manuallySet
  };

  console.log(`[orderState] State updated to ${newState} by ${updatedBy}`, {
    state: newState,
    suspendedUntil,
    lastUpdated: currentState.lastUpdated,
    manuallySet
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

