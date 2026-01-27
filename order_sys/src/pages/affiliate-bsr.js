import React, { useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { createUseStyles } from 'react-jss';
import { theme, useGlobalStyles } from '../styles/index.js';

const useStyles = createUseStyles({
  page: {
    minHeight: '100vh',
    padding: theme.spacing.xl,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
    position: 'relative',
    overflow: 'hidden',
    '&::before': {
      content: '""',
      position: 'absolute',
      inset: 0,
      backgroundImage: "url('/resources/images/bolognese.png')",
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      filter: 'blur(10px)',
      transform: 'scale(1.05)',
    },
  },
  card: {
    maxWidth: 720,
    width: '100%',
    backgroundColor: 'transparent',
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.xxl,
    boxShadow: '0 18px 45px rgba(15, 23, 42, 0.16)',
    border: `1px solid ${theme.colors.border}`,
    textAlign: 'right',
    position: 'relative',
    zIndex: 1,
  },
  eyebrow: {
    fontSize: '0.9rem',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: '#ffffff',
    marginBottom: theme.spacing.sm,
  },
  title: {
    fontSize: '2.2rem',
    lineHeight: 1.2,
    marginBottom: theme.spacing.md,
    color: '#ffffff',
  },
  subtitle: {
    fontSize: '1.2rem',
    marginBottom: theme.spacing.lg,
    color: '#ffffff',
  },
  text: {
    fontSize: '1rem',
    color: '#ffffff',
    marginBottom: theme.spacing.md,
  },
  highlight: {
    fontWeight: 600,
    color: theme.colors.primary,
  },
  bullets: {
    listStyle: 'none',
    padding: 0,
    margin: `0 0 ${theme.spacing.lg}`,
  },
  bullet: {
    display: 'flex',
    alignItems: 'baseline',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
    color: '#ffffff',
    fontSize: '0.98rem',
  },
  bulletIcon: {
    width: 6,
    height: 6,
    borderRadius: '999px',
    backgroundColor: theme.colors.primary,
    marginTop: 4,
  },
  qrSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
  },
  qrWrapper: {
    width: 180,
    height: 180,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.card || theme.colors.surface,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.sm,
    border: `1px solid ${theme.colors.border}`,
  },
  qrImage: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
  },
  qrText: {
    fontSize: '0.95rem',
    color: '#ffffff',
    textAlign: 'center',
  },
  footer: {
    marginTop: theme.spacing.xl,
    fontSize: '0.8rem',
    color: '#ffffff',
  },
  bottomBar: {
    position: 'fixed',
    bottom: theme.spacing.md,
    left: theme.spacing.md,
    right: theme.spacing.md,
    display: 'flex',
    justifyContent: 'center',
    gap: theme.spacing.md,
    zIndex: 2,
  },
  bottomButton: {
    padding: `${theme.spacing.sm} ${theme.spacing.lg}`,
    borderRadius: theme.borderRadius.md,
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.95rem',
    fontWeight: 600,
    minWidth: 140,
  },
  printButton: {
    composes: '$bottomButton',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    color: '#ffffff',
  },
  shareButton: {
    composes: '$bottomButton',
    backgroundColor: '#25D366',
    color: '#ffffff',
  },
  '@media (max-width: 768px)': {
    page: {
      padding: `${theme.spacing.lg} ${theme.spacing.md}`,
    },
    card: {
      padding: theme.spacing.lg,
    },
    title: {
      fontSize: '1.8rem',
    },
    subtitle: {
      fontSize: '1.05rem',
    },
    qrWrapper: {
      width: 160,
      height: 160,
    },
  },
});

const buildAffiliateData = () => {
  if (typeof window === 'undefined') {
    return {
      affiliateCode: '',
      orderUrl: '',
      qrUrl: '',
    };
  }

  const params = new URLSearchParams(window.location.search);
  const rawCode = params.get('affc') || '';
  const affiliateCode = rawCode.trim().slice(0, 8);

  const baseOrderUrl = `${window.location.origin}/eatalia-bsr.html`;
  const orderUrl = affiliateCode
    ? `${baseOrderUrl}?affc=${encodeURIComponent(affiliateCode)}`
    : baseOrderUrl;

  const qrUrl = orderUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(orderUrl)}`
    : '';

  return { affiliateCode, orderUrl, qrUrl };
};

const AffiliateBSRPage = () => {
  useGlobalStyles();
  const classes = useStyles();

  const { orderUrl, qrUrl } = useMemo(buildAffiliateData, []);

  return (
    <div className={classes.page}>
      <main className={classes.card}>
        <div className={classes.eyebrow}>מערכת ההזמנות של BSR CITY</div>
        <h1 className={classes.title}>ארוחות שף חמות עד המשרד במגדלי BSR CITY</h1>
        <p className={classes.subtitle}>
          מערכת הזמנות ייעודית למגדלי BSR CITY – ארוחות שף איכותיות,{' '}
          <span className={classes.highlight}>משלוח חינם</span> ו{' '}
          <span className={classes.highlight}>שירות מהיר</span> ישירות לקומה שלכם.
        </p>

        <p className={classes.text}>
          קיבלתם קישור להזמנות במגדלי BSR CITY. מכאן תוכלו לבחור ארוחת שף חמה, לשלם אונליין ולקבל משלוח
          עד המשרד – בלי לצאת מהבניין ובלי לבזבז זמן בתורים.
        </p>

        <ul className={classes.bullets}>
          <li className={classes.bullet}>
            <span className={classes.bulletIcon} />
            <span>תפריט מיוחד ומעודכן שמתאים בדיוק לקהילת המגדלים.</span>
          </li>
          <li className={classes.bullet}>
            <span className={classes.bulletIcon} />
            <span>ארוחות שף ברמה של מסעדה, מוכנות לזמן ההפסקה שלכם.</span>
          </li>
          <li className={classes.bullet}>
            <span className={classes.bulletIcon} />
            <span>משלוח חינם ומהיר ישירות למשרד או לחדר הישיבות.</span>
          </li>
        </ul>

        {qrUrl && (
          <section className={classes.qrSection} aria-label="קוד QR למערכת ההזמנות של BSR CITY">
            <div className={classes.qrWrapper}>
              <img
                src={qrUrl}
                alt="קוד QR לפתיחת מערכת ההזמנות של BSR CITY"
                className={classes.qrImage}
                loading="lazy"
              />
            </div>
            <p className={classes.qrText}>סרקו כדי להזמין עכשיו</p>
          </section>
        )}

        {orderUrl && (
          <p className={classes.footer}>
            קישור ישיר למערכת ההזמנות:&nbsp;
            <a href={orderUrl}>לחצו כאן להזמנה</a>
          </p>
        )}
      </main>

      {orderUrl && (
        <div className={classes.bottomBar}>
          <button
            type="button"
            className={classes.printButton}
            onClick={() => {
              if (typeof window !== 'undefined' && window.print) {
                window.print();
              }
            }}
          >
            הדפסת העמוד
          </button>
          <button
            type="button"
            className={classes.shareButton}
            onClick={() => {
              if (typeof window === 'undefined') return;
              const text = `הזמנה למערכת ההזמנות של BSR CITY:\n${orderUrl}`;
              const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
              window.open(url, '_blank', 'noopener,noreferrer');
            }}
          >
            שיתוף ב־WhatsApp
          </button>
        </div>
      )}
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<AffiliateBSRPage />);
}

