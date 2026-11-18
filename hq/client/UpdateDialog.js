// The "new version" dialog: shown by the shell when the hourly check (client/version.js) finds a newer build on the server.
// "Reload now" loads it; "Later" hides the dialog until the next check finds it again.
import React from 'react';
import { Modal, Btn } from './ui.js';
import { useT } from './i18n/index.js';
import { useUpdateCheck, reloadApp, BUILD } from './version.js';

export default function UpdateDialog() {
  const { t } = useT();
  const u = useUpdateCheck();
  if (!u.available) return null;
  return (
    <Modal
      title={t('joya.update.title')}
      onClose={u.dismiss}
      footer={
        <>
          <Btn onClick={u.dismiss}>{t('joya.update.later')}</Btn>
          <Btn kind="primary" onClick={reloadApp}>{t('joya.update.reload')}</Btn>
        </>
      }
    >
      <p style={{ margin: '0 0 0.4rem' }}>{t('joya.update.body')}</p>
      <p style={{ margin: 0, fontSize: '0.78rem', opacity: 0.75 }}>
        <bdi dir="ltr">{BUILD}</bdi> → <bdi dir="ltr">{u.latest}</bdi>
      </p>
    </Modal>
  );
}
