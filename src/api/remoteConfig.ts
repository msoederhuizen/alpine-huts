import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Settings the app reads from the web at startup, so they can change without
 * shipping a new version.
 *
 * ⚠️ WHY THIS EXISTS. The routing server's address used to be compiled in from
 * `EXPO_PUBLIC_BROUTER_URL` at BUILD time. Move the server — or have its host
 * go away — and every installed copy of the app loses route planning, with the
 * only fix being an App Store release and waiting for people to update. For an
 * app whose whole point is planning walks, that is a single point of failure
 * held together by a value frozen months earlier.
 *
 * Now the address is fetched from a small JSON file on the project's own site.
 * Changing routing host becomes a `git push`, and every installed copy follows
 * within a day, including versions from years back.
 *
 * ⚠️ IT MUST NEVER BE ABLE TO BREAK THE APP. The app works offline and that is
 * not negotiable, so this is built to fail silently and often:
 *
 *   - the CACHED copy is read first, so startup never waits on the network
 *   - a fetch failure is ignored entirely; the previous values stay
 *   - anything malformed is rejected rather than stored
 *   - with no cache and no network, the compiled-in defaults still apply
 *
 * The worst case is that the app behaves exactly as it did before this file
 * existed. That is the design, not a compromise.
 */

/** Where the settings live. Served from the repo's `docs/` folder by GitHub
 *  Pages, so the same commit that changes them publishes them. */
const CONFIG_URL = 'https://msoederhuizen.github.io/alpine-huts/config.json';

const CACHE_KEY = 'alpine-huts.remote-config';

/** Short: this runs at startup and nothing may wait on it. */
const TIMEOUT_MS = 4000;

export interface RemoteConfig {
  /** Base URL of the routing server, without a trailing slash. */
  brouterUrl?: string;
  /** Address shown on the About screen. */
  supportEmail?: string;
  /**
   * A short message to show users — "routing is down for maintenance", say.
   * The one lever that can explain a problem to people already out walking
   * without shipping anything.
   */
  notice?: string;
}

let current: RemoteConfig = {};

/**
 * Reject anything that would break routing rather than store it.
 *
 * ⚠️ A bad value here reaches every user at once, so the check is deliberately
 * strict: https only (iOS App Transport Security blocks plain http, so an
 * http URL would silently fail on every iPhone), and a host that at least
 * looks like a host. Rejecting a good value costs nothing — the previous one
 * stays. Accepting a bad one takes routing down everywhere.
 */
function validUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\/+$/, '');
  return /^https:\/\/[^/\s.]+\.[^/\s]+/i.test(trimmed) ? trimmed : undefined;
}

function validEmail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(trimmed) ? trimmed : undefined;
}

function sanitize(raw: unknown): RemoteConfig {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: RemoteConfig = {};
  const url = validUrl(r.brouterUrl);
  if (url) out.brouterUrl = url;
  const email = validEmail(r.supportEmail);
  if (email) out.supportEmail = email;
  // Truncated: this is rendered, and a runaway string should not be able to
  // take over a screen.
  if (typeof r.notice === 'string' && r.notice.trim()) {
    out.notice = r.notice.trim().slice(0, 280);
  }
  return out;
}

/**
 * Load the settings: cache first, then the network in the background.
 *
 * Resolves as soon as the cache has been read, so the caller can await it
 * without waiting on a request. The fetch continues afterwards and updates the
 * values in place — a change therefore takes effect on the NEXT launch, which
 * is the right trade: nothing on screen shifts under the user mid-session.
 */
export async function loadRemoteConfig(): Promise<void> {
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (cached) current = sanitize(JSON.parse(cached));
  } catch {
    // Unreadable or corrupt cache is the same as no cache.
  }

  // Not awaited: startup carries on while this runs.
  void (async () => {
    try {
      const res = await fetch(CONFIG_URL, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        // Ask for a fresh copy: a stale CDN answer would defeat the point of
        // being able to change the routing host in a hurry.
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) return;
      const fetched = sanitize(await res.json());
      // An empty object means everything in it was rejected, or the file is
      // empty. Either way, keep what we had.
      if (!Object.keys(fetched).length) return;
      current = fetched;
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(fetched));
    } catch {
      // Offline, timed out, or malformed. The cached values stand.
    }
  })();
}

/** The routing server address from the web, or undefined to use the built-in. */
export function remoteBrouterUrl(): string | undefined {
  return current.brouterUrl;
}

/** The support address from the web, or undefined to use the built-in. */
export function remoteSupportEmail(): string | undefined {
  return current.supportEmail;
}

/** A message to show users, or undefined. */
export function remoteNotice(): string | undefined {
  return current.notice;
}
