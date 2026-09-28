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
): Promise<'ok' | 'offline' | 'failed'> {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return 'failed';
  const c = db();
  if (!c) return 'offline';
  const uid = await ensureSession();
  if (!uid) return 'offline';
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
): Promise<'ok' | 'offline' | 'already' | 'failed'> {
  const c = db();
  if (!c) return 'offline';
  const uid = await ensureSession();
  if (!uid) return 'offline';
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
): Promise<'ok' | 'offline' | 'too_big' | 'unsupported' | 'failed'> {
  const c = db();
  if (!c) return 'offline';
  const uid = await ensureSession();
  if (!uid) return 'offline';
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
): Promise<'ok' | 'offline' | 'already' | 'failed'> {
  const c = db();
  if (!c) return 'offline';
  const uid = await ensureSession();
  if (!uid) return 'offline';
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
