// Beecomm update on demand (owner 2026-11-22: "add the update button to the Beecomm as well — to initiate the update
// process on the server"): the System page's button starts the admin's nightly Beecomm loader now, on the server
// (admin/server/modules/beecommSync.js, Local Data API /beecomm/sync/*, admin rights in the X-Joya-* headers). Joya
// keeps nothing: the admin runs the loader and remembers the last runs; the card polls `state` while one runs. When a
// run ends with new days loaded, the 5-minute source cache is dropped so the next question sees them.
import { admin } from './bankSync.js';
import { clearCache as clearAllegroCache } from '../../lib/allegro.js';

let lastDoneSeen = null;

/** The run going on, the last runs, the loaded days (the admin's answer, as is). */
export async function state(access) {
  const s = (await admin('/beecomm/sync/state', { access, timeout: 20_000 })).data;
  const done = s?.runs?.find((r) => r.state === 'done' && !r.nothingToDo);
  if (done && done.id !== lastDoneSeen) {
    lastDoneSeen = done.id;
    clearAllegroCache();
  }
  return s;
}

/** Starts the loader on the server; the admin answers 409 running / 503 not_configured. */
export async function start(access) {
  return (await admin('/beecomm/sync/start', { method: 'POST', access, json: {}, timeout: 20_000 })).data;
}
