/**
 * The app's public addresses, in one place.
 *
 * ⚠️ APPLE CHECKS THAT THE PRIVACY POLICY IS REACHABLE, and it is now linked
 * from two screens — the Account tab and About. Two copies of the URL is two
 * chances for one of them to rot into a 404 that nobody notices until a review
 * is rejected. So both read it from here.
 *
 * Served from the repo's `docs/` folder via GitHub Pages, which means the same
 * commit that edits the policy publishes it.
 */
export const SITE_URL = 'https://msoederhuizen.github.io/alpine-huts/';
export const PRIVACY_URL = `${SITE_URL}privacy.html`;

/**
 * Where the two account emails land.
 *
 * ⚠️ THESE ARE NOT COSMETIC. Supabase sends a link that redirects to whichever
 * address the request names, carrying its token in the URL fragment — and the
 * app cannot read one: it is built with `detectSessionInUrl: false` and has no
 * deep-link callback. Without a page that can, "I have forgotten my password"
 * sends a real email to a real person who arrives at a homepage with nothing to
 * do, and the account is lost for good.
 *
 * ⚠️ BOTH MUST ALSO BE IN SUPABASE'S REDIRECT ALLOWLIST (Authentication → URL
 * Configuration). An address that is not on that list is ignored and the user
 * is sent to the Site URL instead — which looks exactly like this code not
 * working, with nothing in the logs to say otherwise.
 */
export const PASSWORD_RESET_URL = `${SITE_URL}reset.html`;
export const EMAIL_CONFIRMED_URL = `${SITE_URL}confirmed.html`;
