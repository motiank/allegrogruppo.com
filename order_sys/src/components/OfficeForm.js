import React, { useState } from 'react';
import { createUseStyles } from 'react-jss';
import { useTranslation } from 'react-i18next';
import { theme } from '../styles/index.js';
import { 
  validateLocationForm, 
  validateName, 
  validateBuilding, 
  validateFloor, 
  validateOffice, 
  validatePhone 
} from '../utils/validations.js';

const useStyles = createUseStyles({
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.lg,
    maxWidth: '500px',
    margin: '0 auto',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.sm,
  },
  label: {
    fontWeight: 'bold',
    textAlign: 'start',
  },
  required: {
    color: '#ff4444',
    marginInlineStart: theme.spacing.xs,
  },
  errorMessage: {
    fontSize: '0.75rem',
    color: '#ff4444',
    marginBlockStart: theme.spacing.xs,
    textAlign: 'start',
  },
  input: {
    padding: theme.spacing.md,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.borderRadius.sm,
    fontSize: '1rem',
    color: '#ffffff',
    backgroundColor: 'transparent',
    '&:focus': {
      outline: 'none',
      borderColor: theme.colors.primary,
      boxShadow: theme.boxStyles?.shadow?.glow || `0 0 0 3px ${theme.colors.primary}26`,
    },
    '&::placeholder': {
      color: 'rgba(255, 255, 255, 0.6)',
    },
    '&:-webkit-autofill': {
      WebkitTextFillColor: '#ffffff',
      WebkitBoxShadow: `0 0 0 1000px transparent inset`,
      transition: 'background-color 5000s ease-in-out 0s',
    },
    '&:-webkit-autofill:focus': {
      WebkitTextFillColor: '#ffffff',
      WebkitBoxShadow: `0 0 0 1000px transparent inset`,
    },
  },
  inputError: {
    borderColor: '#ff4444',
    '&:focus': {
      borderColor: '#ff4444',
      boxShadow: `0 0 0 3px rgba(255, 68, 68, 0.26)`,
    },
  },
  select: {
    padding: theme.spacing.md,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.borderRadius.sm,
    fontSize: '1rem',
    color: '#ffffff',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    '&:focus': {
      outline: 'none',
      borderColor: theme.colors.primary,
      boxShadow: theme.boxStyles?.shadow?.glow || `0 0 0 3px ${theme.colors.primary}26`,
    },
    '& option': {
      backgroundColor: theme.colors.surface || theme.colors.background,
      color: theme.colors.text,
    },
  },
  selectError: {
    borderColor: '#ff4444',
    '&:focus': {
      borderColor: '#ff4444',
      boxShadow: `0 0 0 3px rgba(255, 68, 68, 0.26)`,
    },
  },
  textarea: {
    minHeight: '120px',
    padding: theme.spacing.md,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.borderRadius.sm,
    fontSize: '1rem',
    color: '#ffffff',
    backgroundColor: 'transparent',
    resize: 'vertical',
    '&:focus': {
      outline: 'none',
      borderColor: theme.colors.primary,
      boxShadow: theme.boxStyles?.shadow?.glow || `0 0 0 3px ${theme.colors.primary}26`,
    },
    '&::placeholder': {
      color: 'rgba(255, 255, 255, 0.6)',
    },
  },
  button: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.primary,
    color: theme.colors.text || '#ffffff',
    border: 'none',
    borderRadius: theme.borderRadius.sm,
    fontSize: '1rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'background-color 0.2s, box-shadow 0.2s',
    '&:hover:not(:disabled)': {
      backgroundColor: theme.colors.secondary,
      boxShadow: theme.boxStyles?.shadow?.glow || `0 0 20px ${theme.colors.primary}40`,
    },
    '&:disabled': {
      backgroundColor: theme.colors.disabled,
      cursor: 'not-allowed',
      opacity: 0.5,
    },
  },
});

export const OfficeForm = ({ onSubmit }) => {
  const classes = useStyles();
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    name: '',
    building: '',
    floor: '',
    office: '',
    phone: '',
    notes: '',
  });
  const [touched, setTouched] = useState({
    name: false,
    building: false,
    floor: false,
    office: false,
    phone: false,
  });
  const [errors, setErrors] = useState({
    name: '',
    building: '',
    floor: '',
    office: '',
    phone: '',
  });

  const isValid = validateLocationForm(formData);

  const validateField = (field, value) => {
    let error = '';
    switch (field) {
      case 'name':
        if (!validateName(value)) {
          error = t('location.errors.name');
        }
        break;
      case 'building':
        if (!validateBuilding(value)) {
          error = t('location.errors.building');
        }
        break;
      case 'floor':
        if (!validateFloor(value)) {
          error = t('location.errors.floor');
        }
        break;
      case 'office':
        if (!validateOffice(value)) {
          error = t('location.errors.office');
        }
        break;
      case 'phone':
        if (!validatePhone(value)) {
          error = t('location.errors.phone');
        }
        break;
      default:
        break;
    }
    return error;
  };

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (touched[field] && errors[field]) {
      const error = validateField(field, value);
      setErrors((prev) => ({ ...prev, [field]: error }));
    }
  };

  const handleBlur = (field) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    const value = formData[field];
    const error = validateField(field, value);
    setErrors((prev) => ({ ...prev, [field]: error }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // Mark all fields as touched on submit
    const allTouched = {
      name: true,
      building: true,
      floor: true,
      office: true,
      phone: true,
    };
    setTouched(allTouched);
    
    // Validate all fields
    const allErrors = {
      name: validateField('name', formData.name),
      building: validateField('building', formData.building),
      floor: validateField('floor', formData.floor),
      office: validateField('office', formData.office),
      phone: validateField('phone', formData.phone),
    };
    setErrors(allErrors);

    if (isValid && onSubmit) {
      onSubmit(formData);
    }
  };

  return (
    <form className={classes.form} onSubmit={handleSubmit}>
      <div className={classes.field}>
        <label className={classes.label} htmlFor="name">
          {t('location.name')}
          <span className={classes.required}>*</span>
        </label>
        <input
          id="name"
          type="text"
          className={`${classes.input} ${touched.name && errors.name ? classes.inputError : ''}`}
          value={formData.name}
          onChange={(e) => handleChange('name', e.target.value)}
          onBlur={() => handleBlur('name')}
        />
        {touched.name && errors.name && (
          <div className={classes.errorMessage}>{errors.name}</div>
        )}
      </div>

      <div className={classes.field}>
        <label className={classes.label} htmlFor="building">
          {t('location.building')}
          <span className={classes.required}>*</span>
        </label>
        <select
          id="building"
          className={`${classes.select} ${touched.building && errors.building ? classes.selectError : ''}`}
          value={formData.building}
          onChange={(e) => handleChange('building', e.target.value)}
          onBlur={() => handleBlur('building')}
        >
          <option value="">{t('location.selectBuilding')}</option>
          <option value="C">C</option>
          <option value="I">I</option>
          <option value="T">T</option>
          <option value="Y">Y</option>
        </select>
        {touched.building && errors.building && (
          <div className={classes.errorMessage}>{errors.building}</div>
        )}
      </div>

      <div className={classes.field}>
        <label className={classes.label} htmlFor="floor">
          {t('location.floor')}
          <span className={classes.required}>*</span>
        </label>
        <input
          id="floor"
          type="number"
          className={`${classes.input} ${touched.floor && errors.floor ? classes.inputError : ''}`}
          value={formData.floor}
          onChange={(e) => handleChange('floor', e.target.value)}
          onBlur={() => handleBlur('floor')}
          min="1"
          max="100"
        />
        {touched.floor && errors.floor && (
          <div className={classes.errorMessage}>{errors.floor}</div>
        )}
      </div>

      <div className={classes.field}>
        <label className={classes.label} htmlFor="office">
          {t('location.office')}
          <span className={classes.required}>*</span>
        </label>
        <input
          id="office"
          type="text"
          className={`${classes.input} ${touched.office && errors.office ? classes.inputError : ''}`}
          value={formData.office}
          onChange={(e) => handleChange('office', e.target.value)}
          onBlur={() => handleBlur('office')}
        />
        {touched.office && errors.office && (
          <div className={classes.errorMessage}>{errors.office}</div>
        )}
      </div>

      <div className={classes.field}>
        <label className={classes.label} htmlFor="phone">
          {t('location.phone')}
          <span className={classes.required}>*</span>
        </label>
        <input
          id="phone"
          type="tel"
          className={`${classes.input} ${touched.phone && errors.phone ? classes.inputError : ''}`}
          value={formData.phone}
          onChange={(e) => handleChange('phone', e.target.value)}
          onBlur={() => handleBlur('phone')}
        />
        {touched.phone && errors.phone && (
          <div className={classes.errorMessage}>{errors.phone}</div>
        )}
      </div>

      <div className={classes.field}>
        <label className={classes.label} htmlFor="notes">
          {t('location.notes')}
        </label>
        <textarea
          id="notes"
          className={classes.textarea}
          value={formData.notes}
          onChange={(e) => handleChange('notes', e.target.value)}
          placeholder={t('location.notesPlaceholder')}
        />
      </div>

      <button type="submit" className={classes.button} disabled={!isValid}>
        {t('location.next')}
      </button>
    </form>
  );
};

