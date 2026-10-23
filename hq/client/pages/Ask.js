// /ask — questions in words about the data, with the calculations behind each answer.
import React from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { useT } from '../i18n/index.js';
import { useJoya } from '../context.js';
import AskBox from '../AskBox.js';
import { Page, Card } from '../ui.js';

const useStyles = createUseStyles((theme) => ({
  list: { margin: '0.2rem 0 0', paddingInlineStart: '1.1rem', fontSize: '0.84rem', lineHeight: 1.6 },
  muted: { fontSize: '0.78rem', color: theme.textSecondary, marginTop: '0.4rem' },
}));

export default function Ask() {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t } = useT();
  const j = useJoya();
  return (
    <Page title={t('joya.askPage.title')} sub={j.location ? j.location.name : t('joya.allLocations')}>
      <Card title={t('joya.askPage.howTitle')}>
        <ul className={c.list}>
          <li>{t('joya.askPage.how1')}</li>
          <li>{t('joya.askPage.how2')}</li>
          <li>{t('joya.askPage.how3')}</li>
          <li>{t('joya.askPage.how4')}</li>
          <li>{t('joya.askPage.how5')}</li>
        </ul>
        <div className={c.muted}>{t('joya.askPage.scope')}</div>
      </Card>
      <AskBox
        contextKind="GENERAL"
        locationId={j.locationId}
        limit={20}
        examples={[1, 2, 3, 4, 5, 6].map((n) => t(`joya.askPage.ex${n}`))}
      />
    </Page>
  );
}
