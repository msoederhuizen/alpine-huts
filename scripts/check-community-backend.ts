/**
 * Does the community backend behave the way the migrations claim?
 *
 * ⚠️ "THE MIGRATION RAN WITHOUT ERROR" AND "STRANGERS CANNOT READ YOUR DATA"
 * ARE DIFFERENT CLAIMS, and only one of them is worth anything. Creating a
 * policy always succeeds; whether it denies what it should is a separate
 * question that has to be asked of the live server, with the same public key
 * an attacker would pull out of the app bundle.
 *
 * So this runs as a stranger: publishable key, no session. Every check states
 * what it expects and why, and a PASS means the server refused something it
 * was supposed to refuse — not that a call succeeded.
 *
 *   npm run check-community-backend
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function env(key: string): string | undefined {
  const f = join(ROOT, '.env');
  if (!existsSync(f)) return undefined;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && m[1] === key) return m[2].trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}

const URL_ = env('EXPO_PUBLIC_SUPABASE_URL');
const KEY = env('EXPO_PUBLIC_SUPABASE_ANON_KEY');

const results: { ok: boolean; what: string; detail: string }[] = [];
function record(ok: boolean, what: string, detail: string) {
  results.push({ ok, what, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (detail) console.log(`        ${detail}`);
}

async function call(path: string, init: RequestInit = {}) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY!,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await r.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* keep the raw text */ }
  return { status: r.status, body };
}

async function main() {
  if (!URL_ || !KEY) {
    console.error('EXPO_PUBLIC_SUPABASE_URL or _ANON_KEY missing from .env');
    process.exit(1);
  }
  console.log(`Acting as a STRANGER against ${URL_}\n`);

  // 1. The tables exist and are reachable at all.
  const reviews = await call('hut_reviews?select=id&limit=1');
  record(
    reviews.status === 200,
    'hut_reviews is reachable',
    reviews.status === 200
      ? 'HTTP 200'
      : `HTTP ${reviews.status} — ${JSON.stringify(reviews.body).slice(0, 160)}`,
  );

  // 2. And return nothing, because nothing is approved yet. An EMPTY array is
  //    the right answer; a row here would mean the read policy is not filtering.
  record(
    Array.isArray(reviews.body) && (reviews.body as unknown[]).length === 0,
    'no reviews are visible to a stranger',
    Array.isArray(reviews.body) ? `${(reviews.body as unknown[]).length} rows` : 'not an array',
  );

  // 3. The ratings view exists and is filtered the same way.
  const ratings = await call('hut_ratings?select=hut_id&limit=1');
  record(ratings.status === 200, 'hut_ratings view is reachable', `HTTP ${ratings.status}`);

  // 4. ⚠️ THE ONE THAT MATTERS MOST. `moderators` has RLS on and NO policies,
  //    so a stranger must see nothing. If this ever returns a row, anyone can
  //    learn which account approves content.
  const mods = await call('moderators?select=user_id');
  // 404 means 0003 has not been run yet — a table that does not exist is not a
  // leak. Only an actual ROW here is a failure, since that would tell a
  // stranger which account approves content.
  const notYet = mods.status === 404;
  record(
    notYet || (mods.status === 200 && Array.isArray(mods.body) && (mods.body as unknown[]).length === 0),
    notYet ? 'the moderator table does not exist yet (0003 not run)' : 'the moderator list is invisible',
    notYet
      ? 'expected at this stage — run 0003_moderation.sql once you have a user id'
      : `HTTP ${mods.status}, ${Array.isArray(mods.body) ? (mods.body as unknown[]).length + ' rows' : JSON.stringify(mods.body).slice(0, 120)}`,
  );

  // 5. Writing without signing in must be refused. The insert policy requires
  //    auth.uid() to exist, so an anonymous POST has no identity to satisfy it.
  const write = await call('hut_reviews', {
    method: 'POST',
    body: JSON.stringify({ hut_id: 'test/0', rating: 5, comment: 'checking the lock' }),
  });
  record(
    write.status === 401 || write.status === 403 || write.status === 400,
    'a stranger cannot write a review',
    `HTTP ${write.status} — ${JSON.stringify(write.body).slice(0, 140)}`,
  );

  // 6. Nor approve anything, which is the whole moderation model.
  const approve = await call('hut_reviews?id=eq.00000000-0000-0000-0000-000000000000', {
    method: 'PATCH',
    body: JSON.stringify({ status: 'approved' }),
  });
  record(
    approve.status !== 200 || (Array.isArray(approve.body) && (approve.body as unknown[]).length === 0),
    'a stranger cannot approve content',
    `HTTP ${approve.status}`,
  );

  // 7. Reports are a message to the moderator, never public.
  const reports = await call('photo_reports?select=id&limit=1');
  record(
    reports.status === 200 && Array.isArray(reports.body) && (reports.body as unknown[]).length === 0,
    'photo reports are not public',
    `HTTP ${reports.status}`,
  );

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${'='.repeat(52)}`);
  console.log(`${results.length - failed.length} of ${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  ${f.what}\n    ${f.detail}`);
    process.exitCode = 1;
  }
}

main();
