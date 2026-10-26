// /stock, /people, /performance, /bank (chain admin) — the areas of the main menu. Each is a chat (ChatArea): the user
// asks in words and the AI answers from the hub's calculations. The ask field suggests the area's
// questions. The detailed pages still exist, but the menu no longer lists them.
import React from 'react';
import { useT } from '../i18n/index.js';
import { useJoya } from '../context.js';
import ChatArea from '../ChatArea.js';
import { Page } from '../ui.js';

// area → context id of the chat (src/services/ai.js AREAS) and how many suggestions its strings have
export const AREAS = {
  stock: { id: 1, suggestions: 10 },
  people: { id: 2, suggestions: 12 },
  performance: { id: 3, suggestions: 11 },
  bank: { id: 4, suggestions: 8 },
};

export default function Area({ area }) {
  const { t } = useT();
  const j = useJoya();
  const a = AREAS[area];
  const suggestions = Array.from({ length: a.suggestions }, (_, i) => t(`joya.area.${area}.s${i + 1}`));
  return (
    <Page title={t(`joya.area.${area}.title`)} sub={j.location ? j.location.name : j.companyKey != null ? j.companies.find((c) => c.key === j.companyKey)?.label || t('joya.noCompany') : t('joya.allLocations')}>
      <ChatArea
        key={area}
        contextId={a.id}
        locationId={j.locationId}
        title={t('joya.area.askTitle')}
        intro={t(`joya.area.${area}.intro`)}
        suggestions={suggestions}
      />
    </Page>
  );
}
