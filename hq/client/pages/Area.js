// /stock, /people, /performance, /bank (chain admin), /accounting (chain admin and the accountant) — the areas of the main menu. Each is a chat (ChatArea): the user
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
  people: { id: 2, suggestions: 4 },
  performance: { id: 3, suggestions: 3 },
  bank: { id: 4, suggestions: 8 },
  // the accounting area: 8 register-vs-bank questions for everyone in it, then 9 about the books (chain admin only; the first is the detailed bank reconciliation report)
  accounting: { id: 5, suggestions: 8, adminSuggestions: 9 },
  // the payments area (chain admin): its page is pages/Payments.js (the board + this chat)
  payments: { id: 6, suggestions: 6 },
};

export default function Area({ area }) {
  const { t } = useT();
  const j = useJoya();
  const a = AREAS[area];
  const n = a.suggestions + (j.me?.isAdmin ? a.adminSuggestions || 0 : 0);
  const suggestions = Array.from({ length: n }, (_, i) => t(`joya.area.${area}.s${i + 1}`));
  // the section's name is in the middle of the top bar (JoyaApp.js), not on the page
  return (
    <Page>
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
