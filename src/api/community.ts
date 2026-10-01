/**
 * Photos people send in, photos they flag as wrong, and hut reviews.
 *
 * ⚠️ EVERY CALL HERE MUST BE ABLE TO FAIL WITHOUT BREAKING ANYTHING. The app
 * works offline and that is not negotiable — someone three hours up a valley
 * with no signal must still see their route, their huts and their photos. So
 * this module never throws into render, never blocks startup, and returns
 * empty rather than erroring when the backend is unreachable or unconfigured.
 *
 * ⚠️ NOTHING READ HERE IS TRUSTED. Every row was written by a stranger. Text is
 * rendered as text and never as markup, and the server decides what is visible
 * — the client filtering on `status` would be a suggestion, not a rule.
 *
 * ⚠️ AND NOTHING IS VISIBLE UNTIL IT IS APPROVED. The policies in
 * supabase/migrations/0001_community.sql only ever return 'approved' rows to
 * anyone but their author. That is what keeps Apple's user-generated-content
 * requirements (Guideline 1.2) satisfiable by one person with a moderation
 * page, rather than needing live filtering.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { EMAIL_CONFIRMED_URL, PASSWORD_RESET_URL } from '../constants/links';
import { stripExif } from '../utils/stripExif';
import 'react-native-url-polyfill/auto';

/**
 * ⚠️ THE ANON KEY IS PUBLIC AND THAT IS FINE. It ships inside the bundle and
 * anyone can read it out — it is an identifier, not a secret. Everything that
 * matters is enforced by row-level security on the server, which is why the
 * migration treats this key as being in hostile hands. The SERVICE key, which
 * can approve content, must never appear in this repo.
 */
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const communityEnabled = Boolean(URL && ANON);

let client: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (!communityEnabled) return null;
  if (!client) {
    client = createClient(URL!, ANON!, {
      auth: {
        storage: AsyncStorage,
        persistSession: true,
        autoRefreshToken: true,
        // No deep-link callback in a native app, so there is no URL to read a
        // session out of; leaving this on makes the client wait on one.
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

/**
 * Sign in anonymously, once, lazily.
 *
 * ⚠️ NOT AT STARTUP. Calling this on launch would make a network request before
 * the first screen, on an app whose users are routinely offline, to enable a
 * feature most of them will never touch. It runs on the first contribution
 * instead — and if it fails, the contribution fails and nothing else does.
 *
 * ⚠️ AN ANONYMOUS SESSION IS STILL AN ACCOUNT for Apple's purposes, which is
 * why deleteMyContent() below exists and must be reachable from the UI.
 */
async function ensureSession(): Promise<string | null> {
  const c = db();
  if (!c) return null;
  try {
    const { data } = await c.auth.getSession();
    if (data.session?.user?.id) return data.session.user.id;
    const { data: created, error } = await c.auth.signInAnonymously();
    if (error) return null;
    return created.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * The id to write a contribution as — or null if there is no real account.
 *
 * ⚠️ CONTRIBUTING NOW REQUIRES AN ACCOUNT, AND READING STILL DOES NOT. Anyone
 * can open the app, see every hut and read every approved review with no
 * account at all; that is what keeps the app usable on a first launch in a
 * valley with no signal, and what keeps it inside Apple's rule that an app may
 * not demand personal information to function.
 *
 * What changed is the other half. Every photo, review and report is somebody's
 * word about a place other walkers will rely on, and an account that vanishes
 * when the phone is replaced cannot be corrected, asked about, or held to
 * anything. So the automatic anonymous account is no longer enough to WRITE
 * with — it is still created, because it carries the session, but a
 * contribution needs an address behind it.
 *
 * It distinguishes the two failures on purpose. "No signal" and "no account"
 * look identical from a caller that only gets null, and they need completely
 * different words on screen: one is wait until you have a connection, the
 * other is here is what to do about it.
 */
async function contributorId(): Promise<{ id: string } | { blocked: 'offline' | 'needs_account' }> {
  const uid = await ensureSession();
  if (!uid) return { blocked: 'offline' };
  const { anonymous } = await accountState();
  return anonymous ? { blocked: 'needs_account' } : { id: uid };
}

/**
 * Why the community features are doing nothing.
 *
 * ⚠️ THIS EXISTS BECAUSE FAILING SILENTLY IS RIGHT FOR USERS AND USELESS FOR
 * DEBUGGING. Every call here returns empty when anything goes wrong, so the app
 * never breaks up a valley with no signal. The cost is that four completely
 * different situations look identical from the outside:
 *
 *   nothing configured · the phone has no signal · the backend is not serving ·
 *   there genuinely are no reviews yet
 *
 * ⚠️ AND ONE OF THOSE IS ROUTINE: A FREE SUPABASE PROJECT PAUSES ITSELF AFTER 7
 * DAYS WITH NO REQUESTS. Development happens in bursts, so this WILL happen,
 * and when it does the app behaves exactly as if this module were broken — no
 * reviews, uploads that do nothing, no error anywhere. Without this, the
 * obvious move is to go and read the code.
 */
export type BackendState =
  /** No URL or key compiled in — the feature is simply not switched on. */
  | 'disabled'
  /** Answered. Whatever is missing is not the backend's fault. */
  | 'ok'
  /** Could not be reached at all: no signal, or DNS could not resolve it. */
  | 'offline'
  /** Reached, but refusing to serve — a paused free project looks like this. */
  | 'unavailable'
  /** Nothing has been attempted yet this session. */
  | 'unknown';

let lastState: BackendState = communityEnabled ? 'unknown' : 'disabled';

/** What the last real call saw, so the About screen costs no extra request. */
export function lastBackendState(): BackendState {
  return lastState;
}

function note(ok: boolean, threw: boolean): void {
  if (!communityEnabled) { lastState = 'disabled'; return; }
  lastState = ok ? 'ok' : threw ? 'offline' : 'unavailable';
}

/**
 * Ask the backend directly. Only from a deliberate tap — never on load.
 *
 * The distinction that matters: a `fetch` that THROWS means the request never
 * arrived (no signal, bad DNS), while a 5xx means the server took the call and
 * declined it — which is what a paused project does. Those want opposite
 * responses from a person, so they must not read the same.
 */
export async function checkBackend(): Promise<BackendState> {
  if (!communityEnabled) return (lastState = 'disabled');
  try {
    const r = await fetch(`${URL}/rest/v1/`, {
      headers: { apikey: ANON!, Authorization: `Bearer ${ANON}` },
      signal: AbortSignal.timeout(8000),
    });
    // 401/404 still prove something answered; only 5xx means "not serving".
    return (lastState = r.status >= 500 ? 'unavailable' : 'ok');
  } catch {
    return (lastState = 'offline');
  }
}

/** One line for the About screen. Plain words, no codes. */
export function backendMessage(state: BackendState = lastState): string {
  switch (state) {
    case 'disabled':
      return 'Reviews and photo sharing are not switched on in this build.';
    case 'ok':
      return 'Connected.';
    case 'offline':
      return 'No connection — reviews and photo sharing need signal.';
    case 'unavailable':
      return 'The server is not responding. If this lasts, it may be asleep and need waking.';
    default:
      return 'Not checked yet.';
  }
}

export interface Review {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  mine: boolean;
  /** Present only for the author, so the app can say "waiting to be checked". */
  status?: 'pending' | 'approved' | 'rejected';
}

export interface Rating {
  average: number;
  count: number;
}

/** Approved reviews for a hut, plus the caller's own whatever its status. */
export async function reviewsFor(hutId: string): Promise<Review[]> {
  const c = db();
  if (!c) return [];
  try {
    const me = (await c.auth.getSession()).data.session?.user?.id ?? null;
    const { data, error } = await c
      .from('hut_reviews')
      .select('id,rating,comment,created_at,author_id,status')
      .eq('hut_id', hutId)
      .order('created_at', { ascending: false })
      .limit(100);
    note(!error, false);
    if (error || !data) return [];
    return data.map((r) => ({
      id: String(r.id),
      rating: Number(r.rating),
      comment: r.comment ?? null,
      createdAt: String(r.created_at),
      mine: Boolean(me && r.author_id === me),
      status: r.author_id === me ? r.status : undefined,
    }));
  } catch {
    note(false, true);
    return [];
  }
}

/** Average and count, from the server-side view so it cannot go stale. */
export async function ratingFor(hutId: string): Promise<Rating | null> {
  const c = db();
  if (!c) return null;
  try {
    const { data, error } = await c
      .from('hut_ratings')
      .select('average,count')
      .eq('hut_id', hutId)
      .maybeSingle();
    if (error || !data) return null;
    return { average: Number(data.average), count: Number(data.count) };
  } catch {
    return null;
  }
}

/**
 * Leave or replace a review. One per person per hut — the table enforces it,
 * so editing is an upsert rather than a second row.
 */
export async function submitReview(
  hutId: string,
  rating: number,
  comment: string,
): Promise<'ok' | 'offline' | 'needs_account' | 'failed'> {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return 'failed';
  const c = db();
  if (!c) return 'offline';
  const who = await contributorId();
  if ('blocked' in who) return who.blocked;
  const uid = who.id;
  try {
    const { error } = await c.from('hut_reviews').upsert(
      {
        hut_id: hutId,
        rating,
        comment: comment.trim().slice(0, 2000) || null,
        author_id: uid,
        // Re-submitting resets to pending: the approval was given to the old
        // words, and carrying it over would let edited text bypass moderation.
        status: 'pending',
      },
      { onConflict: 'hut_id,author_id' },
    );
    note(!error, false);
    return error ? 'failed' : 'ok';
  } catch {
    note(false, true);
    return 'failed';
  }
}

export async function deleteMyReview(hutId: string): Promise<boolean> {
  const c = db();
  const uid = await ensureSession();
  if (!c || !uid) return false;
  try {
    const { error } = await c.from('hut_reviews').delete().eq('hut_id', hutId).eq('author_id', uid);
    return !error;
  } catch {
    return false;
  }
}

export type ReportReason = 'wrong_place' | 'not_a_building' | 'offensive' | 'other';

/**
 * Flag a photo as wrong.
 *
 * Works for the photos that ship inside the app as well as uploaded ones, which
 * is the point: the ~1,575 machine-found photos are the ones most likely to be
 * wrong, and they have no database row — the URL is all that identifies them.
 */
export async function reportPhoto(
  hutId: string,
  photoUrl: string,
  reason: ReportReason,
  detail = '',
): Promise<'ok' | 'offline' | 'needs_account' | 'already' | 'failed'> {
  const c = db();
  if (!c) return 'offline';
  const who = await contributorId();
  if ('blocked' in who) return who.blocked;
  const uid = who.id;
  try {
    const { error } = await c.from('photo_reports').insert({
      hut_id: hutId,
      photo_url: photoUrl,
      reason,
      detail: detail.trim().slice(0, 280) || null,
      author_id: uid,
    });
    if (!error) return 'ok';
    // 23505: unique violation — they already reported this one. Not a failure.
    return error.code === '23505' ? 'already' : 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * Send a photo in for checking.
 *
 * ⚠️ IT GOES INTO THE CALLER'S OWN FOLDER, keyed on the id the server issued.
 * The storage policy checks that prefix, so building the path from anything a
 * caller supplies would be the whole access control.
 */
export async function submitPhoto(
  hutId: string,
  localUri: string,
  caption = '',
): Promise<'ok' | 'offline' | 'needs_account' | 'too_big' | 'unsupported' | 'failed'> {
  const c = db();
  if (!c) return 'offline';
  const who = await contributorId();
  if ('blocked' in who) return who.blocked;
  const uid = who.id;
  try {
    const res = await fetch(localUri);
    const raw = new Uint8Array(await res.arrayBuffer());
    if (raw.byteLength > 8 * 1024 * 1024) return 'too_big';

    /**
     * ⚠️ STRIP THE LOCATION BEFORE IT LEAVES THE PHONE, NOT AFTER IT ARRIVES.
     * A phone photograph carries where it was taken to within a few metres and
     * often which device took it. Someone sharing a picture of a hut is
     * offering the picture, not a record of where they slept on a given night.
     * Deleting it server-side would still mean it arrived, was written to disk
     * and existed in a backup — "we remove it on receipt" is a promise, not
     * sending it is a fact.
     */
    const { bytes, handled } = stripExif(raw);
    // Only JPEG is understood by the stripper. Anything else would be uploaded
    // with its metadata intact, so it is refused rather than quietly shared.
    if (!handled) return 'unsupported';

    const type = 'image/jpeg';
    const path = `${uid}/${hutId.replace('/', '_')}-${Date.now()}.jpg`;

    const up = await c.storage.from('hut-photos').upload(path, bytes, {
      contentType: type,
      upsert: false,
    });
    if (up.error) return 'failed';

    const { error } = await c.from('photo_submissions').insert({
      hut_id: hutId,
      storage_path: path,
      caption: caption.trim().slice(0, 280) || null,
      author_id: uid,
    });
    if (error) {
      // Don't leave an orphan object behind if the row failed.
      await c.storage.from('hut-photos').remove([path]).catch(() => {});
      return 'failed';
    }
    return 'ok';
  } catch {
    return 'failed';
  }
}

export interface ApprovedPhoto {
  url: string;
  caption: string | null;
  mine: boolean;
  status?: 'pending' | 'approved' | 'rejected';
}

/**
 * Approved photos for a hut, as short-lived signed URLs.
 *
 * ⚠️ SIGNED, BECAUSE THE BUCKET IS PRIVATE. A public bucket would serve every
 * upload the moment it arrived, whatever its row said — the approval would be
 * decorative. Signing here means the table's policies stay the only gate.
 */
export async function communityPhotosFor(hutId: string): Promise<ApprovedPhoto[]> {
  const c = db();
  if (!c) return [];
  try {
    const me = (await c.auth.getSession()).data.session?.user?.id ?? null;
    const { data, error } = await c
      .from('photo_submissions')
      .select('storage_path,caption,author_id,status')
      .eq('hut_id', hutId)
      .order('created_at', { ascending: false })
      .limit(24);
    if (error || !data?.length) return [];

    const signed = await c.storage
      .from('hut-photos')
      .createSignedUrls(data.map((r) => r.storage_path), 60 * 60);
    if (signed.error || !signed.data) return [];

    return data
      .map((r, i) => ({
        url: signed.data[i]?.signedUrl ?? '',
        caption: r.caption ?? null,
        mine: Boolean(me && r.author_id === me),
        status: r.author_id === me ? r.status : undefined,
      }))
      .filter((p) => p.url);
  } catch {
    return [];
  }
}

/** Remove everything this person has sent. Reachable from the UI, not a tool. */
export async function deleteMyContent(): Promise<boolean> {
  const c = db();
  const uid = await ensureSession();
  if (!c || !uid) return false;
  try {
    const list = await c.storage.from('hut-photos').list(uid);
    if (list.data?.length) {
      await c.storage.from('hut-photos').remove(list.data.map((f) => `${uid}/${f.name}`));
    }
    const { error } = await c.rpc('delete_my_content');
    return !error;
  } catch {
    return false;
  }
}

/**
 * Delete the account itself, and everything it holds.
 *
 * ⚠️ THE STORED PHOTOGRAPHS GO FIRST, AND THAT ORDER IS NOT INCIDENTAL. They
 * live in object storage, not Postgres, so nothing cascades to them — once the
 * account is gone there is no session that can reach them and they would sit
 * there for good. If that step fails this stops rather than deleting the
 * account over the top of files it can no longer reach.
 *
 * ⚠️ AND IT ENDS THE SESSION LOCALLY WHATEVER HAPPENS NEXT. The tokens on the
 * phone outlive the row they refer to; leaving them in place would show
 * somebody a signed-in account that no longer exists.
 */
export async function deleteMyAccount(): Promise<boolean> {
  const c = db();
  const uid = await ensureSession();
  if (!c || !uid) return false;
  try {
    const list = await c.storage.from('hut-photos').list(uid);
    if (list.data?.length) {
      const { error: storageError } = await c.storage
        .from('hut-photos')
        .remove(list.data.map((f) => `${uid}/${f.name}`));
      if (storageError) return false;
    }
    const { error } = await c.rpc('delete_my_account');
    if (error) return false;
    await rememberAccount(false);
    try { await c.auth.signOut(); } catch { /* the account is already gone */ }
    return true;
  } catch {
    return false;
  }
}

// ── moderation ──────────────────────────────────────────────────────────────
// ⚠️ EVERYTHING BELOW IS GUARDED BY THE SERVER, NOT BY THIS FILE. `is_moderator()`
// decides, and the policies in 0003_moderation.sql enforce it. The checks here
// only shape the UI — an ordinary user calling these directly gets nothing back
// and changes nothing, which is the property that makes shipping them safe.

export interface PendingPhoto {
  id: string;
  hutId: string;
  url: string;
  caption: string | null;
  createdAt: string;
}

export interface PendingReview {
  id: string;
  hutId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}

export interface OpenReport {
  id: string;
  hutId: string;
  photoUrl: string;
  reason: ReportReason;
  detail: string | null;
  createdAt: string;
}

/** Is this device a moderator? Server-side; the answer cannot be faked here. */
export async function amModerator(): Promise<boolean> {
  const c = db();
  if (!c) return false;
  try {
    await ensureSession();
    const { data, error } = await c.rpc('is_moderator');
    return !error && data === true;
  } catch {
    return false;
  }
}

/** The signed-in id, so you can add yourself to `moderators` the first time. */
export async function myUserId(): Promise<string | null> {
  return ensureSession();
}

export async function pendingPhotos(): Promise<PendingPhoto[]> {
  const c = db();
  if (!c) return [];
  try {
    const { data, error } = await c
      .from('photo_submissions')
      .select('id,hut_id,storage_path,caption,created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(50);
    if (error || !data?.length) return [];
    const signed = await c.storage
      .from('hut-photos')
      .createSignedUrls(data.map((r) => r.storage_path), 60 * 60);
    return data.map((r, i) => ({
      id: String(r.id),
      hutId: String(r.hut_id),
      url: signed.data?.[i]?.signedUrl ?? '',
      caption: r.caption ?? null,
      createdAt: String(r.created_at),
    }));
  } catch {
    return [];
  }
}

export async function pendingReviews(): Promise<PendingReview[]> {
  const c = db();
  if (!c) return [];
  try {
    const { data, error } = await c
      .from('hut_reviews')
      .select('id,hut_id,rating,comment,created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(50);
    if (error || !data) return [];
    return data.map((r) => ({
      id: String(r.id),
      hutId: String(r.hut_id),
      rating: Number(r.rating),
      comment: r.comment ?? null,
      createdAt: String(r.created_at),
    }));
  } catch {
    return [];
  }
}

export async function openReports(): Promise<OpenReport[]> {
  const c = db();
  if (!c) return [];
  try {
    const { data, error } = await c
      .from('photo_reports')
      .select('id,hut_id,photo_url,reason,detail,created_at')
      .eq('resolved', false)
      .order('created_at', { ascending: true })
      .limit(100);
    if (error || !data) return [];
    return data.map((r) => ({
      id: String(r.id),
      hutId: String(r.hut_id),
      photoUrl: String(r.photo_url),
      reason: r.reason as ReportReason,
      detail: r.detail ?? null,
      createdAt: String(r.created_at),
    }));
  } catch {
    return [];
  }
}

export async function judgePhoto(id: string, approve: boolean): Promise<boolean> {
  const c = db();
  if (!c) return false;
  try {
    const { error } = await c
      .from('photo_submissions')
      .update({ status: approve ? 'approved' : 'rejected', reviewed_at: new Date().toISOString() })
      .eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

export async function judgeReview(id: string, approve: boolean): Promise<boolean> {
  const c = db();
  if (!c) return false;
  try {
    const { error } = await c
      .from('hut_reviews')
      .update({ status: approve ? 'approved' : 'rejected', reviewed_at: new Date().toISOString() })
      .eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

export async function resolveReport(id: string): Promise<boolean> {
  const c = db();
  if (!c) return false;
  try {
    const { error } = await c.from('photo_reports').update({ resolved: true }).eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

// ── reports about the place itself ──────────────────────────────────────────
// ⚠️ A DIFFERENT PROBLEM FROM A WRONG PHOTO, AND A WORSE ONE. Every other check
// in this project asks whether a record's photograph is right. None asks
// whether the record still describes somewhere you can walk to. Gästehaus
// Ehrenberg is permanently closed and OSM node 6754051402 — untouched since
// 2019 — still lists it as a guest house. Nothing automatic reaches that.
//
// ⚠️ AND IT IS FIXED SOMEWHERE ELSE. A wrong photo is one row to delete; a
// closed hut has to be corrected in OpenStreetMap or the next generate-huts run
// puts it straight back. Hence its own table and its own queue.

export type PlaceReason =
  | 'closed'
  | 'moved'
  | 'wrong_details'
  | 'no_longer_lodging'
  | 'photos_wrong'
  | 'other';

export interface OpenPlaceReport {
  id: string;
  hutId: string;
  reason: PlaceReason;
  detail: string | null;
  createdAt: string;
  fixedUpstream: boolean;
}

export async function reportPlace(
  hutId: string,
  reason: PlaceReason,
  detail = '',
): Promise<'ok' | 'offline' | 'needs_account' | 'already' | 'failed'> {
  const c = db();
  if (!c) return 'offline';
  const who = await contributorId();
  if ('blocked' in who) return who.blocked;
  const uid = who.id;
  try {
    const { error } = await c.from('place_reports').insert({
      hut_id: hutId,
      reason,
      detail: detail.trim().slice(0, 500) || null,
      author_id: uid,
    });
    if (!error) { note(true, false); return 'ok'; }
    return error.code === '23505' ? 'already' : 'failed';
  } catch {
    note(false, true);
    return 'failed';
  }
}

export async function openPlaceReports(): Promise<OpenPlaceReport[]> {
  const c = db();
  if (!c) return [];
  try {
    const { data, error } = await c
      .from('place_reports')
      .select('id,hut_id,reason,detail,created_at,fixed_upstream')
      .eq('resolved', false)
      .order('created_at', { ascending: true })
      .limit(100);
    if (error || !data) return [];
    return data.map((r) => ({
      id: String(r.id),
      hutId: String(r.hut_id),
      reason: r.reason as PlaceReason,
      detail: r.detail ?? null,
      createdAt: String(r.created_at),
      fixedUpstream: Boolean(r.fixed_upstream),
    }));
  } catch {
    return [];
  }
}

/**
 * Close a place report.
 *
 * `fixedUpstream` records whether the correction actually reached
 * OpenStreetMap. Resolving without it is a note that the fix is not durable
 * yet — the next data regeneration will reinstate the place.
 */
export async function resolvePlaceReport(id: string, fixedUpstream: boolean): Promise<boolean> {
  const c = db();
  if (!c) return false;
  try {
    const { error } = await c
      .from('place_reports')
      .update({ resolved: true, fixed_upstream: fixedUpstream })
      .eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

// ── A hut the app does not have at all ──────────────────────────────────────

export type MissingKind =
  | 'alpine_hut'
  | 'wilderness_hut'
  | 'shelter'
  | 'guesthouse'
  | 'unknown';

export interface MissingPlaceReport {
  id: string;
  name: string;
  lat: number;
  lon: number;
  regionId: string | null;
  kind: MissingKind;
  detail: string | null;
  photoUrl: string | null;
  createdAt: string;
  fixedUpstream: boolean;
}

/**
 * Report a hut that is not in the app.
 *
 * ⚠️ THE PHOTO IS UPLOADED FIRST AND THE ROW ONLY IF THAT SUCCEEDS, and the
 * object is removed again if the row then fails. The alternative — row first,
 * photo after — leaves a report claiming a picture that is not there, which
 * reads to a moderator as a broken feature rather than a failed upload.
 *
 * ⚠️ EXIF IS STRIPPED BEFORE SENDING, exactly as in `submitPhoto`. This one
 * matters more, not less: the report already carries a position the person
 * chose to share, and the photo's own coordinates would be a second, unasked-
 * for record of where they actually stood.
 */
export async function reportMissingPlace(input: {
  name: string;
  lat: number;
  lon: number;
  regionId?: string | null;
  kind?: MissingKind;
  detail?: string;
  photoUri?: string;
}): Promise<'ok' | 'offline' | 'needs_account' | 'too_big' | 'unsupported' | 'failed'> {
  const c = db();
  if (!c) return 'offline';
  const who = await contributorId();
  if ('blocked' in who) return who.blocked;
  const uid = who.id;

  let path: string | null = null;
  try {
    if (input.photoUri) {
      const res = await fetch(input.photoUri);
      const raw = new Uint8Array(await res.arrayBuffer());
      if (raw.byteLength > 8 * 1024 * 1024) return 'too_big';
      const { bytes, handled } = stripExif(raw);
      if (!handled) return 'unsupported';
      path = `${uid}/missing-${Date.now()}.jpg`;
      const up = await c.storage.from('hut-photos').upload(path, bytes, {
        contentType: 'image/jpeg',
        upsert: false,
      });
      if (up.error) return 'failed';
    }

    const { error } = await c.from('missing_place_reports').insert({
      name: input.name.trim().slice(0, 120),
      lat: input.lat,
      lon: input.lon,
      region_id: input.regionId ?? null,
      kind: input.kind ?? 'unknown',
      detail: input.detail?.trim().slice(0, 500) || null,
      storage_path: path,
      author_id: uid,
    });
    if (error) {
      if (path) await c.storage.from('hut-photos').remove([path]).catch(() => {});
      return 'failed';
    }
    note(true, false);
    return 'ok';
  } catch {
    if (path) await c.storage.from('hut-photos').remove([path]).catch(() => {});
    note(false, true);
    return 'failed';
  }
}

/** Open reports of missing huts, for the moderation queue. */
export async function openMissingPlaceReports(): Promise<MissingPlaceReport[]> {
  const c = db();
  if (!c) return [];
  try {
    const { data, error } = await c
      .from('missing_place_reports')
      .select('id,name,lat,lon,region_id,kind,detail,storage_path,created_at,fixed_upstream')
      .eq('resolved', false)
      .order('created_at', { ascending: true })
      .limit(100);
    if (error || !data) return [];
    // The bucket is private, so a moderator needs signed URLs, not paths — and
    // one batched call rather than one per row, as the photo queue does.
    const paths = data.map((r) => r.storage_path).filter((p): p is string => Boolean(p));
    const signed = paths.length
      ? await c.storage.from('hut-photos').createSignedUrls(paths, 60 * 60)
      : { data: [] as { signedUrl: string }[] };
    const urlFor = new Map(paths.map((p, i) => [p, signed.data?.[i]?.signedUrl ?? '']));
    return data.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      lat: Number(r.lat),
      lon: Number(r.lon),
      regionId: r.region_id ? String(r.region_id) : null,
      kind: (r.kind ?? 'unknown') as MissingKind,
      detail: r.detail ?? null,
      photoUrl: r.storage_path ? (urlFor.get(String(r.storage_path)) ?? null) : null,
      createdAt: String(r.created_at),
      fixedUpstream: Boolean(r.fixed_upstream),
    }));
  } catch {
    return [];
  }
}

/** Close a missing-hut report. See `resolvePlaceReport` on `fixedUpstream`. */
export async function resolveMissingPlace(id: string, fixedUpstream: boolean): Promise<boolean> {
  const c = db();
  if (!c) return false;
  try {
    const { error } = await c
      .from('missing_place_reports')
      .update({ resolved: true, fixed_upstream: fixedUpstream })
      .eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

// ── Optional accounts: keeping your contributions when the phone changes ────

export interface AccountState {
  /** Signed in at all — anonymous counts, because every contributor has one. */
  signedIn: boolean;
  /** The address, once the account has one. Null while it is still anonymous. */
  email: string | null;
  /** True while the account is the automatic, device-only kind. */
  anonymous: boolean;
  /** Set after adding an address that has not been confirmed from the inbox. */
  pendingEmail: string | null;
}

export async function accountState(): Promise<AccountState> {
  const c = db();
  const none: AccountState = { signedIn: false, email: null, anonymous: false, pendingEmail: null };
  if (!c) return none;
  try {
    const { data } = await c.auth.getUser();
    const u = data.user;
    if (!u) return none;
    return {
      signedIn: true,
      email: u.email ?? null,
      // Supabase marks the automatic accounts; treat "no address" as anonymous
      // too, so an older session created before this flag still reads right.
      anonymous: Boolean(u.is_anonymous ?? !u.email),
      pendingEmail: (u.new_email as string | undefined) ?? null,
    };
  } catch {
    return none;
  }
}

export type AccountOutcome =
  | 'ok'
  | 'check_email'
  | 'offline'
  | 'bad_email'
  | 'weak_password'
  | 'wrong_details'
  | 'taken'
  | 'failed';

function readAuthError(message: string): AccountOutcome {
  const m = message.toLowerCase();
  if (m.includes('already registered') || m.includes('already been registered')) return 'taken';
  if (m.includes('password')) return 'weak_password';
  if (m.includes('email')) return 'bad_email';
  if (m.includes('invalid login') || m.includes('credentials')) return 'wrong_details';
  return 'failed';
}

/**
 * Add an email and password to the account this device already has.
 *
 * ⚠️ UPGRADE, NEVER SIGN UP AFRESH. `signUp()` would create a NEW user id, and
 * every photo, review and report is keyed to the old one — the person would
 * appear to lose everything they had contributed, with the rows still sitting
 * in the database owned by an identifier nobody can reach any more. Supabase
 * converts an anonymous user in place with `updateUser`, which keeps the id and
 * therefore keeps their work.
 *
 * ⚠️ AND IT IS OPTIONAL BY DESIGN. The app still creates an anonymous account
 * automatically on a first contribution; this is only for somebody who wants
 * their contributions to survive a new phone. Making it compulsory would put a
 * sign-up form in front of adding one photograph, which is the surest way to
 * get no photographs.
 */
export async function addEmailToAccount(
  email: string,
  password: string,
): Promise<AccountOutcome> {
  const c = db();
  if (!c) return 'offline';
  const uid = await ensureSession();
  if (!uid) return 'offline';
  if (password.length < 8) return 'weak_password';
  try {
    // The confirmation link has to land somewhere that says it worked — see
    // EMAIL_CONFIRMED_URL. Supabase ignores an address that is not in the
    // project's redirect allowlist, so this and the allowlist move together.
    const { error } = await c.auth.updateUser(
      { email: email.trim(), password },
      { emailRedirectTo: EMAIL_CONFIRMED_URL },
    );
    if (error) return readAuthError(error.message);
    // Supabase only applies the address once the link in the email is followed,
    // so promising "done" here would be a lie the next sign-in would expose.
    return 'check_email';
  } catch {
    return 'failed';
  }
}

/** Sign in on a new device, picking up everything that account has sent. */
export async function signIn(email: string, password: string): Promise<AccountOutcome> {
  const c = db();
  if (!c) return 'offline';
  try {
    const { error } = await c.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return readAuthError(error.message);
    // So a later launch with no signal still knows there is an account here —
    // see hasAccountOnThisPhone().
    await rememberAccount(true);
    return 'ok';
  } catch {
    return 'failed';
  }
}

/**
 * Sign out.
 *
 * ⚠️ ONLY SAFE ONCE THE ACCOUNT HAS AN ADDRESS. Signing out of an ANONYMOUS
 * account is an unmarked delete: there is no way back into it, and everything
 * it submitted becomes unreachable. The caller must not offer this until
 * `accountState().anonymous` is false, and this refuses it if they do.
 */
export async function signOut(): Promise<'ok' | 'anonymous' | 'failed'> {
  const c = db();
  if (!c) return 'failed';
  try {
    const { anonymous, signedIn } = await accountState();
    if (signedIn && anonymous) return 'anonymous';
    const { error } = await c.auth.signOut();
    if (!error) await rememberAccount(false);
    return error ? 'failed' : 'ok';
  } catch {
    return 'failed';
  }
}

/** Send a password-reset email. Says nothing about whether the address exists. */
export async function sendPasswordReset(email: string): Promise<'ok' | 'offline' | 'needs_account' | 'failed'> {
  const c = db();
  if (!c) return 'offline';
  try {
    // ⚠️ WITHOUT redirectTo THIS WAS A DEAD END. The link went to the project's
    // Site URL, which is the app's homepage — a page with no idea what the
    // token in its own address bar is for. docs/reset.html is the page that can
    // actually set the new password.
    const { error } = await c.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: PASSWORD_RESET_URL,
    });
    return error ? 'failed' : 'ok';
  } catch {
    return 'failed';
  }
}

/**
 * Is there an account on this phone — answered WITHOUT asking the server.
 *
 * ⚠️ THIS IS THE ONE ACCOUNT CHECK THAT HAS TO WORK WITH NO SIGNAL, and it is
 * why it cannot use `accountState()`. That reads `auth.getUser()`, which is a
 * network call: offline it fails, reports "no account", and would therefore
 * refuse to save a trip for somebody who signed in weeks ago. Saving happens in
 * exactly the places with no reception.
 *
 * ⚠️ AND `getSession()` ALONE IS NOT ENOUGH EITHER. It reads the persisted
 * session, which is local — but when the access token has expired it tries to
 * refresh it first, and offline that request fails and it answers null. Someone
 * who signed in a fortnight ago and has walked out of signal would be told they
 * have no account, which is the exact failure this function exists to avoid.
 *
 * Hence the flag: the moment an account is confirmed, that fact is written to
 * the phone, and it is what answers when the session cannot be read. It is only
 * ever consulted to decide whether to show a sign-up prompt — every call that
 * actually writes anything still has to satisfy the server, so a stale flag
 * costs a confusing error at worst, never access to anything.
 */
const HAS_ACCOUNT_KEY = 'alpine-huts.has-account';

async function rememberAccount(yes: boolean): Promise<void> {
  try {
    if (yes) await AsyncStorage.setItem(HAS_ACCOUNT_KEY, '1');
    else await AsyncStorage.removeItem(HAS_ACCOUNT_KEY);
  } catch {
    // A phone that cannot write this still works; it just asks again.
  }
}

export async function hasAccountOnThisPhone(): Promise<boolean> {
  const c = db();
  if (!c) return false;
  try {
    const { data } = await c.auth.getSession();
    const u = data.session?.user;
    if (u) {
      const real = !(u.is_anonymous ?? !u.email);
      void rememberAccount(real);
      return real;
    }
  } catch {
    // Fall through to the flag.
  }
  try {
    return (await AsyncStorage.getItem(HAS_ACCOUNT_KEY)) === '1';
  } catch {
    return false;
  }
}

// ── sharing a route ─────────────────────────────────────────────────────────
// ⚠️ A SHARED ROUTE IS NOT A CONTRIBUTION, AND IT IS NOT PUBLIC EITHER. Photos
// and reviews go to a moderator and then to everybody; this goes to whoever the
// author gives the code to, and to nobody else. The server enforces that with
// a security-definer function rather than a policy — see
// supabase/migrations/0007_shared_routes.sql, which explains why a select
// policy could not have done the job.
//
// ⚠️ THE PAYLOAD IS THE APP'S SHAPE, NOT THE SERVER'S. Whatever a trip contains
// is stored verbatim as JSON, so a route shared by today's app still opens in
// next year's. Nothing here reads inside it; the caller owns that.

/** A code as it is shown and typed: always the 8 characters the server made. */
export type ShareCode = string;

export interface SharedRoute {
  code: ShareCode;
  title: string;
  payload: unknown;
  createdAt: string;
}

export interface MyShare {
  code: ShareCode;
  title: string;
  opened: number;
  revoked: boolean;
  createdAt: string;
}

/**
 * Publish a trip under a code.
 *
 * ⚠️ AN ACCOUNT IS REQUIRED, AND HERE THAT IS NOT A POLICY CHOICE BUT THE POINT.
 * A shared route is a thing the author can revoke, correct and be asked about;
 * tied to an anonymous id it survives neither a new phone nor a question.
 */
export async function shareRoute(
  title: string,
  payload: unknown,
): Promise<{ code: ShareCode } | { blocked: 'offline' | 'needs_account' | 'too_big' | 'failed' }> {
  const c = db();
  if (!c) return { blocked: 'offline' };
  const who = await contributorId();
  if ('blocked' in who) return { blocked: who.blocked };
  // The server rejects anything past a megabyte. Catching it here lets the
  // caller drop the heavy part and try again rather than showing a failure.
  if (JSON.stringify(payload ?? null).length > 1_000_000) return { blocked: 'too_big' };
  try {
    const { data, error } = await c
      .from('shared_routes')
      .insert({ title: title.trim().slice(0, 120) || 'Shared route', payload, author_id: who.id })
      .select('code')
      .single();
    if (error || !data) { note(false, false); return { blocked: 'failed' }; }
    note(true, false);
    return { code: String(data.code) };
  } catch {
    note(false, true);
    return { blocked: 'offline' };
  }
}

/**
 * Open a route somebody shared with you.
 *
 * ⚠️ NO ACCOUNT NEEDED — only a session, which the app makes by itself. Being
 * given a route is not contributing, and making a stranger sign up to read a
 * friend's walk is how a shared link ends up unopened.
 */
export async function openSharedRoute(
  code: string,
): Promise<SharedRoute | 'not_found' | 'offline' | 'failed'> {
  const c = db();
  if (!c) return 'offline';
  const uid = await ensureSession();
  if (!uid) return 'offline';
  try {
    const { data, error } = await c.rpc('open_shared_route', { p_code: code.trim().toUpperCase() });
    if (error) { note(false, false); return 'failed'; }
    const row = Array.isArray(data) ? data[0] : data;
    // Not found and revoked are deliberately the same answer: telling a
    // stranger that a code "used to exist" is information the author took back.
    if (!row) return 'not_found';
    note(true, false);
    return {
      code: String(row.code),
      title: String(row.title ?? 'Shared route'),
      payload: row.payload,
      createdAt: String(row.created_at),
    };
  } catch {
    note(false, true);
    return 'offline';
  }
}

/** Every code this account has handed out, newest first. */
export async function mySharedRoutes(): Promise<MyShare[]> {
  const c = db();
  if (!c) return [];
  try {
    const { data, error } = await c
      .from('shared_routes')
      .select('code,title,opened,revoked,created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error || !data) return [];
    return data.map((r) => ({
      code: String(r.code),
      title: String(r.title),
      opened: Number(r.opened ?? 0),
      revoked: Boolean(r.revoked),
      createdAt: String(r.created_at),
    }));
  } catch {
    return [];
  }
}

/**
 * Stop sharing a code.
 *
 * ⚠️ REVOKE, NOT DELETE, so somebody who already has the code is told the
 * sharing stopped rather than that the code was never real — and so a mistaken
 * revoke can be undone. Deleting the row is what "delete everything I have
 * sent" does.
 */
export async function stopSharing(code: ShareCode, stop = true): Promise<boolean> {
  const c = db();
  if (!c) return false;
  try {
    const { error } = await c.from('shared_routes').update({ revoked: stop }).eq('code', code);
    return !error;
  } catch {
    return false;
  }
}
