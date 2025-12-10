import React from 'react';
import { createRoot } from 'react-dom/client';
import { createUseStyles } from 'react-jss';
import { theme } from '../styles/theme.js';
import { useGlobalStyles } from '../styles/global.js';
import '../i18n/index.js';

const useStyles = createUseStyles({
  container: {
    minHeight: '100vh',
    padding: theme.spacing.xl,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: '2rem',
    marginBlockEnd: theme.spacing.xl,
    textAlign: 'center',
  },
  list: {
    listStyle: 'none',
    padding: 0,
  },
  listItem: {
    marginBlockEnd: theme.spacing.md,
  },
  link: {
    display: 'inline-block',
    padding: `${theme.spacing.md} ${theme.spacing.lg}`,
    backgroundColor: theme.colors.primary,
    color: '#ffffff',
    textDecoration: 'none',
    borderRadius: theme.borderRadius.md,
    transition: 'background-color 0.2s',
    '&:hover': {
      backgroundColor: theme.colors.secondary,
    },
  },
});

const IndexPage = () => {
  useGlobalStyles();
  const classes = useStyles();

  const landingPages = [
    { name: 'Eatalia BSR', path: '/eatalia-bsr.html' },
  ];

  return (
    <div className={classes.container}>
      <h1 className={classes.title}>Allegro Gruppo - Landing Pages</h1>
      <ul className={classes.list}>
        {landingPages.map((page) => (
          <li key={page.path} className={classes.listItem}>
            <a href={page.path} className={classes.link}>
              {page.name}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<IndexPage />);
}

