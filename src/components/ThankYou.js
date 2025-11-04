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
  summaryLabel: {
    fontWeight: 'bold',
    marginInlineEnd: theme.spacing.md,
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

  return (
    <div className={classes.container}>
      <h1 className={classes.title}>{t('thankYou.title')}</h1>
      <div className={classes.summary}>
        <h2 className={classes.summaryTitle}>{t('thankYou.orderSummary')}</h2>
        <div className={classes.summaryItem}>
          <span className={classes.summaryLabel}>{t('thankYou.meal')}:</span>
          <span>{orderData.meal}</span>
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
      </div>
      <button className={classes.button} onClick={onRestart}>
        {t('thankYou.restart')}
      </button>
    </div>
  );
};

