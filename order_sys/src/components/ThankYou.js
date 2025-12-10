import React from 'react';
import { createUseStyles } from 'react-jss';
import { useTranslation } from 'react-i18next';
import { theme } from '../styles/theme.js';
import { maskPhone } from '../utils/analytics.js';

const useStyles = createUseStyles({
  container: {
    textAlign: 'center',
    padding: theme.spacing.xl,
  },
  title: {
    fontSize: '2rem',
    marginBlockEnd: theme.spacing.lg,
    color: theme.colors.primary,
  },
  summary: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
    borderRadius: theme.borderRadius.md,
    marginBlockEnd: theme.spacing.lg,
    maxWidth: '500px',
    margin: `0 auto ${theme.spacing.lg}`,
  },
  summaryTitle: {
    fontSize: '1.25rem',
    fontWeight: 'bold',
    marginBlockEnd: theme.spacing.md,
    textAlign: 'start',
  },
  summaryItem: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: theme.spacing.sm,
    textAlign: 'start',
    borderBlockEnd: `1px solid ${theme.colors.border}`,
    '&:last-child': {
      borderBlockEnd: 'none',
    },
  },
  summaryItemColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.xs,
    padding: theme.spacing.sm,
    textAlign: 'start',
    borderBlockEnd: `1px solid ${theme.colors.border}`,
    '&:last-child': {
      borderBlockEnd: 'none',
    },
  },
  summaryLabel: {
    fontWeight: 'bold',
    marginInlineEnd: theme.spacing.md,
  },
  mealList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.xs,
  },
  mealListItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.xs,
    paddingBlock: theme.spacing.xs,
    fontSize: '0.95rem',
  },
  mealListItemHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  mealListItemMeta: {
    fontSize: '0.85rem',
    color: theme.colors.textSecondary,
  },
  mealPrice: {
    fontWeight: 'bold',
    color: theme.colors.primary,
  },
  mealOptionList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.xs,
    color: theme.colors.textSecondary,
    fontSize: '0.85rem',
  },
  mealOptionItem: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  button: {
    padding: `${theme.spacing.md} ${theme.spacing.lg}`,
    backgroundColor: theme.colors.primary,
    color: '#ffffff',
    border: 'none',
    borderRadius: theme.borderRadius.sm,
    fontSize: '1rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
    '&:hover': {
      backgroundColor: theme.colors.secondary,
    },
  },
});

export const ThankYou = ({ orderData, onRestart }) => {
  const classes = useStyles();
  const { t } = useTranslation();
  const formatPrice = (value) => (value ?? 0).toFixed(2);

  return (
    <div className={classes.container}>
      <h1 className={classes.title}>{t('thankYou.title')}</h1>
      <div className={classes.summary}>
        <h2 className={classes.summaryTitle}>{t('thankYou.orderSummary')}</h2>
        {orderData.meals && orderData.meals.length > 0 && (
          <div className={classes.summaryItemColumn}>
            <span className={classes.summaryLabel}>{t('thankYou.meals')}:</span>
            <ul className={classes.mealList}>
              {orderData.meals.map((meal) => (
                <li key={meal.id} className={classes.mealListItem}>
                  <div className={classes.mealListItemHeader}>
                    <span>{meal.name}</span>
                    <span className={classes.mealPrice}>
                      {t('thankYou.price')}: {formatPrice(meal.totalPrice ?? meal.unitPrice)}₪
                    </span>
                  </div>
                  <div className={classes.mealListItemMeta}>
                    {t('thankYou.quantity')}: {meal.quantity}
                  </div>
                  {meal.options && meal.options.length > 0 && (
                    <ul className={classes.mealOptionList}>
                      {meal.options.map((option) => (
                        <li
                          key={`${option.groupId}-${option.optionId}`}
                          className={classes.mealOptionItem}
                        >
                          <span>
                            {option.groupTitle}: {option.optionLabel}
                          </span>
                          {option.price > 0 && <span>+{formatPrice(option.price)}₪</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {orderData.groupName && (
          <div className={classes.summaryItem}>
            <span className={classes.summaryLabel}>{t('welcome.groupLabel')}:</span>
            <span>{orderData.groupName}</span>
          </div>
        )}
        <div className={classes.summaryItem}>
          <span className={classes.summaryLabel}>{t('location.name')}:</span>
          <span>{orderData.name}</span>
        </div>
        <div className={classes.summaryItem}>
          <span className={classes.summaryLabel}>{t('thankYou.building')}:</span>
          <span>{orderData.building}</span>
        </div>
        <div className={classes.summaryItem}>
          <span className={classes.summaryLabel}>{t('thankYou.floor')}:</span>
          <span>{orderData.floor}</span>
        </div>
        <div className={classes.summaryItem}>
          <span className={classes.summaryLabel}>{t('thankYou.office')}:</span>
          <span>{orderData.office}</span>
        </div>
        <div className={classes.summaryItem}>
          <span className={classes.summaryLabel}>{t('thankYou.phone')}:</span>
          <span>{maskPhone(orderData.phone)}</span>
        </div>
        {orderData.notes && (
          <div className={classes.summaryItemColumn}>
            <span className={classes.summaryLabel}>{t('location.notes')}:</span>
            <span>{orderData.notes}</span>
          </div>
        )}
        {typeof orderData.total === 'number' && (
          <div className={classes.summaryItem}>
            <span className={classes.summaryLabel}>{t('thankYou.total')}:</span>
            <span>{formatPrice(orderData.total)}₪</span>
          </div>
        )}
        {orderData.approvalNo && (
          <div className={classes.summaryItem}>
            <span className={classes.summaryLabel}>{t('thankYou.approvalNumber')}:</span>
            <span>{orderData.approvalNo}</span>
          </div>
        )}
      </div>
      <button className={classes.button} onClick={onRestart}>
        {t('thankYou.restart')}
      </button>
    </div>
  );
};

