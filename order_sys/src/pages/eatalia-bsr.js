import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createUseStyles } from 'react-jss';
import { useTranslation } from 'react-i18next';
import { theme, useGlobalStyles } from '../styles/index.js';
import { MealCard } from '../components/MealCard.js';
import { OfficeForm } from '../components/OfficeForm.js';
import { ThankYou } from '../components/ThankYou.js';
import { LangSwitcher } from '../components/LangSwitcher.js';
import { PolicyDialog } from '../components/PolicyDialog.js';
import { MealOptionsDialog } from '../components/MealOptionsDialog.js';
import PelecardIframe from '../components/pelecardIframe.js';
import { ComingSoon } from '../components/ComingSoon.js';
import { trackEvent } from '../utils/analytics.js';
import { resolveDishImage } from '../utils/imageResolver.js';
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
  logo: {
    marginBlockEnd: theme.spacing.lg,
    objectFit: 'cover',
    alignSelf: 'center',
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
    backgroundColor: theme.colors.card || theme.colors.surface || theme.colors.background,
    transition: 'border-color 0.2s, box-shadow 0.2s',
    '&:focus': {
      borderColor: theme.colors.primary,
      boxShadow: theme.boxStyles?.shadow?.glow || `0 0 0 3px ${theme.colors.primary}26`,
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
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.lg,
    padding: theme.spacing.xxl,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    boxShadow: '0 10px 28px rgba(15, 23, 42, 0.08)',
  },
  paymentSummary: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    color: theme.colors.primary,
    fontSize: '1.15rem',
    fontWeight: 'bold',
  },
  paymentDetails: {
    color: theme.colors.textSecondary,
    fontSize: '0.95rem',
    lineHeight: 1.5,
  },
  paymentIframeWrapper: {
    width: '100%',
  },
  paymentFallback: {
    padding: theme.spacing.lg,
    borderRadius: theme.borderRadius.sm,
    border: `1px dashed ${theme.colors.border}`,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  cartList: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.md,
    marginBlockEnd: theme.spacing.xl,
  },
  cartItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    boxShadow: '0 8px 20px rgba(15, 23, 42, 0.06)',
  },
  cartItemHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  cartItemHeaderLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.xs,
  },
  cartItemName: {
    fontSize: '1.1rem',
    fontWeight: 'bold',
    color: theme.colors.primary,
  },
  cartItemActions: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing.md,
    flexWrap: 'wrap',
  },
  cartItemOptions: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.xs,
    color: theme.colors.textSecondary,
    fontSize: '0.9rem',
  },
  cartOption: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  quantityControl: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.card || theme.colors.surface || theme.colors.background,
    borderRadius: theme.borderRadius.sm,
    border: `1px solid ${theme.colors.border}`,
    padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
  },
  quantityButton: {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: '1.25rem',
    lineHeight: 1,
    padding: theme.spacing.xs,
    color: theme.colors.primary,
    '&:disabled': {
      color: theme.colors.disabled,
      cursor: 'not-allowed',
    },
  },
  quantityValue: {
    minWidth: '32px',
    textAlign: 'center',
    fontWeight: 'bold',
  },
  removeButton: {
    border: 'none',
    background: 'transparent',
    color: theme.colors.error,
    cursor: 'pointer',
    fontWeight: 'bold',
    transition: 'opacity 0.2s',
    '&:hover': {
      opacity: 0.8,
    },
  },
  cartSummary: {
    color: theme.colors.textSecondary,
    marginBlockEnd: theme.spacing.md,
  },
  cartTotals: {
    display: 'flex',
    justifyContent: 'space-between',
    fontWeight: 'bold',
    color: theme.colors.primary,
    marginBlockEnd: theme.spacing.md,
    fontSize: '1.05rem',
  },
  priceBadge: {
    fontWeight: 'bold',
    color: theme.colors.primary,
  },
  cartEmpty: {
    textAlign: 'center',
    color: theme.colors.textSecondary,
    marginBlockEnd: theme.spacing.xl,
  },
  cartFooter: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing.md,
    justifyContent: 'center',
  },
  primaryButton: {
    padding: `${theme.spacing.md} ${theme.spacing.lg}`,
    backgroundColor: theme.colors.primary,
    color: '#ffffff',
    border: 'none',
    borderRadius: theme.borderRadius.sm,
    fontSize: '1rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
    minWidth: '200px',
    '&:hover': {
      backgroundColor: theme.colors.secondary,
    },
    '&:disabled': {
      backgroundColor: theme.colors.disabled,
      cursor: 'not-allowed',
    },
  },
  secondaryButton: {
    padding: `${theme.spacing.md} ${theme.spacing.lg}`,
    backgroundColor: theme.colors.surface,
    color: theme.colors.primary,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.borderRadius.sm,
    fontSize: '1rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'background-color 0.2s, border-color 0.2s, color 0.2s',
    minWidth: '200px',
    '&:hover': {
      backgroundColor: theme.colors.card || theme.colors.surface || theme.colors.background,
      borderColor: theme.colors.primary,
      color: theme.colors.primary,
    },
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
    '&:disabled': {
      backgroundColor: theme.colors.disabled,
      cursor: 'not-allowed',
    },
  },
  mealHint: {
    color: theme.colors.textSecondary,
    fontSize: '0.95rem',
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
    cartFooter: {
      flexDirection: 'column',
      alignItems: 'stretch',
    },
    primaryButton: {
      width: '100%',
      minWidth: 'auto',
    },
    secondaryButton: {
      width: '100%',
      minWidth: 'auto',
    },
  },
});


const meals = [
  {
    id: 'hamburger',
    name: 'hamburger',
    image: '/resources/images/hamburger.png',
    instagramUrl: 'https://www.instagram.com/reel/DNxrviKXmm5/?igsh=MW9kM3Y1MTJqbHViNw==',
  },
  {
    id: 'schnitzel',
    name: 'schnitzel',
    image: '/resources/images/schnitzel.png',
    instagramUrl: 'https://www.instagram.com/reel/DNxrviKXmm5/?igsh=MW9kM3Y1MTJqbHViNw==',
  },
  {
    id: 'chickenSalad',
    name: 'chickenSalad',
    image: '/resources/images/ironsalad.png',
    instagramUrl: 'https://www.instagram.com/reel/DNxrviKXmm5/?igsh=MW9kM3Y1MTJqbHViNw==',
  },
  {
    id: 'pasta',
    name: 'pasta',
    image: '/resources/images/bolognese.png',
    instagramUrl: 'https://www.instagram.com/reel/DNxrviKXmm5/?igsh=MW9kM3Y1MTJqbHViNw==',
  },
];

const formatCurrency = (value) => Number(value || 0).toFixed(2);

const createOrderId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const random = Math.floor(Math.random() * 1_000_000);
  return `order-${Date.now()}-${random}`;
};

const EataliaBSRPage = () => {
  useGlobalStyles();
  const classes = useStyles();
  const { t, i18n } = useTranslation();

  const [step, setStep] = useState('welcome'); // welcome, cart, meal, location, payment, thankYou
  const [selectedMeal, setSelectedMeal] = useState(null);
  const [locationData, setLocationData] = useState(null);
  const [groupName, setGroupName] = useState('');
  const [cartItems, setCartItems] = useState([]);
  const [optionsDialog, setOptionsDialog] = useState({ open: false, mealId: null, fromStep: null });
  const [policyDialog, setPolicyDialog] = useState({
    open: false,
    type: null,
    content: '',
    loading: false,
    error: null,
  });
  const [orderId, setOrderId] = useState(null);
  const [approvalNo, setApprovalNo] = useState(null);
  const [mealOptionsConfig, setMealOptionsConfig] = useState({});
  const [mealOptionsLoading, setMealOptionsLoading] = useState(true);
  const [mealOptionsError, setMealOptionsError] = useState(null);
  const [beecommMetadata, setBeecommMetadata] = useState(null);
  const [dynamicMeals, setDynamicMeals] = useState([]);
  const [dishImagesMap, setDishImagesMap] = useState({});
  const [ordersEnabled, setOrdersEnabled] = useState(null); // null = checking, true = enabled, false = disabled
  
  // Check if orders are enabled
  useEffect(() => {
    const checkOrdersEnabled = async () => {
      try {
        const response = await fetch('/api/orders-enabled');
        if (response.ok) {
          const data = await response.json();
          setOrdersEnabled(data.enabled);
        } else {
          // If endpoint fails, assume disabled for safety
          setOrdersEnabled(false);
        }
      } catch (error) {
        console.error('Error checking orders status:', error);
        // If check fails, assume disabled for safety
        setOrdersEnabled(false);
      }
    };
    
    checkOrdersEnabled();
  }, []);
  
  // Load dish images map from public folder
  useEffect(() => {
    const loadDishImagesMap = async () => {
      try {
        const response = await fetch('/dish-images-map.json');
        console.log('Fetch response status:', response.status, response.statusText);
        if (response.ok) {
          const text = await response.text();
          console.log('Raw JSON text:', text);
          try {
            const imagesMap = JSON.parse(text);
            console.log('✅ Dish Images Map loaded:', imagesMap);
            console.log('Number of entries:', Object.keys(imagesMap).length);
            console.log('Keys:', Object.keys(imagesMap));
            setDishImagesMap(imagesMap);
          } catch (parseError) {
            console.error('❌ JSON parse error:', parseError);
            setDishImagesMap({});
          }
        } else {
          console.warn('⚠️ Could not load dish images map, status:', response.status);
          setDishImagesMap({});
        }
      } catch (error) {
        console.error('❌ Error loading dish images map:', error);
        setDishImagesMap({});
      }
    };
    
    loadDishImagesMap();
  }, []);

  const getMealConfig = (mealId) => mealOptionsConfig[mealId] || null;

  // Helper to find meal in either dynamic or hardcoded meals
  const findMeal = (mealId) => {
    const allMeals = dynamicMeals.length > 0 ? dynamicMeals : meals;
    return allMeals.find((m) => m.id === mealId);
  };

  const getMealDisplayName = (mealId) => {
    // First try to find in dynamic meals (from beecomm menu)
    const dynamicMeal = dynamicMeals.find((m) => m.id === mealId);
    if (dynamicMeal) {
      const metadata = beecommMetadata?.dishMappings?.[mealId];
      if (metadata) {
        const lang = i18n.language || 'he';
        return metadata.nameTranslate?.[lang] || metadata.dishName || mealId;
      }
      return mealId;
    }
    // Fallback to hardcoded meals
    const meal = meals.find((m) => m.id === mealId);
    return meal ? t(`meal.${meal.name}`) : mealId;
  };

  const serializeSelections = (selections) =>
    Object.entries(selections)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([groupId, optionIds]) => `${groupId}:${optionIds.slice().sort().join('|')}`)
      .join(';');

  const cloneSelections = (selections) =>
    Object.fromEntries(Object.entries(selections).map(([groupId, optionIds]) => [groupId, [...optionIds]]));

  const calculateItemPrice = (mealId, selections) => {
    const config = getMealConfig(mealId);
    const base = config?.basePrice ?? 0;
    if (!config) {
      return { base, options: 0, total: base };
    }
    const optionsTotal = config.groups.reduce((sum, group) => {
      const selected = selections[group.id] || [];
      const groupSum = selected.reduce((acc, optionId) => {
        const option = group.options.find((opt) => opt.id === optionId);
        return option ? acc + (option.price || 0) : acc;
      }, 0);
      return sum + groupSum;
    }, 0);
    return {
      base,
      options: optionsTotal,
      total: base + optionsTotal,
    };
  };

  const getSelectionDetails = (mealId, selections) => {
    const config = getMealConfig(mealId);
    if (!config) return [];
    return config.groups.flatMap((group) => {
      const selectedIds = selections[group.id] || [];
      if (!selectedIds.length) {
        return [];
      }
      return selectedIds
        .map((optionId) => {
          const option = group.options.find((opt) => opt.id === optionId);
          if (!option) {
            return null;
          }
          return {
            groupId: group.id,
            optionId,
            groupTitle: group.title[i18n.language] || group.title.en,
            optionLabel: option.label[i18n.language] || option.label.en,
            price: option.price || 0,
          };
        })
        .filter(Boolean);
    });
  };

  const totalMealsCount = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.quantity, 0),
    [cartItems]
  );

  const cartTotal = useMemo(
    () =>
      cartItems.reduce((sum, item) => {
        const priceInfo = calculateItemPrice(item.id, item.selections || {});
        const unitPrice = item.unitPrice ?? priceInfo.total;
        return sum + unitPrice * item.quantity;
      }, 0),
    [cartItems]
  );

  const totalInAgorot = useMemo(
    () => Math.max(0, Math.round(Number(cartTotal || 0) * 100)),
    [cartTotal]
  );

  const mealOptionsTexts = useMemo(
    () => ({
      title: t('mealOptions.title'),
      confirm: t('mealOptions.confirm'),
      cancel: t('mealOptions.cancel'),
      required: t('mealOptions.required'),
      optional: t('mealOptions.optional'),
      limit: (count) => t('mealOptions.limit', { count }),
      price: (amount) => t('mealOptions.price', { amount: formatCurrency(amount) }),
      total: t('mealOptions.total'),
    }),
    [t]
  );

  const pelecardLanguage = useMemo(() => {
    const lang = (i18n.language || 'he').toString();
    return lang.slice(0, 2).toUpperCase();
  }, [i18n.language]);

  const handleMealSelect = (mealId) => {
    setSelectedMeal(mealId);
    trackEvent('meal_selected', { meal: mealId });
    const config = getMealConfig(mealId);
    if (!config) {
      handleMealOptionsConfirm({
        mealId,
        selections: {},
        price: calculateItemPrice(mealId, {}),
        key: '',
      });
      return;
    }
    setOptionsDialog({ open: true, mealId, fromStep: step });
  };

  const handleInstagramOpen = (mealId) => {
    const meal = findMeal(mealId);
    if (meal && meal.instagramUrl) {
      window.open(meal.instagramUrl, '_blank', 'noopener,noreferrer');
      trackEvent('instagram_opened', { meal: mealId });
    }
  };

  const handleMealOptionsConfirm = ({ mealId, selections, price, key }) => {
    const itemKey = `${mealId}::${key}`;
    const selectionCopy = cloneSelections(selections);
    const priceInfo = price || calculateItemPrice(mealId, selections);
    setCartItems((prev) => {
      const existingIndex = prev.findIndex((item) => item.key === itemKey);
      if (existingIndex !== -1) {
        const next = [...prev];
        next[existingIndex] = {
          ...next[existingIndex],
          quantity: next[existingIndex].quantity + 1,
        };
        return next;
      }
      return [
        ...prev,
        {
          key: itemKey,
          id: mealId,
          quantity: 1,
          selections: selectionCopy,
          unitPrice: priceInfo.total,
          basePrice: priceInfo.base,
          optionsPrice: priceInfo.options,
        },
      ];
    });
    setOptionsDialog({ open: false, mealId: null, fromStep: null });
    setSelectedMeal(null);
    setStep('cart');
    trackEvent('meal_added_to_cart', { meal: mealId, selections, price: priceInfo.total });
  };

  const handleMealOptionsCancel = () => {
    const { mealId, fromStep } = optionsDialog;
    setOptionsDialog({ open: false, mealId: null, fromStep: null });
    setSelectedMeal(null);
    // Navigate back to the step where the dialog was opened from
    if (fromStep) {
      setStep(fromStep);
    }
    if (mealId) {
      trackEvent('meal_customization_cancelled', { meal: mealId });
    }
  };

  const handleQuantityChange = (itemKey, delta) => {
    const currentItem = cartItems.find((item) => item.key === itemKey);
    if (!currentItem) {
      return;
    }
    const nextQuantity = currentItem.quantity + delta;
    setCartItems((prev) =>
      prev
        .map((item) =>
          item.key === itemKey ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item
        )
        .filter((item) => item.quantity > 0)
    );
    trackEvent(delta > 0 ? 'cart_quantity_increased' : 'cart_quantity_decreased', {
      itemKey,
      meal: currentItem.id,
      quantity: Math.max(nextQuantity, 0),
    });
  };

  const handleRemoveFromCart = (itemKey) => {
    const currentItem = cartItems.find((item) => item.key === itemKey);
    setCartItems((prev) => prev.filter((item) => item.key !== itemKey));
    if (currentItem) {
      trackEvent('meal_removed', { meal: currentItem.id, itemKey });
    }
  };

  const handleIframeReady = (url) => {
    if (!orderId) {
      return;
    }
    trackEvent('pelecard_iframe_ready', { orderId, url });
  };

  const handleIframeError = (err) => {
    trackEvent('pelecard_iframe_error', {
      orderId,
      message: err?.message || 'unknown',
    });
  };

  const handleLocationSubmit = (data) => {
    const payload = { ...data, groupName };
    const newOrderId = createOrderId();
    setOrderId(newOrderId);
    setLocationData(payload);
    trackEvent('location_completed', { ...payload, orderId: newOrderId });
    setStep('payment');
    trackEvent('payment_step_opened', {
      orderId: newOrderId,
      cart: cartItems,
      total: cartTotal,
    });
  };

  const handleRestart = () => {
    setStep('welcome');
    setSelectedMeal(null);
    setLocationData(null);
    setGroupName('');
    setCartItems([]);
    setOptionsDialog({ open: false, mealId: null, fromStep: null });
    setOrderId(null);
    setApprovalNo(null);
  };

  const getMealName = (mealId) => {
    const meal = findMeal(mealId);
    if (meal) {
      // Check if it's a dynamic meal with metadata
      const metadata = beecommMetadata?.dishMappings?.[mealId];
      if (metadata) {
        const lang = i18n.language || 'he';
        return metadata.nameTranslate?.[lang] || metadata.dishName || '';
      }
      // Fallback to translation
      return t(`meal.${meal.name}`);
    }
    return '';
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
    // Load meal options on component mount
    const loadMealOptions = async () => {
      try {
        setMealOptionsLoading(true);
        setMealOptionsError(null);
        const response = await fetch('/api/meal-options');
        if (!response.ok) {
          throw new Error('Failed to load meal options');
        }
        const data = await response.json();
        setMealOptionsConfig(data);
        
        // Generate dynamic meals from menu keys
        const menuKeys = Object.keys(data);
        const generatedMeals = menuKeys.map((key) => {
          // Try to load beecomm metadata for this dish
          return {
            id: key,
            name: key, // Will be updated when metadata loads
            image: null, // Will be resolved using 3-layer system
            instagramUrl: null,
          };
        });
        setDynamicMeals(generatedMeals);
        
        // Try to load beecomm metadata for names and images
        try {
          const metadataResponse = await fetch('/api/beecomm-metadata');
          if (metadataResponse.ok) {
            const metadata = await metadataResponse.json();
            setBeecommMetadata(metadata);
            
            // Update meals with metadata
            const updatedMeals = generatedMeals.map((meal) => {
              const dishData = metadata.dishMappings?.[meal.id];
              const menuImage = dishData?.imagePath || null;
              // Image will be resolved in render using resolveDishImage
              if (dishData) {
                return {
                  ...meal,
                  name: dishData.dishName || meal.id,
                  image: menuImage, // Menu image (Layer 1), will be resolved with imagesMap (Layer 2) and default (Layer 3) in component
                  description: dishData.description || null, // Add description from metadata
                };
              }
              return {
                ...meal,
                image: null, // Will be resolved using imagesMap (Layer 2) and default (Layer 3)
                description: null,
              };
            });
            setDynamicMeals(updatedMeals);
          }
        } catch (metadataError) {
          console.warn('Could not load beecomm metadata:', metadataError);
          // Continue without metadata
        }
      } catch (error) {
        console.error('Error loading meal options:', error);
        setMealOptionsError(error.message);
      } finally {
        setMealOptionsLoading(false);
      }
    };

    loadMealOptions();
  }, []);

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

  // Listen for payment success messages from Pelecard iframe
  useEffect(() => {
    const handleMessage = (event) => {
      // Accept messages from any origin (since iframe is from Pelecard domain)
      // In production, you might want to validate event.origin
      if (event.data && event.data.type === 'pelecard_payment_success') {
        console.log('[eatalia-bsr] Received payment success message:', event.data);
        
        const { approvalNo: receivedApprovalNo, statusCode, userKey } = event.data;
        
        // Verify status code is success (000)
        if (statusCode === '000' || !statusCode) {
          // Store approval number
          setApprovalNo(receivedApprovalNo || '');
          
          // Move to thank you step
          setStep('thankYou');
          
          // Track the completion
          trackEvent('payment_completed', {
            orderId: userKey || orderId,
            approvalNo: receivedApprovalNo,
            statusCode: statusCode,
          });
        } else {
          console.warn('[eatalia-bsr] Payment status code indicates failure:', statusCode);
          trackEvent('payment_failed', {
            orderId: userKey || orderId,
            statusCode: statusCode,
          });
        }
      }
    };

    window.addEventListener('message', handleMessage);
    
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [orderId]);

  // Show coming soon page if orders are disabled
  if (ordersEnabled === false) {
    return <ComingSoon />;
  }
  
  // Show loading state while checking
  if (ordersEnabled === null) {
    return (
      <div className={classes.container}>
        <div style={{ textAlign: 'center', padding: theme.spacing.xxl, color: theme.colors.text }}>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={classes.container}>
      <img
        fetchPriority="high"
        src="/resources/images/logo.avif"
        alt="מתחם EATALIA - לוגו"
        style={{ objectFit: 'cover' }}
        className={classes.logo}
        width="242"
        height="149"
      />
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

        {step === 'cart' && (
          <div className={classes.section}>
            <h1 className={classes.title}>{t('cart.title')}</h1>
            {cartItems.length > 0 && (
              <>
                <p className={classes.cartSummary}>
                  {t('cart.totalMeals', { count: totalMealsCount })}
                </p>
                <div className={classes.cartTotals}>
                  <span>{t('cart.total')}</span>
                  <span>{formatCurrency(cartTotal)}₪</span>
                </div>
              </>
            )}
            {cartItems.length === 0 ? (
              <p className={classes.cartEmpty}>{t('cart.empty')}</p>
            ) : (
              <div className={classes.cartList}>
                {cartItems.map((item) => {
                  const meal = findMeal(item.id);
                  const selectionDetails = getSelectionDetails(item.id, item.selections || {});
                  const priceInfo = calculateItemPrice(item.id, item.selections || {});
                  const unitPrice = item.unitPrice ?? priceInfo.total;
                  const itemTotal = unitPrice * item.quantity;
                  const mealDisplayName = getMealDisplayName(item.id);
                  return (
                    <div key={item.key} className={classes.cartItem}>
                      <div className={classes.cartItemHeader}>
                        <div className={classes.cartItemHeaderLeft}>
                          <span className={classes.cartItemName}>
                            {mealDisplayName}
                          </span>
                          <span className={classes.priceBadge}>
                            {t('cart.itemPrice', { price: formatCurrency(itemTotal) })}
                          </span>
                        </div>
                        <button
                          type="button"
                          className={classes.removeButton}
                          onClick={() => handleRemoveFromCart(item.key)}
                        >
                          {t('cart.remove')}
                        </button>
                      </div>
                      {selectionDetails.length > 0 && (
                        <div className={classes.cartItemOptions}>
                          <span className={classes.priceBadge}>{t('cart.options')}</span>
                          {selectionDetails.map((detail) => (
                            <div
                              key={`${detail.groupId}-${detail.optionId}`}
                              className={classes.cartOption}
                            >
                              <span>
                                {detail.groupTitle}: {detail.optionLabel}
                              </span>
                              {detail.price > 0 && <span>+{formatCurrency(detail.price)}₪</span>}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className={classes.cartItemActions}>
                        <div className={classes.quantityControl}>
                          <button
                            type="button"
                            className={classes.quantityButton}
                            onClick={() => handleQuantityChange(item.key, -1)}
                            disabled={item.quantity <= 1}
                            aria-label={`${t('cart.quantity')} -`}
                          >
                            –
                          </button>
                          <span className={classes.quantityValue}>{item.quantity}</span>
                          <button
                            type="button"
                            className={classes.quantityButton}
                            onClick={() => handleQuantityChange(item.key, 1)}
                            aria-label={`${t('cart.quantity')} +`}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className={classes.cartFooter}>
              <button
                type="button"
                className={classes.secondaryButton}
                onClick={() => {
                  setSelectedMeal(null);
                  setStep('meal');
                  trackEvent('cart_add_meal_clicked', {});
                }}
              >
                {t('cart.addMeal')}
              </button>
              <button
                type="button"
                className={classes.primaryButton}
                disabled={cartItems.length === 0}
                onClick={() => {
                  trackEvent('cart_checkout_clicked', { cart: cartItems, total: cartTotal });
                  setStep('location');
                }}
              >
                {t('cart.checkout')}
              </button>
            </div>
          </div>
        )}

        {step === 'meal' && (
          <div className={classes.section}>
            <h1 className={classes.title}>{t('meal.title')}</h1>
            <div className={classes.mealGrid}>
              {(() => {
                // Log all dish IDs that need to be added to images map
                const allMeals = dynamicMeals.length > 0 ? dynamicMeals : meals;
                const allMealIds = allMeals.map(m => m.id);
                const missingIds = allMealIds.filter(id => !dishImagesMap[id]);
                if (missingIds.length > 0) {
                  console.group('📋 MISSING DISH IDs - Add these to public/dish-images-map.json:');
                  missingIds.forEach(id => {
                    const meal = allMeals.find(m => m.id === id);
                    const displayName = meal ? getMealDisplayName(id) : id;
                    console.log(`  "${id}": "IMAGE_URL_HERE", // ${displayName}`);
                  });
                  console.groupEnd();
                  
                  // Generate example JSON
                  const exampleJson = missingIds.reduce((acc, id) => {
                    const meal = allMeals.find(m => m.id === id);
                    const displayName = meal ? getMealDisplayName(id) : id;
                    // Use appropriate default image based on dish type
                    let defaultImage = '/resources/images/hamburger.png';
                    if (displayName.toLowerCase().includes('schnitzel')) {
                      defaultImage = '/resources/images/schnitzel.png';
                    } else if (displayName.toLowerCase().includes('salad')) {
                      defaultImage = '/resources/images/ironsalad.png';
                    } else if (displayName.toLowerCase().includes('pasta')) {
                      defaultImage = '/resources/images/bolognese.png';
                    }
                    acc[id] = defaultImage;
                    return acc;
                  }, {});
                  console.log('💡 Copy this JSON and add to dish-images-map.json:', JSON.stringify(exampleJson, null, 2));
                } else {
                  console.log('✅ All dish IDs are in the images map!');
                }
                return null;
              })()}
              {(dynamicMeals.length > 0 ? dynamicMeals : meals).map((meal) => {
                const displayName = getMealDisplayName(meal.id);
                // Resolve image using 3-layer system: menu image -> images map (by dish ID) -> default
                // The images map should be keyed by API dish IDs
                const resolvedImage = resolveDishImage(meal.id, meal.image, dishImagesMap);
                // Get base price for the meal
                const priceInfo = calculateItemPrice(meal.id, {});
                const basePrice = priceInfo.base;
                // Debug: Log image resolution for all meals
                console.log(`🍽️ Image resolution for DISH ID: "${meal.id}" (Display Name: "${displayName}"):`, {
                  dishId: meal.id,
                  displayName: displayName,
                  isDynamicMeal: dynamicMeals.length > 0,
                  mealImage: meal.image,
                  imagesMapHasKey: !!dishImagesMap[meal.id],
                  imagesMapValue: dishImagesMap[meal.id],
                  resolvedImage: resolvedImage,
                  needsToBeAdded: !dishImagesMap[meal.id] ? `⚠️ ADD THIS ID TO dish-images-map.json: "${meal.id}"` : '✅ ID exists in map'
                });
                return (
                  <MealCard
                    key={meal.id}
                    meal={{
                      ...meal,
                      name: displayName,
                      image: resolvedImage,
                    }}
                    selected={selectedMeal === meal.id}
                    disabled={selectedMeal !== null && selectedMeal !== meal.id}
                    onSelect={handleMealSelect}
                    onInstagram={handleInstagramOpen}
                    imagesMap={dishImagesMap}
                    price={basePrice}
                  />
                );
              })}
            </div>
            <div className={classes.mealFooter}>
              {cartItems.length > 0 ? (
                <button
                  type="button"
                  className={classes.secondaryButton}
                  onClick={() => {
                    setStep('cart');
                    trackEvent('back_to_cart_clicked', { fromStep: 'meal' });
                  }}
                >
                  {t('meal.backToCart')}
                </button>
              ) : (
                <span className={classes.mealHint}>{t('meal.selectMeal')}</span>
              )}
            </div>
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
              <div className={classes.paymentSummary}>
                <span>{t('cart.total')}</span>
                <span>{`${formatCurrency(cartTotal)}₪`}</span>
              </div>
              <div className={classes.paymentDetails}>
                {t('payment.secureCheckout', {
                  defaultValue: 'Complete your payment securely below.',
                })}
              </div>
              {orderId ? (
                <PelecardIframe
                  orderId={orderId}
                  total={totalInAgorot}
                  currency="1"
                  language={pelecardLanguage}
                  className={classes.paymentIframeWrapper}
                  onReady={handleIframeReady}
                  onError={handleIframeError}
                  orderData={{
                    cartItems: cartItems.map((item) => ({
                      id: item.id,
                      key: item.key,
                      quantity: item.quantity,
                      selections: item.selections || {},
                      unitPrice: item.unitPrice || 0,
                      basePrice: item.basePrice || 0,
                      optionsPrice: item.optionsPrice || 0,
                    })),
                    locationData: locationData || {},
                    menuRevision: beecommMetadata?.menuRevision || '',
                    total: cartTotal,
                    orderId: orderId,
                  }}
                />
              ) : (
                <div className={classes.paymentFallback}>
                  {t('payment.missingOrder', {
                    defaultValue: 'Please complete the previous steps to generate a payment session.',
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {step === 'thankYou' && (
          <ThankYou
            orderData={{
              meals: cartItems.map((item) => {
                const priceInfo = calculateItemPrice(item.id, item.selections || {});
                const unitPrice = item.unitPrice ?? priceInfo.total;
                return {
                  id: item.id,
                  name: getMealName(item.id),
                  quantity: item.quantity,
                  unitPrice,
                  totalPrice: unitPrice * item.quantity,
                  options: getSelectionDetails(item.id, item.selections || {}),
                };
              }),
              total: cartTotal,
              groupName,
              approvalNo: approvalNo,
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

      <MealOptionsDialog
        open={optionsDialog.open}
        meal={
          optionsDialog.open
            ? {
                id: optionsDialog.mealId,
                displayName: getMealDisplayName(optionsDialog.mealId),
                description: beecommMetadata?.dishMappings?.[optionsDialog.mealId]?.description || null,
                descriptionTranslate: beecommMetadata?.dishMappings?.[optionsDialog.mealId]?.descriptionTranslate || null,
              }
            : null
        }
        config={optionsDialog.open ? getMealConfig(optionsDialog.mealId) : null}
        language={i18n.language}
        texts={mealOptionsTexts}
        onConfirm={handleMealOptionsConfirm}
        onCancel={handleMealOptionsCancel}
        metadata={beecommMetadata}
      />

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

