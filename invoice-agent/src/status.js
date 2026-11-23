// Shows what the script did: counts, and the emails a person should look at.
import { paths } from './config.js';
import { loadState } from './state.js';

const { messages } = loadState(paths.state);
const all = Object.entries(messages);
const count = {};
for (const [, m] of all) count[m.status] = (count[m.status] ?? 0) + 1;
console.log(`Emails read: ${all.length}`, count);
const review = all.filter(([, m]) => m.status === 'needs_review');
if (review.length) console.log('\nNeeds review:');
for (const [id, m] of review) console.log(`- ${m.at?.slice(0, 10) ?? ''} ${m.from ?? ''} | ${m.subject ?? id} | ${m.reason}`);
