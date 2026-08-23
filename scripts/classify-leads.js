#!/usr/bin/env node
/* Run the spam classifier over leads ALREADY in the database.
 *
 *   node scripts/classify-leads.js            # dry run — prints, changes nothing
 *   node scripts/classify-leads.js --apply    # writes spam/spamCategory/spamScore
 *
 * WHY THIS IS SEPARATE FROM THE FILTER
 * ------------------------------------
 * api/book-call.js classifies at the door, which does nothing for the 62
 * documents already sitting in the inbox — 61 of them junk, with the one real
 * lead buried in the middle. This is the one-shot that makes the existing
 * collection match what the filter would have done, so the Inbox tab opens on
 * real leads from the first load rather than after an afternoon of manual
 * tidying.
 *
 * IT NEVER DELETES ANYTHING. A historical lead the classifier would have
 * rejected outright is marked `spam: true` here, not removed — deleting is a
 * decision for a human looking at the Spam tab, with the "Delete all spam"
 * button, after they have seen what is in it. Anything already hand-marked
 * (`promo: true` from the old admin) is left exactly as the human left it.
 *
 * Reads MONGODB_URI / MONGODB_DB the same way the serverless functions do.
 */
import { loadEnv, ensureSrvDns } from './_env.js';
import { classifyLead } from '../lib/spam.js';

loadEnv();

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not set. Put it in site/.env.local (see .env.example).');
  process.exit(1);
}

await ensureSrvDns();

const APPLY = process.argv.includes('--apply');

// Imported AFTER loadEnv, because lib/db.js reads MONGODB_URI/MONGODB_DB at module scope.
const { leads } = await import('../lib/db.js');
const col = await leads();
const rows = await col.find({}).sort({ createdAt: -1 }).toArray();

const buckets = { allow: [], quarantine: [], reject: [] };
const ops = [];

for (const doc of rows) {
  // Respect a human's existing call. The old admin's "Mark as promotion" button
  // wrote `promo: true`, and a person's judgement outranks the classifier's.
  if (doc.promo === true || doc.spam === true) {
    const category = doc.spamCategory || 'manual';
    buckets.quarantine.push({ doc, v: { verdict: 'quarantine', category, score: null, reasons: ['marked by hand'] } });
    // Mirror the old `promo` flag onto `spam` so the two can never disagree.
    // The admin already reads a lone `promo: true` as spam, but leaving the
    // documents half-migrated means every future query has to remember to check
    // both fields — which is exactly how one of them eventually gets forgotten.
    if (doc.spam !== true) {
      ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { spam: true, promo: true, spamCategory: category } } } });
    }
    continue;
  }

  const v = classifyLead(doc, {
    // Historical rows predate the browser stamp entirely, so the transport
    // signals must be left undefined rather than reported as missing — scoring
    // every old lead for the absence of a field that did not exist yet would
    // be an artefact of the migration, not evidence about the sender.
    hasJsStamp: undefined,
    dwellMs: null,
    duplicateCount: 0,
  });
  buckets[v.verdict].push({ doc, v });

  const spam = v.verdict !== 'allow';
  if (spam !== (doc.spam === true)) {
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: {
            spam,
            spamCategory: spam ? v.category : null,
            spamScore: v.score,
            spamReasons: v.reasons,
            promo: spam,
          },
        },
      },
    });
  }
}

const line = (b) => b.map(({ doc, v }) =>
  `  ${String(doc.createdAt || '').toString().slice(0, 10)}  ${String(v.score ?? '—').padStart(3)}  ${(v.category || '—').padEnd(14)}  ${String(doc.name || '').slice(0, 28).padEnd(28)}  ${String(doc.brief || '').replace(/\s+/g, ' ').slice(0, 58)}`,
).join('\n');

console.log(`\n${rows.length} leads in the collection\n`);
console.log(`REAL — stay in the inbox (${buckets.allow.length})`);
console.log(line(buckets.allow) || '  (none)');
console.log(`\nWOULD HAVE BEEN REJECTED AT THE DOOR (${buckets.reject.length}) — marked as spam, not deleted`);
console.log(line(buckets.reject) || '  (none)');
console.log(`\nQUARANTINED (${buckets.quarantine.length})`);
console.log(line(buckets.quarantine) || '  (none)');

if (!ops.length) {
  console.log('\nNothing to change.');
} else if (!APPLY) {
  console.log(`\n${ops.length} document(s) would be updated. Re-run with --apply to write.`);
} else {
  const r = await col.bulkWrite(ops);
  console.log(`\nUpdated ${r.modifiedCount} document(s).`);
}

process.exit(0);
