// Beecomm update on demand (the System page card, client/BeecommUpdate.js).
export default {
  'joya.beecommSync.title': 'Beecomm update (sales)',
  'joya.beecommSync.button': 'Update from Beecomm',
  'joya.beecommSync.busy': 'Updating…',
  'joya.beecommSync.hint': 'The button runs the nightly Beecomm load on the server now (orders, Z reports, daily payments and items) – from the last loaded day up to yesterday. The regular load runs every morning at 06:00; each day takes about 10–60 seconds.',
  'joya.beecommSync.loadedUpTo': 'Loaded up to business day {day} (written {when})',
  'joya.beecommSync.disabled': 'The Beecomm update is switched off on the server: Beecomm refuses the server\'s address (since 25.11). The nightly load runs on Moti\'s machine every morning at 06:30 (a second try at 13:30).',
  'joya.beecommSync.hintDisabled': 'When Beecomm allows the server\'s address, remove BEECOMM_SYNC=off from the admin .env and the button and the nightly load work on the server again.',
  'joya.beecommSync.notConfigured': 'The server has no Beecomm login settings (BCOM_BO_API_KEY / BCOM_BO_REFRESH_TOKEN in the admin .env).',
  'joya.beecommSync.running': 'Running… {s} seconds',
  'joya.beecommSync.nothing': 'Nothing to load – the data reaches yesterday',
  'joya.beecommSync.doneDays': 'Loaded the days {from} – {to} ({s} seconds)',
  'joya.beecommSync.state.running': 'running',
  'joya.beecommSync.state.done': 'done',
  'joya.beecommSync.state.failed': 'failed',
};
