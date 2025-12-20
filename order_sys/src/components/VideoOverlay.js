import React, { useState, useEffect, useRef } from 'react';
import { createUseStyles } from 'react-jss';
import { theme } from '../styles/index.js';

const useStyles = createUseStyles({
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  container: {
    position: 'relative',
    maxWidth: '90%',
    maxHeight: '90%',
  },
  video: {
    maxWidth: '100%',
    maxHeight: '100%',
  },
  closeButton: {
    position: 'absolute',
    top: theme.spacing.md,
    insetInlineEnd: theme.spacing.md,
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    border: 'none',
    cursor: 'pointer',
    fontSize: '1.5rem',
    color: theme.colors.text || '#000000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    '&:hover': {
      backgroundColor: '#ffffff',
      opacity: 1,
    },
  },
});

export const VideoOverlay = ({ videoUrl, onClose }) => {
  const classes = useStyles();
  const [loaded, setLoaded] = useState(false);
  const videoRef = useRef(null);

  useEffect(() => {
    // Lazy load video when overlay opens
    if (videoUrl && videoRef.current) {
      videoRef.current.load();
      setLoaded(true);
    }
  }, [videoUrl]);

  const handleClose = () => {
    if (videoRef.current) {
      videoRef.current.pause();
    }
    if (onClose) {
      onClose();
    }
  };

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  if (!videoUrl) return null;

  return (
    <div className={classes.overlay} onClick={handleClose}>
      <div className={classes.container} onClick={(e) => e.stopPropagation()}>
        <button className={classes.closeButton} onClick={handleClose}>
          ×
        </button>
        <video
          ref={videoRef}
          className={classes.video}
          controls
          preload="none"
        >
          <source src={videoUrl} type="video/mp4" />
          Your browser does not support the video tag.
        </video>
      </div>
    </div>
  );
};

