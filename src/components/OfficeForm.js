import React, { useState } from 'react';
import { createUseStyles } from 'react-jss';
import { useTranslation } from 'react-i18next';
import { theme } from '../styles/theme.js';
import { validateLocationForm } from '../utils/validations.js';

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
  input: {
    padding: theme.spacing.md,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.borderRadius.sm,
    fontSize: '1rem',
    '&:focus': {
      outline: 'none',
      borderColor: theme.colors.primary,
    },
  },
  select: {
    padding: theme.spacing.md,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.borderRadius.sm,
    fontSize: '1rem',
    backgroundColor: '#ffffff',
    cursor: 'pointer',
    '&:focus': {
      outline: 'none',
      borderColor: theme.colors.primary,
    },
  },
  button: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.primary,
    color: '#ffffff',
    border: 'none',
    borderRadius: theme.borderRadius.sm,
    fontSize: '1rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
    '&:hover:not(:disabled)': {
      backgroundColor: theme.colors.secondary,
    },
    '&:disabled': {
      backgroundColor: theme.colors.disabled,
      cursor: 'not-allowed',
    },
  },
});

export const OfficeForm = ({ onSubmit }) => {
  const classes = useStyles();
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    building: '',
    floor: '',
    office: '',
    phone: '',
  });

  const isValid = validateLocationForm(formData);

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isValid && onSubmit) {
      onSubmit(formData);
    }
  };

  return (
    <form className={classes.form} onSubmit={handleSubmit}>
      <div className={classes.field}>
        <label className={classes.label} htmlFor="building">
          {t('location.building')}
        </label>
        <select
          id="building"
          className={classes.select}
          value={formData.building}
          onChange={(e) => handleChange('building', e.target.value)}
        >
          <option value="">{t('location.selectBuilding')}</option>
          <option value="C">C</option>
          <option value="I">I</option>
          <option value="T">T</option>
          <option value="Y">Y</option>
        </select>
      </div>

      <div className={classes.field}>
        <label className={classes.label} htmlFor="floor">
          {t('location.floor')}
        </label>
        <input
          id="floor"
          type="number"
          className={classes.input}
          value={formData.floor}
          onChange={(e) => handleChange('floor', e.target.value)}
          min="1"
          max="100"
        />
      </div>

      <div className={classes.field}>
        <label className={classes.label} htmlFor="office">
          {t('location.office')}
        </label>
        <input
          id="office"
          type="text"
          className={classes.input}
          value={formData.office}
          onChange={(e) => handleChange('office', e.target.value)}
        />
      </div>

      <div className={classes.field}>
        <label className={classes.label} htmlFor="phone">
          {t('location.phone')}
        </label>
        <input
          id="phone"
          type="tel"
          className={classes.input}
          value={formData.phone}
          onChange={(e) => handleChange('phone', e.target.value)}
        />
      </div>

      <button type="submit" className={classes.button} disabled={!isValid}>
        {t('location.next')}
      </button>
    </form>
  );
};

