import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createUseStyles } from 'react-jss';
import { useTranslation } from 'react-i18next';
import { theme } from '../styles/theme.js';
import { useGlobalStyles } from '../styles/global.js';
import { MealCard } from '../components/MealCard.js';
import { OfficeForm } from '../components/OfficeForm.js';
import { ThankYou } from '../components/ThankYou.js';
import { LangSwitcher } from '../components/LangSwitcher.js';
import { trackEvent } from '../utils/analytics.js';
import '../i18n/index.js';

const useStyles = createUseStyles({
  container: {
    minHeight: '100vh',
    padding: theme.spacing.xl,
    maxWidth: '1200px',
    margin: '0 auto',
  },
  section: {
    marginBlockEnd: theme.spacing.xxl,
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
  const { t } = useTranslation();

  const [step, setStep] = useState('meal'); // meal, location, payment, thankYou
  const [selectedMeal, setSelectedMeal] = useState(null);
  const [locationData, setLocationData] = useState(null);

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
    setStep('meal');
    setSelectedMeal(null);
    setLocationData(null);
  };

  const getMealName = (mealId) => {
    const meal = meals.find((m) => m.id === mealId);
    return meal ? t(`meal.${meal.name}`) : '';
  };

  return (
    <div className={classes.container}>
      <LangSwitcher />

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
            <div style={{ textAlign: 'center', marginBlockStart: theme.spacing.lg }}>
              <button
                onClick={() => setStep('location')}
                style={{
                  padding: `${theme.spacing.md} ${theme.spacing.lg}`,
                  backgroundColor: theme.colors.primary,
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: theme.borderRadius.sm,
                  fontSize: '1rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                }}
              >
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
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<EataliaBSRPage />);
}

