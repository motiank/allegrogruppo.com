import React from 'react';
import { createUseStyles } from 'react-jss';
import { useTranslation } from 'react-i18next';
import { theme } from '../styles/index.js';

const useStyles = createUseStyles({
  container: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: '#ffffff',
    textAlign: 'center',
  },
  content: {
    maxWidth: '600px',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing.xl,
  },
  chefIcon: {
    width: '200px',
    height: '200px',
    animation: '$float 3s ease-in-out infinite',
    filter: 'drop-shadow(0 10px 30px rgba(0, 0, 0, 0.3))',
  },
  '@keyframes float': {
    '0%, 100%': {
      transform: 'translateY(0px)',
    },
    '50%': {
      transform: 'translateY(-20px)',
    },
  },
  title: {
    fontSize: '2.5rem',
    fontWeight: 'bold',
    margin: 0,
    textShadow: '0 2px 10px rgba(0, 0, 0, 0.2)',
  },
  message: {
    fontSize: '1.25rem',
    lineHeight: 1.6,
    opacity: 0.95,
    margin: 0,
  },
  subtitle: {
    fontSize: '1rem',
    opacity: 0.85,
    margin: 0,
    fontStyle: 'italic',
  },
  '@media (max-width: 768px)': {
    container: {
      padding: theme.spacing.lg,
    },
    chefIcon: {
      width: '150px',
      height: '150px',
    },
    title: {
      fontSize: '2rem',
    },
    message: {
      fontSize: '1.1rem',
    },
  },
});

// Chef SVG Icon - Working chef with hat and utensils
const ChefIcon = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 200 200"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    {/* Chef Hat */}
    <ellipse cx="100" cy="40" rx="50" ry="25" fill="#ffffff" />
    <rect x="60" y="40" width="80" height="15" fill="#ffffff" />
    
    {/* Chef Head */}
    <circle cx="100" cy="70" r="30" fill="#ffdbac" />
    
    {/* Eyes */}
    <circle cx="92" cy="68" r="3" fill="#000000" />
    <circle cx="108" cy="68" r="3" fill="#000000" />
    
    {/* Smile */}
    <path
      d="M 90 78 Q 100 85 110 78"
      stroke="#000000"
      strokeWidth="2"
      fill="none"
      strokeLinecap="round"
    />
    
    {/* Mustache */}
    <path
      d="M 85 75 Q 100 80 115 75"
      stroke="#000000"
      strokeWidth="3"
      fill="none"
      strokeLinecap="round"
    />
    
    {/* Body/Apron */}
    <path
      d="M 70 100 L 70 160 L 130 160 L 130 100 Q 130 90 120 90 L 80 90 Q 70 90 70 100 Z"
      fill="#ffffff"
    />
    
    {/* Left Arm with Spoon */}
    <path
      d="M 70 110 L 50 130 L 45 125"
      stroke="#ffdbac"
      strokeWidth="8"
      fill="none"
      strokeLinecap="round"
    />
    <circle cx="42" cy="123" r="6" fill="#c0c0c0" />
    
    {/* Right Arm with Whisk */}
    <path
      d="M 130 110 L 150 130 L 155 125"
      stroke="#ffdbac"
      strokeWidth="8"
      fill="none"
      strokeLinecap="round"
    />
    <path
      d="M 155 120 L 160 115 L 162 120 L 160 125 L 155 120"
      stroke="#c0c0c0"
      strokeWidth="3"
      fill="none"
    />
    <circle cx="160" cy="120" r="2" fill="#c0c0c0" />
    
    {/* Apron Details */}
    <path
      d="M 85 120 L 100 130 L 115 120"
      stroke="#e0e0e0"
      strokeWidth="2"
      fill="none"
    />
    <circle cx="100" cy="140" r="8" fill="#e0e0e0" />
    
    {/* Steam/Activity Lines */}
    <path
      d="M 50 50 L 45 40 M 55 50 L 50 40"
      stroke="#ffffff"
      strokeWidth="2"
      strokeLinecap="round"
      opacity="0.6"
    />
    <path
      d="M 145 50 L 150 40 M 150 50 L 155 40"
      stroke="#ffffff"
      strokeWidth="2"
      strokeLinecap="round"
      opacity="0.6"
    />
  </svg>
);

export const ComingSoon = ({ statusMessage, state }) => {
  const classes = useStyles();
  const { t } = useTranslation();

  // Use custom status message if provided, otherwise use default translations
  const title = statusMessage?.title || t('comingSoon.title');
  const message = statusMessage?.message || t('comingSoon.message');
  const subtitle = state === 'postponed' ? '' : (statusMessage?.subtitle || t('comingSoon.subtitle'));

  return (
    <div className={classes.container}>
      <div className={classes.content}>
        <ChefIcon className={classes.chefIcon} />
        <h1 className={classes.title}>{title}</h1>
        <p className={classes.message}>{message}</p>
        {subtitle && <p className={classes.subtitle}>{subtitle}</p>}
      </div>
    </div>
  );
};



