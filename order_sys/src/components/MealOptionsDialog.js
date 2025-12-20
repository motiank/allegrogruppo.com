import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { createUseStyles } from 'react-jss';
import { theme } from '../styles/index.js';

const useStyles = createUseStyles({
  backdrop: {
    position: 'fixed',
    inset: 0,
    // Dark backdrop works well for both light and dark themes
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-end',
    zIndex: 210,
    padding: theme.spacing.lg,
  },
  dialog: {
    backgroundColor: theme.colors.surface || theme.colors.card || theme.colors.background,
    borderRadius: `${theme.borderRadius.lg} ${theme.borderRadius.lg} 0 0`,
    width: 'min(560px, 100%)',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: theme.boxStyles?.shadow?.xl || '0 -20px 40px rgba(0, 0, 0, 0.5)',
  },
  dragHandle: {
    alignSelf: 'center',
    width: '48px',
    height: '5px',
    borderRadius: '5px',
    backgroundColor: theme.colors.border,
    marginBlock: theme.spacing.sm,
  },
  header: {
    padding: `0 ${theme.spacing.xl} ${theme.spacing.md}`,
    textAlign: 'start',
    borderBottom: `1px solid ${theme.colors.border}`,
    position: 'relative',
  },
  closeButton: {
    position: 'absolute',
    top: theme.spacing.sm,
    insetInlineEnd: theme.spacing.xl,
    background: 'transparent',
    border: 'none',
    fontSize: '1.5rem',
    lineHeight: 1,
    color: theme.colors.textSecondary,
    cursor: 'pointer',
    padding: theme.spacing.xs,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    transition: 'background-color 0.2s, color 0.2s',
    '&:hover': {
      backgroundColor: theme.colors.surface,
      color: theme.colors.text,
    },
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
  description: {
    margin: `${theme.spacing.xs} 0 0`,
    color: theme.colors.textSecondary,
    fontSize: '0.9rem',
    lineHeight: 1.5,
    fontStyle: 'italic',
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
    background: theme.colors.card || theme.colors.surface || theme.colors.background,
    transition: 'border-color 0.2s, box-shadow 0.2s, transform 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.lg,
    '&:hover': {
      borderColor: theme.colors.primary,
      boxShadow: theme.boxStyles?.shadow?.md || '0 4px 12px rgba(0, 0, 0, 0.4)',
      transform: 'translateY(-1px)',
    },
  },
  optionButtonSelected: {
    borderColor: theme.colors.primary,
    boxShadow: theme.boxStyles?.shadow?.glow || `0 0 20px ${theme.colors.primary}40`,
    background: theme.colors.card || theme.colors.surface || theme.colors.background,
    borderWidth: '2px',
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
  optionDescription: {
    fontSize: '0.8rem',
    color: theme.colors.textSecondary,
    fontStyle: 'italic',
    marginBlockStart: theme.spacing.xs,
    lineHeight: 1.4,
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
    color: theme.colors.text,
    backgroundColor: 'transparent',
  },
  checkmarkSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primary,
    color: '#ffffff',
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
    color: theme.colors.text || '#ffffff',
    border: 'none',
    borderRadius: theme.borderRadius.md,
    fontSize: '1rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'background-color 0.2s, transform 0.2s, box-shadow 0.2s',
    '&:hover:not(:disabled)': {
      backgroundColor: theme.colors.secondary,
      transform: 'translateY(-1px)',
      boxShadow: theme.boxStyles?.shadow?.glow || `0 0 20px ${theme.colors.primary}40`,
    },
    '&:disabled': {
      backgroundColor: theme.colors.disabled,
      cursor: 'not-allowed',
      opacity: 0.5,
    },
  },
  secondaryButton: {
    padding: `${theme.spacing.md} ${theme.spacing.lg}`,
    backgroundColor: theme.colors.card || theme.colors.surface || theme.colors.background,
    color: theme.colors.text,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.borderRadius.md,
    fontSize: '1rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'background-color 0.2s, border-color 0.2s',
    '&:hover': {
      backgroundColor: theme.colors.surface || theme.colors.card,
      borderColor: theme.colors.primary,
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

const MealOptionsDialogComponent = ({ open, meal, config, language, texts, onConfirm, onCancel, metadata, initialSelections: propInitialSelections }) => {
  const classes = useStyles();
  const [selections, setSelections] = useState({});
  const isRTL = language === 'he' || language === 'ar';

  const basePrice = config?.basePrice ?? 0;

  useEffect(() => {
    if (!open) {
      return;
    }

    // Use provided initial selections if available, otherwise initialize with defaults
    let initialSelections = {};
    if (propInitialSelections && Object.keys(propInitialSelections).length > 0) {
      // Use the provided initial selections
      initialSelections = { ...propInitialSelections };
    } else {
      // Initialize with defaults
      config?.groups?.forEach((group) => {
        if (group.type === 'single' && group.required) {
          initialSelections[group.id] = [group.options[0]?.id].filter(Boolean);
        } else {
          initialSelections[group.id] = [];
        }
      });
    }
    setSelections(initialSelections);
  }, [open, config, propInitialSelections]);

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
          <button
            type="button"
            className={classes.closeButton}
            onClick={handleCancel}
            aria-label={texts.cancel || 'Close'}
          >
            ×
          </button>
          <h2 className={classes.title}>{texts.title}</h2>
          <p className={classes.subtitle}>{meal?.displayName}</p>
          {(() => {
            // Get translated description based on current language
            // Normalize language code (e.g., 'en-US' -> 'en')
            const langCode = language?.split('-')[0] || 'he';
            // Only use description if we have a translation for the current language
            // or if the current language is Hebrew (fallback to Hebrew description)
            let description = null;
            if (meal?.descriptionTranslate) {
              description = meal.descriptionTranslate[langCode] || meal.descriptionTranslate[language];
            }
            // Only fallback to Hebrew description if current language is Hebrew
            if (!description && langCode === 'he' && meal?.description) {
              description = meal.description;
            }
            return description && (
              <p className={classes.description}>{description}</p>
            );
          })()}
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
                    // Get option description from metadata if available, with translation
                    // Normalize language code (e.g., 'en-US' -> 'en')
                    const langCode = language?.split('-')[0] || 'he';
                    const optionData = metadata?.dishMappings?.[option.id];
                    const optionDescription = optionData?.descriptionTranslate?.[langCode] || optionData?.descriptionTranslate?.[language] || optionData?.description || null;
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
                        {optionDescription && (
                          <span className={classes.optionDescription}>
                            {optionDescription}
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
          </div>
        </div>
      </div>
    </div>,
    ensureDialogRoot()
  );
};

export const MealOptionsDialog = React.memo(MealOptionsDialogComponent);


