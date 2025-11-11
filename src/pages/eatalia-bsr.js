import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createUseStyles } from 'react-jss';
import { useTranslation } from 'react-i18next';
import { theme } from '../styles/theme.js';
import { useGlobalStyles } from '../styles/global.js';
import { MealCard } from '../components/MealCard.js';
import { OfficeForm } from '../components/OfficeForm.js';
import { ThankYou } from '../components/ThankYou.js';
import { LangSwitcher } from '../components/LangSwitcher.js';
import { PolicyDialog } from '../components/PolicyDialog.js';
import { trackEvent } from '../utils/analytics.js';
import '../i18n/index.js';

const useStyles = createUseStyles({
  container: {
    minHeight: '100vh',
    padding: theme.spacing.xl,
    maxWidth: '1200px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
  },
  mainContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  section: {
    marginBlockEnd: theme.spacing.xxl,
  },
  welcomeSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.xl,
    alignItems: 'stretch',
  },
  welcomeCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.xl,
    border: `1px solid ${theme.colors.border}`,
    boxShadow: '0 12px 30px rgba(15, 23, 42, 0.08)',
  },
  welcomeHeading: {
    fontSize: '2.25rem',
    lineHeight: 1.2,
    marginBlockEnd: theme.spacing.md,
    color: theme.colors.primary,
    textAlign: 'start',
  },
  welcomeSubheading: {
    fontSize: '1.25rem',
    marginBlockEnd: theme.spacing.lg,
    color: theme.colors.text,
    textAlign: 'start',
  },
  welcomeText: {
    fontSize: '1rem',
    color: theme.colors.textSecondary,
    marginBlockEnd: theme.spacing.md,
    textAlign: 'start',
  },
  groupField: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.sm,
  },
  groupLabel: {
    fontSize: '0.95rem',
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  groupInput: {
    padding: `${theme.spacing.sm} ${theme.spacing.md}`,
    borderRadius: theme.borderRadius.sm,
    border: `1px solid ${theme.colors.border}`,
    fontSize: '1rem',
    color: theme.colors.text,
    backgroundColor: '#ffffff',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    '&:focus': {
      borderColor: theme.colors.primary,
      boxShadow: `0 0 0 3px rgba(0, 112, 243, 0.15)`,
      outline: 'none',
    },
  },
  startButton: {
    alignSelf: 'flex-start',
    padding: `${theme.spacing.md} ${theme.spacing.xl}`,
    backgroundColor: theme.colors.primary,
    color: '#ffffff',
    border: 'none',
    borderRadius: theme.borderRadius.md,
    fontSize: '1.05rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'transform 0.2s, box-shadow 0.2s, background-color 0.2s',
    boxShadow: '0 10px 25px rgba(0, 112, 243, 0.25)',
    '&:hover': {
      backgroundColor: theme.colors.secondary,
      transform: 'translateY(-2px)',
      boxShadow: '0 14px 28px rgba(0, 112, 243, 0.3)',
    },
  },
  title: {
    fontSize: '2rem',
    marginBlockEnd: theme.spacing.lg,
    textAlign: 'center',
    color: theme.colors.primary,
  },
  mealGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: theme.spacing.lg,
    marginBlockEnd: theme.spacing.xl,
  },
  paymentPlaceholder: {
    textAlign: 'center',
    padding: theme.spacing.xxl,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    fontSize: '1.25rem',
    color: theme.colors.textSecondary,
  },
  footer: {
    marginBlockStart: 'auto',
    paddingBlockStart: theme.spacing.lg,
    borderBlockStart: `1px solid ${theme.colors.border}`,
    textAlign: 'center',
    fontSize: '0.875rem',
    color: theme.colors.textSecondary,
  },
  footerLink: {
    color: theme.colors.primary,
    textDecoration: 'none',
    marginInline: theme.spacing.sm,
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    font: 'inherit',
    '&:hover': {
      textDecoration: 'underline',
    },
  },
  footerSeparator: {
    marginInline: theme.spacing.sm,
    color: theme.colors.border,
  },
  mealFooter: {
    position: 'sticky',
    bottom: theme.spacing.lg,
    marginInline: 'auto',
    textAlign: 'center',
    zIndex: 5,
  },
  nextButton: {
    padding: `${theme.spacing.md} ${theme.spacing.lg}`,
    backgroundColor: theme.colors.primary,
    color: '#ffffff',
    border: 'none',
    borderRadius: theme.borderRadius.sm,
    fontSize: '1rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
    minWidth: '220px',
    '&:hover': {
      backgroundColor: theme.colors.secondary,
    },
  },
  '@media (max-width: 768px)': {
    container: {
      padding: `${theme.spacing.lg} ${theme.spacing.md}`,
    },
    mealGrid: {
      gridTemplateColumns: '1fr',
      gap: theme.spacing.md,
    },
    mealFooter: {
      bottom: theme.spacing.md,
    },
    nextButton: {
      width: '100%',
      minWidth: 'auto',
    },
  },
});

const meals = [
  {
    id: 'hamburger',
    name: 'hamburger',
    image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400&h=300&fit=crop',
    instagramUrl: 'https://www.instagram.com/reel/DNxrviKXmm5/?igsh=MW9kM3Y1MTJqbHViNw==',
  },
  {
    id: 'schnitzel',
    name: 'schnitzel',
    image: 'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=400&h=300&fit=crop',
    instagramUrl: 'https://www.instagram.com/reel/DNxrviKXmm5/?igsh=MW9kM3Y1MTJqbHViNw==',
  },
  {
    id: 'chickenSalad',
    name: 'chickenSalad',
    image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=300&fit=crop',
    instagramUrl: 'https://www.instagram.com/reel/DNxrviKXmm5/?igsh=MW9kM3Y1MTJqbHViNw==',
  },
  {
    id: 'pasta',
    name: 'pasta',
    image: 'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=400&h=300&fit=crop',
    instagramUrl: 'https://www.instagram.com/reel/DNxrviKXmm5/?igsh=MW9kM3Y1MTJqbHViNw==',
  },
];

const EataliaBSRPage = () => {
  useGlobalStyles();
  const classes = useStyles();
  const { t, i18n } = useTranslation();

  const [step, setStep] = useState('welcome'); // welcome, meal, location, payment, thankYou
  const [selectedMeal, setSelectedMeal] = useState(null);
  const [locationData, setLocationData] = useState(null);
  const [groupName, setGroupName] = useState('');
  const [policyDialog, setPolicyDialog] = useState({
    open: false,
    type: null,
    content: '',
    loading: false,
    error: null,
  });

  const handleMealSelect = (mealId) => {
    setSelectedMeal(mealId);
    const meal = meals.find((m) => m.id === mealId);
    trackEvent('meal_selected', { meal: mealId });
    // Gray out others is handled by disabled prop
  };

  const handleInstagramOpen = (mealId) => {
    const meal = meals.find((m) => m.id === mealId);
    if (meal && meal.instagramUrl) {
      window.open(meal.instagramUrl, '_blank', 'noopener,noreferrer');
      trackEvent('instagram_opened', { meal: mealId });
    }
  };

  const handleLocationSubmit = (data) => {
    setLocationData(data);
    trackEvent('location_completed', { ...data });
    setStep('payment');
    // Auto-advance to thank you after a short delay (simulating payment)
    setTimeout(() => {
      setStep('thankYou');
      trackEvent('flow_completed', {
        meal: selectedMeal,
        ...data,
      });
    }, 2000);
  };

  const handleRestart = () => {
    setStep('welcome');
    setSelectedMeal(null);
    setLocationData(null);
    setGroupName('');
  };

  const getMealName = (mealId) => {
    const meal = meals.find((m) => m.id === mealId);
    return meal ? t(`meal.${meal.name}`) : '';
  };

  const handlePolicyOpen = (type) => {
    setPolicyDialog({
      open: true,
      type,
      content: '',
      loading: true,
      error: null,
    });
  };

  const handlePolicyClose = () => {
    setPolicyDialog({
      open: false,
      type: null,
      content: '',
      loading: false,
      error: null,
    });
  };

  useEffect(() => {
    if (!policyDialog.open || !policyDialog.type) {
      return undefined;
    }

    const supportedLangs = ['he', 'en', 'ar'];
    const lang = supportedLangs.includes(i18n.language) ? i18n.language : 'he';

    const files = {
      terms: {
        he: '/policies/terms.he.html',
        en: '/policies/terms.en.html',
        ar: '/policies/terms.ar.html',
      },
      privacy: {
        he: '/policies/privacy.he.html',
        en: '/policies/privacy.en.html',
        ar: '/policies/privacy.ar.html',
      },
    };

    const controller = new AbortController();
    let isActive = true;

    fetch(files[policyDialog.type][lang], { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Failed to fetch policy');
        }
        return response.text();
      })
      .then((html) => {
        if (isActive) {
          setPolicyDialog((prev) => ({
            ...prev,
            content: html,
            loading: false,
          }));
        }
      })
      .catch(() => {
        if (isActive && !controller.signal.aborted) {
          setPolicyDialog((prev) => ({
            ...prev,
            loading: false,
            error: i18n.t('policy.error'),
          }));
        }
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [policyDialog.open, policyDialog.type, i18n.language]);

  return (
    <div className={classes.container}>
      <LangSwitcher />

      <div className={classes.mainContent}>
        {step === 'welcome' && (
          <div className={classes.section}>
            <div className={classes.welcomeSection}>
              <div className={classes.welcomeCard}>
                <h1 className={classes.welcomeHeading}>
                  {t('welcome.greeting')} {t('welcome.intro')}
                </h1>
                <p className={classes.welcomeText}>{t('welcome.exclusive')}</p>
                <p className={classes.welcomeSubheading}>{t('welcome.question')}</p>
                <p className={classes.welcomeText}>{t('welcome.instruction')}</p>
                <p className={classes.welcomeText}>{t('welcome.signature')}</p>
              </div>

              <div className={classes.welcomeCard}>
                <div className={classes.groupField}>
                  <label className={classes.groupLabel} htmlFor="groupName">
                    {t('welcome.groupLabel')}
                  </label>
                  <input
                    id="groupName"
                    className={classes.groupInput}
                    type="text"
                    value={groupName}
                    onChange={(event) => setGroupName(event.target.value)}
                    placeholder={t('welcome.groupPlaceholder')}
                  />
                </div>
              </div>

              <button
                type="button"
                className={classes.startButton}
                onClick={() => {
                  setStep('meal');
                  trackEvent('welcome_started', { groupName: groupName || 'anonymous' });
                }}
              >
                {t('welcome.start')}
              </button>
            </div>
          </div>
        )}

        {step === 'meal' && (
          <div className={classes.section}>
            <h1 className={classes.title}>{t('meal.title')}</h1>
            <div className={classes.mealGrid}>
              {meals.map((meal) => (
                <MealCard
                  key={meal.id}
                  meal={{
                    ...meal,
                    name: t(`meal.${meal.name}`),
                  }}
                  selected={selectedMeal === meal.id}
                  disabled={selectedMeal !== null && selectedMeal !== meal.id}
                  onSelect={handleMealSelect}
                  onInstagram={handleInstagramOpen}
                />
              ))}
            </div>
            {selectedMeal && (
              <div className={classes.mealFooter}>
                <button className={classes.nextButton} onClick={() => setStep('location')}>
                  {t('location.next')}
                </button>
              </div>
            )}
          </div>
        )}

        {step === 'location' && (
          <div className={classes.section}>
            <h1 className={classes.title}>{t('location.title')}</h1>
            <OfficeForm onSubmit={handleLocationSubmit} />
          </div>
        )}

        {step === 'payment' && (
          <div className={classes.section}>
            <h1 className={classes.title}>{t('payment.title')}</h1>
            <div className={classes.paymentPlaceholder}>
              {t('payment.comingSoon')}
            </div>
          </div>
        )}

        {step === 'thankYou' && (
          <ThankYou
            orderData={{
              meal: getMealName(selectedMeal),
              ...locationData,
            }}
            onRestart={handleRestart}
          />
        )}
      </div>

      <footer className={classes.footer}>
        <button
          type="button"
          className={classes.footerLink}
          onClick={() => handlePolicyOpen('terms')}
        >
          {t('footer.terms')}
        </button>
        <span className={classes.footerSeparator}>|</span>
        <button
          type="button"
          className={classes.footerLink}
          onClick={() => handlePolicyOpen('privacy')}
        >
          {t('footer.privacy')}
        </button>
      </footer>

      <PolicyDialog
        open={policyDialog.open}
        title={
          policyDialog.type === 'privacy'
            ? t('policy.privacyTitle')
            : t('policy.termsTitle')
        }
        content={policyDialog.content}
        loading={policyDialog.loading ? t('policy.loading') : ''}
        error={policyDialog.error}
        onClose={handlePolicyClose}
        closeLabel={t('policy.close')}
      />
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<EataliaBSRPage />);
}

