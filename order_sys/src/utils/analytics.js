/**
 * Check if user has consented to cookies/analytics
 * Import from CookieConsent to avoid circular dependency
 */
const hasConsentedToCookies = () => {
  try {
    const consent = localStorage.getItem('eatalia_cookie_consent');
    return consent === 'accepted';
  } catch (error) {
    return false;
  }
};

/**
 * Generate or retrieve a unique user ID
 * Stores the ID in localStorage to persist across page reloads
 * Only works if user has consented to cookies
 * @returns {string} Unique user ID or null if consent not given
 */
export const getUserId = () => {
  // Check consent first
  if (!hasConsentedToCookies()) {
    // Return session-based ID if no consent
    if (!window._analyticsSessionId) {
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 15);
      window._analyticsSessionId = `${timestamp}-${random}`;
    }
    return window._analyticsSessionId;
  }

  const STORAGE_KEY = 'analytics_user_id';
  
  try {
    // Try to get existing user ID from localStorage
    let userId = localStorage.getItem(STORAGE_KEY);
    
    if (!userId) {
      // Generate a new unique user ID
      // Format: timestamp-randomstring
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 15);
      userId = `${timestamp}-${random}`;
      
      // Store it in localStorage (only if consent given)
      localStorage.setItem(STORAGE_KEY, userId);
      console.log('[Analytics] Generated new user ID:', userId);
    }
    
    return userId;
  } catch (error) {
    // If localStorage is not available (e.g., private browsing), generate a session-based ID
    console.warn('[Analytics] localStorage not available, using session-based ID');
    if (!window._analyticsSessionId) {
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 15);
      window._analyticsSessionId = `${timestamp}-${random}`;
    }
    return window._analyticsSessionId;
  }
};

/**
 * Initialize user ID on page load
 * Call this when the page loads to ensure user ID is created early
 * Only creates persistent ID if user has consented
 */
export const initUserId = () => {
  // Only initialize if consent is given
  if (hasConsentedToCookies()) {
    getUserId();
  }
};

/**
 * Send analytics event to server and parent window
 * Automatically includes user ID in every event
 * Only tracks if user has consented to cookies
 */
export const trackEvent = async (event, data = {}) => {
  // Check consent - if not consented, don't track (except consent events themselves)
  const consentGiven = hasConsentedToCookies();
  const isConsentEvent = event === 'cookie_consent_accepted' || event === 'cookie_consent_rejected';
  
  if (!consentGiven && !isConsentEvent) {
    // User hasn't consented, don't track
    return;
  }
  
  // Get or create user ID
  const userId = getUserId();
  
  // Add user ID to event data
  const eventData = {
    ...data,
    userId,
    consentGiven,
  };
  
  // Send to server
  try {
    await fetch('/api/track', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ event, data: eventData }),
    });
  } catch (error) {
    console.error('Analytics tracking error:', error);
  }

  // Send to parent window (iframe host)
  if (window.parent && window.parent !== window) {
    try {
      window.parent.postMessage(
        {
          type: 'analytics',
          event,
          data: eventData,
        },
        '*'
      );
    } catch (error) {
      console.error('PostMessage error:', error);
    }
  }
};

/**
 * Mask phone number (show only last 4 digits)
 */
export const maskPhone = (phone) => {
  if (!phone || phone.length < 4) return phone;
  return '****' + phone.slice(-4);
};

