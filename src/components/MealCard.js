import React, { useState, useEffect } from 'react';
import { createUseStyles } from 'react-jss';
import { useTranslation } from 'react-i18next';
import { theme } from '../styles/theme.js';
import { DEFAULT_DISH_IMAGE } from '../utils/imageResolver.js';

const useStyles = createUseStyles({
  card: {
    position: 'relative',
    borderRadius: theme.borderRadius.md,
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'transform 0.2s, opacity 0.3s',
    '&:hover': {
      transform: 'scale(1.02)',
    },
  },
  cardDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
    '&:hover': {
      transform: 'none',
    },
  },
  image: {
    width: '100%',
    height: '200px',
    objectFit: 'cover',
    display: 'block',
  },
  label: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: theme.spacing.md,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    color: '#ffffff',
    textAlign: 'start',
    fontWeight: 'bold',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  labelName: {
    flex: 1,
    textAlign: 'start',
  },
  labelPrice: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    whiteSpace: 'nowrap',
  },
});

export const MealCard = ({ meal, selected, disabled, onSelect, onInstagram, imagesMap, price }) => {
  const classes = useStyles();
  const { t, i18n } = useTranslation();
  const [imageSrc, setImageSrc] = useState(meal.image || DEFAULT_DISH_IMAGE);
  const [hasTriedFallback, setHasTriedFallback] = useState(false);

  const handleClick = () => {
    if (!disabled && onSelect) {
      onSelect(meal.id);
    }
  };

  // Determine price alignment based on language
  // Right aligned for English (LTR), left aligned for Hebrew/Arabic (RTL)
  const isRTL = i18n.language === 'he' || i18n.language === 'ar';
  const priceAlignStyle = {
    textAlign: isRTL ? 'start' : 'end',
    marginInlineStart: isRTL ? 'auto' : 0,
    marginInlineEnd: isRTL ? 0 : 'auto',
  };

  // Update image source when meal.image changes
  useEffect(() => {
    setImageSrc(meal.image || DEFAULT_DISH_IMAGE);
    setHasTriedFallback(false);
  }, [meal.image]);

  return (
    <div
      className={`${classes.card} ${disabled ? classes.cardDisabled : ''}`}
      onClick={handleClick}
    >
      <img
        src={imageSrc}
        alt={meal.name}
        className={classes.image}
        loading="lazy"
        onError={(e) => {
          // Try Layer 2 (images map) if Layer 1 (menu image) fails
          if (!hasTriedFallback && imagesMap && imagesMap[meal.id]) {
            console.log(`🔄 Layer 1 image failed for ${meal.id}, trying Layer 2 (images map):`, imagesMap[meal.id]);
            setImageSrc(imagesMap[meal.id]);
            setHasTriedFallback(true);
          } else {
            // Fallback to default (Layer 3)
            console.warn(`⚠️ All images failed for ${meal.id}, using default. Last tried:`, e.target.src);
            if (e.target.src !== DEFAULT_DISH_IMAGE) {
              setImageSrc(DEFAULT_DISH_IMAGE);
            }
          }
        }}
      />
      <div className={classes.label}>
        <span className={classes.labelName}>{meal.name}</span>
        {price !== null && price !== undefined && (
          <span className={classes.labelPrice} style={priceAlignStyle}>
            {typeof price === 'number' ? `${price.toFixed(2)}₪` : price}
          </span>
        )}
      </div>
    </div>
  );
};

