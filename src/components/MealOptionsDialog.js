import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { createUseStyles } from 'react-jss';
import { theme } from '../styles/theme.js';

const useStyles = createUseStyles({
  backdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-end',
    zIndex: 210,
    padding: theme.spacing.lg,
  },
  dialog: {
    backgroundColor: '#ffffff',
    borderRadius: `${theme.borderRadius.lg} ${theme.borderRadius.lg} 0 0`,
    width: 'min(560px, 100%)',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 -20px 40px rgba(15, 23, 42, 0.25)',
  },
  dragHandle: {
    alignSelf: 'center',
    width: '48px',
    height: '5px',
    borderRadius: '5px',
    backgroundColor: '#d1d5db',
    marginBlock: theme.spacing.sm,
  },
  header: {
    padding: `0 ${theme.spacing.xl} ${theme.spacing.md}`,
    textAlign: 'start',
    borderBottom: `1px solid ${theme.colors.border}`,
  },
  title: {
    margin: 0,
    fontSize: '1.5rem',
    color: theme.colors.primary,
  },
  subtitle: {
    margin: `${theme.spacing.sm} 0 0`,
    color: theme.colors.textSecondary,
    fontSize: '0.95rem',
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    padding: `${theme.spacing.lg} ${theme.spacing.xl}`,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.xl,
  },
  group: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.md,
  },
  groupHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  groupTitle: {
    fontSize: '1.1rem',
    fontWeight: 'bold',
    color: theme.colors.primary,
    margin: 0,
  },
  groupMeta: {
    fontSize: '0.85rem',
    color: theme.colors.textSecondary,
    whiteSpace: 'nowrap',
  },
  optionsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.sm,
  },
  optionButton: {
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    textAlign: 'start',
    cursor: 'pointer',
    background: '#ffffff',
    transition: 'border-color 0.2s, box-shadow 0.2s, transform 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.lg,
    '&:hover': {
      borderColor: theme.colors.primary,
      boxShadow: '0 10px 16px rgba(15, 23, 42, 0.08)',
      transform: 'translateY(-1px)',
    },
  },
  optionButtonSelected: {
    borderColor: theme.colors.primary,
    boxShadow: '0 12px 20px rgba(0, 112, 243, 0.12)',
    background: 'linear-gradient(135deg, rgba(12, 74, 110, 0.04), rgba(37, 99, 235, 0.08))',
  },
  optionTitle: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.xs,
  },
  optionName: {
    fontSize: '1rem',
    fontWeight: 600,
    color: theme.colors.text,
  },
  optionPrice: {
    fontSize: '0.85rem',
    color: theme.colors.textSecondary,
  },
  checkmark: {
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    border: `2px solid ${theme.colors.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.75rem',
    color: '#ffffff',
  },
  checkmarkSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primary,
  },
  footer: {
    padding: theme.spacing.lg,
    borderTop: `1px solid ${theme.colors.border}`,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.md,
  },
  priceSummary: {
    display: 'flex',
    justifyContent: 'space-between',
    fontWeight: 'bold',
    color: theme.colors.primary,
    fontSize: '1.1rem',
  },
  buttonsRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.sm,
  },
  primaryButton: {
    padding: `${theme.spacing.md} ${theme.spacing.lg}`,
    backgroundColor: theme.colors.primary,
    color: '#ffffff',
    border: 'none',
    borderRadius: theme.borderRadius.md,
    fontSize: '1rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'background-color 0.2s, transform 0.2s',
    '&:hover:not(:disabled)': {
      backgroundColor: theme.colors.secondary,
      transform: 'translateY(-1px)',
    },
    '&:disabled': {
      backgroundColor: theme.colors.disabled,
      cursor: 'not-allowed',
    },
  },
  secondaryButton: {
    padding: `${theme.spacing.md} ${theme.spacing.lg}`,
    backgroundColor: '#ffffff',
    color: theme.colors.text,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.borderRadius.md,
    fontSize: '1rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
    '&:hover': {
      backgroundColor: theme.colors.surface,
    },
  },
});

const dialogRootId = 'meal-options-dialog-root';

const ensureDialogRoot = () => {
  let root = document.getElementById(dialogRootId);
  if (!root) {
    root = document.createElement('div');
    root.id = dialogRootId;
    document.body.appendChild(root);
  }
  return root;
};

const serializeSelections = (selections) =>
  Object.entries(selections)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([groupId, optionIds]) => `${groupId}:${optionIds.slice().sort().join('|')}`)
    .join(';');

const MealOptionsDialogComponent = ({ open, meal, config, language, texts, onConfirm, onCancel }) => {
  const classes = useStyles();
  const [selections, setSelections] = useState({});

  const basePrice = config?.basePrice ?? 0;

  useEffect(() => {
    if (!open) {
      return;
    }

    const initialSelections = {};
    config?.groups?.forEach((group) => {
      if (group.type === 'single' && group.required) {
        initialSelections[group.id] = [group.options[0]?.id].filter(Boolean);
      } else {
        initialSelections[group.id] = [];
      }
    });
    setSelections(initialSelections);
  }, [open, config]);

  const handleOptionToggle = (group, optionId) => {
    setSelections((prev) => {
      const current = prev[group.id] || [];
      if (group.type === 'single') {
        return { ...prev, [group.id]: [optionId] };
      }

      const exists = current.includes(optionId);
      let next = exists ? current.filter((id) => id !== optionId) : [...current, optionId];
      if (!exists && group.max && next.length > group.max) {
        next = next.slice(next.length - group.max);
      }

      return { ...prev, [group.id]: next };
    });
  };

  const optionPrice = useMemo(() => {
    if (!config) return 0;
    return config.groups.reduce((sum, group) => {
      const selected = selections[group.id] || [];
      const groupSum = selected.reduce((optSum, optionId) => {
        const option = group.options.find((opt) => opt.id === optionId);
        return option ? optSum + (option.price || 0) : optSum;
      }, 0);
      return sum + groupSum;
    }, 0);
  }, [config, selections]);

  const totalPrice = basePrice + optionPrice;

  const isValid = useMemo(() => {
    if (!config) return false;
    return config.groups.every((group) => {
      const selected = selections[group.id] || [];
      if (group.type === 'single') {
        if (group.required && selected.length === 0) {
          return false;
        }
        return selected.length <= 1;
      }
      if (group.min && selected.length < group.min) {
        return false;
      }
      if (group.max && selected.length > group.max) {
        return false;
      }
      return true;
    });
  }, [config, selections]);

  if (!open || !config) {
    return null;
  }

  const handleConfirm = () => {
    if (!isValid) {
      return;
    }
    onConfirm({
      mealId: meal.id,
      selections,
      price: {
        base: basePrice,
        options: optionPrice,
        total: totalPrice,
      },
      key: serializeSelections(selections),
    });
  };

  const handleCancel = () => {
    onCancel();
  };

  return createPortal(
    <div className={classes.backdrop} role="dialog" aria-modal="true">
      <div className={classes.dialog}>
        <div className={classes.dragHandle} />
        <div className={classes.header}>
          <h2 className={classes.title}>{texts.title}</h2>
          <p className={classes.subtitle}>{meal?.displayName}</p>
        </div>
        <div className={classes.content}>
          {config.groups.map((group) => {
            const selected = selections[group.id] || [];
            const limitText =
              group.type === 'multiple' && group.max
                ? typeof texts.limit === 'function'
                  ? texts.limit(group.max)
                  : texts.limit.replace('{{count}}', group.max)
                : group.required
                ? texts.required
                : texts.optional;

            return (
              <div key={group.id} className={classes.group}>
                <div className={classes.groupHeader}>
                  <h3 className={classes.groupTitle}>{group.title[language] || group.title.en}</h3>
                  <span className={classes.groupMeta}>{limitText}</span>
                </div>
                <div className={classes.optionsList}>
                  {group.options.map((option) => {
                    const isSelected = selected.includes(option.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={`${classes.optionButton} ${
                          isSelected ? classes.optionButtonSelected : ''
                        }`}
                        onClick={() => handleOptionToggle(group, option.id)}
                      >
                        <div className={classes.optionTitle}>
                          <span className={classes.optionName}>
                            {option.label[language] || option.label.en}
                          </span>
                        {option.price > 0 && (
                          <span className={classes.optionPrice}>
                            {typeof texts.price === 'function'
                              ? texts.price(option.price)
                              : texts.price.replace('{{amount}}', option.price.toString())}
                          </span>
                        )}
                        </div>
                        <span
                          className={`${classes.checkmark} ${
                            isSelected ? classes.checkmarkSelected : ''
                          }`}
                        >
                          {isSelected ? '✓' : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className={classes.footer}>
          <div className={classes.priceSummary}>
            <span>{texts.total}</span>
            <span>{totalPrice.toFixed(2)}₪</span>
          </div>
          <div className={classes.buttonsRow}>
            <button
              type="button"
              className={classes.primaryButton}
              onClick={handleConfirm}
              disabled={!isValid}
            >
              {texts.confirm}
            </button>
            <button type="button" className={classes.secondaryButton} onClick={handleCancel}>
              {texts.cancel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    ensureDialogRoot()
  );
};

export const MealOptionsDialog = React.memo(MealOptionsDialogComponent);


