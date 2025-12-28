import React, { useState, useEffect } from 'react';
import { createUseStyles } from 'react-jss';
import { useTranslation } from 'react-i18next';
import { theme } from '../styles/index.js';
import { trackEvent } from '../utils/analytics.js';

const CONSENT_STORAGE_KEY = 'eatalia_cookie_consent';
const CONSENT_VALUES = {
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  PENDING: 'pending'
};

const useStyles = createUseStyles({
  consentBanner: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: theme.colors.surface || '#ffffff',
    borderTop: `2px solid ${theme.colors.primary}`,
    boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.15)',
    zIndex: 10000,
    padding: theme.spacing.lg,
    transform: 'translateY(100%)',
    transition: 'transform 0.3s ease-in-out',
    maxWidth: '100%',
  },
  consentBannerVisible: {
    transform: 'translateY(0)',
  },
  consentContent: {
    maxWidth: '1200px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.md,
    alignItems: 'flex-start',
  },
  consentText: {
    fontSize: '0.95rem',
    lineHeight: 1.6,
    color: theme.colors.text,
    margin: 0,
  },
  consentLink: {
    color: theme.colors.primary,
    textDecoration: 'underline',
    '&:hover': {
      textDecoration: 'none',
    },
  },
  consentActions: {
    display: 'flex',
    gap: theme.spacing.md,
    flexWrap: 'wrap',
    width: '100%',
  },
  consentButton: {
    padding: `${theme.spacing.sm} ${theme.spacing.lg}`,
    borderRadius: theme.borderRadius.md,
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.95rem',
    fontWeight: 600,
    transition: 'all 0.2s',
    minWidth: '120px',
  },
  acceptButton: {
    backgroundColor: theme.colors.primary,
    color: '#ffffff',
    '&:hover': {
      backgroundColor: theme.colors.secondary,
      transform: 'translateY(-1px)',
    },
  },
  rejectButton: {
    backgroundColor: 'transparent',
    color: theme.colors.text,
    border: `1px solid ${theme.colors.border}`,
    '&:hover': {
      backgroundColor: theme.colors.border,
    },
  },
});

/**
 * Get current consent status
 */
export const getCookieConsent = () => {
  try {
    return localStorage.getItem(CONSENT_STORAGE_KEY) || CONSENT_VALUES.PENDING;
  } catch (error) {
    return CONSENT_VALUES.PENDING;
  }
};

/**
 * Set consent status
 */
export const setCookieConsent = (value) => {
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, value);
    return true;
  } catch (error) {
    console.warn('[CookieConsent] Failed to save consent:', error);
    return false;
  }
};

/**
 * Check if user has consented to cookies/analytics
 */
export const hasConsentedToCookies = () => {
  const consent = getCookieConsent();
  return consent === CONSENT_VALUES.ACCEPTED;
};

const CookieConsent = () => {
  const classes = useStyles();
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [consentStatus, setConsentStatus] = useState(CONSENT_VALUES.PENDING);

  useEffect(() => {
    // Check if user has already made a decision
    const currentConsent = getCookieConsent();
    setConsentStatus(currentConsent);
    
    // Only show banner if no decision has been made
    if (currentConsent === CONSENT_VALUES.PENDING) {
      setIsVisible(true);
    }
  }, []);

  const handleAccept = () => {
    setCookieConsent(CONSENT_VALUES.ACCEPTED);
    setConsentStatus(CONSENT_VALUES.ACCEPTED);
    setIsVisible(false);
    
    // Initialize user ID now that consent is given
    if (typeof window !== 'undefined' && window.initUserId) {
      window.initUserId();
    }
    
    // Track consent acceptance (this will work because we just accepted)
    // Use a small delay to ensure localStorage is available
    setTimeout(() => {
      trackEvent('cookie_consent_accepted', {
        consentType: 'all',
        timestamp: new Date().toISOString(),
      });
    }, 100);
  };

  const handleReject = () => {
    setCookieConsent(CONSENT_VALUES.REJECTED);
    setConsentStatus(CONSENT_VALUES.REJECTED);
    setIsVisible(false);
    
    // Clear any existing analytics data from localStorage
    try {
      localStorage.removeItem('analytics_user_id');
    } catch (error) {
      // Silently fail if localStorage is not available
    }
    
    // Track consent rejection (send without localStorage, just basic tracking)
    // We'll send this even without consent as it's about the consent itself
    try {
      fetch('/api/track', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event: 'cookie_consent_rejected',
          data: {
            consentType: 'rejected',
            timestamp: new Date().toISOString(),
          },
        }),
      }).catch(() => {
        // Silently fail if tracking is not available
      });
    } catch (error) {
      // Silently fail
    }
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className={`${classes.consentBanner} ${classes.consentBannerVisible}`}>
      <div className={classes.consentContent}>
        <p className={classes.consentText}>
          {t('cookieConsent.message')}{' '}
          <a
            href="/policies/privacy.html"
            target="_blank"
            rel="noopener noreferrer"
            className={classes.consentLink}
          >
            {t('cookieConsent.learnMore')}
          </a>
        </p>
        <div className={classes.consentActions}>
          <button
            className={`${classes.consentButton} ${classes.acceptButton}`}
            onClick={handleAccept}
            type="button"
          >
            {t('cookieConsent.accept')}
          </button>
          <button
            className={`${classes.consentButton} ${classes.rejectButton}`}
            onClick={handleReject}
            type="button"
          >
            {t('cookieConsent.reject')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CookieConsent;
