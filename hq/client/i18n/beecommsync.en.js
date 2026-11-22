// Beecomm update on demand (the System page card, client/BeecommUpdate.js).
export default {
  'joya.beecommSync.title': 'Beecomm update (sales)',
  'joya.beecommSync.button': 'Update from Beecomm',
  'joya.beecommSync.busy': 'Updating…',
  'joya.beecommSync.hint': 'The button runs the nightly Beecomm load on the server now (orders, Z reports, daily payments and items) – from the last loaded day up to yesterday. The regular load runs every morning at 06:00; each day takes about 10–60 seconds.',
  'joya.beecommSync.loadedUpTo': 'Loaded up to business day {day} (written {when})',
  'joya.beecommSync.notConfigured': 'The server has no Beecomm login settings (BCOM_BO_API_KEY / BCOM_BO_REFRESH_TOKEN in the admin .env).',
  'joya.beecommSync.running': 'Running… {s} seconds',
  'joya.beecommSync.nothing': 'Nothing to load – the data reaches yesterday',
  'joya.beecommSync.doneDays': 'Loaded the days {from} – {to} ({s} seconds)',
  'joya.beecommSync.state.running': 'running',
  'joya.beecommSync.state.done': 'done',
  'joya.beecommSync.state.failed': 'failed',
};
