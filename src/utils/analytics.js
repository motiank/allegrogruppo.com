/**
 * Send analytics event to server and parent window
 */
export const trackEvent = async (event, data = {}) => {
  // Send to server
  try {
    await fetch('/api/track', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ event, data }),
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
          data,
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

