// /stock, /people, /performance — the three areas of the main menu. Each is a chat: the user asks in
// words and the AI answers from the hub's calculations (AskBox). While the user types, questions that
// fit the area are suggested. The detailed pages still exist, but the menu no longer lists them.
import React from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { useT } from '../i18n/index.js';
import { useJoya } from '../context.js';
import AskBox from '../AskBox.js';
import { Page } from '../ui.js';

// area → context id of the chat (src/services/ai.js AREAS) and how many suggestions its strings have
export const AREAS = {
  stock: { id: 1, suggestions: 10 },
  people: { id: 2, suggestions: 12 },
  performance: { id: 3, suggestions: 10 },
};

const useStyles = createUseStyles((theme) => ({
  intro: { fontSize: '0.84rem', color: theme.textSecondary, margin: '0 0 0.7rem', lineHeight: 1.55 },
}));

export default function Area({ area }) {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t } = useT();
  const j = useJoya();
  const a = AREAS[area];
  const suggestions = Array.from({ length: a.suggestions }, (_, i) => t(`joya.area.${area}.s${i + 1}`));
  return (
    <Page title={t(`joya.area.${area}.title`)} sub={j.location ? j.location.name : t('joya.allLocations')}>
      <p className={c.intro}>{t(`joya.area.${area}.intro`)}</p>
      <AskBox
        key={area}
        title={t('joya.area.askTitle')}
        contextKind="AREA"
        contextId={a.id}
        locationId={j.locationId}
        limit={20}
        examples={suggestions.slice(0, 4)}
        suggestions={suggestions}
      />
    </Page>
  );
}
