import React from 'react';
import { createPortal } from 'react-dom';
import { createUseStyles } from 'react-jss';
import { theme } from '../styles/theme.js';

const useStyles = createUseStyles({
  backdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200,
  },
  dialog: {
    backgroundColor: '#ffffff',
    borderRadius: theme.borderRadius.md,
    width: 'min(90vw, 720px)',
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 12px 30px rgba(0, 0, 0, 0.2)',
  },
  header: {
    padding: `${theme.spacing.md} ${theme.spacing.lg}`,
    borderBottom: `1px solid ${theme.colors.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  title: {
    margin: 0,
    fontSize: '1.25rem',
    color: theme.colors.primary,
  },
  closeButton: {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: '1rem',
    color: theme.colors.textSecondary,
    padding: theme.spacing.xs,
    '&:hover': {
      color: theme.colors.primary,
    },
  },
  body: {
    padding: theme.spacing.lg,
    overflowY: 'auto',
  },
  content: {
    '& h1, & h2, & h3': {
      color: theme.colors.primary,
    },
    '& p': {
      marginBlockEnd: theme.spacing.md,
      lineHeight: 1.6,
    },
  },
  message: {
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
});

const dialogRootId = 'policy-dialog-root';

const ensureDialogRoot = () => {
  let root = document.getElementById(dialogRootId);
  if (!root) {
    root = document.createElement('div');
    root.id = dialogRootId;
    document.body.appendChild(root);
  }
  return root;
};

export const PolicyDialog = ({ open, title, content, loading, error, onClose, closeLabel }) => {
  const classes = useStyles();

  if (!open) {
    return null;
  }

  const dialogContent = (
    <div className={classes.backdrop} role="dialog" aria-modal="true" aria-labelledby="policy-dialog-title">
      <div className={classes.dialog}>
        <div className={classes.header}>
          <h2 id="policy-dialog-title" className={classes.title}>
            {title}
          </h2>
          <button type="button" className={classes.closeButton} onClick={onClose} aria-label={closeLabel}>
            ✕
          </button>
        </div>
        <div className={classes.body}>
          {loading && <p className={classes.message}>{loading}</p>}
          {error && !loading && <p className={classes.message}>{error}</p>}
          {!loading && !error && (
            <div className={classes.content} dangerouslySetInnerHTML={{ __html: content }} />
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(dialogContent, ensureDialogRoot());
};


