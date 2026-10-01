/**
 * Hosts this project will not take photographs from, whatever they show.
 *
 * ⚠️ A DIFFERENT THING FROM `photoBlocklist.ts`, WHICH IS WHY IT LIVES APART.
 * That list is per HUT — "this picture is of the wrong building" — and its own
 * comment says `url: "*"` "never means every photo from that host". This list
 * is per SOURCE, and the reason is never that the photo is wrong: it is that we
 * have no right to show it. Conflating the two would let a licensing decision
 * be undone by somebody tidying up a mis-matched image.
 *
 * ⚠️ AND IT IS ABOUT RIGHTS, NOT QUALITY. A TripAdvisor photograph is usually a
 * perfectly good picture of the correct hut. It is also somebody's, uploaded
 * under terms that do not let a third party redistribute it in an app — and
 * crediting it does not change that: attribution is a condition of a licence,
 * not a substitute for one.
 */
export const BLOCKED_PHOTO_HOSTS: { host: RegExp; why: string }[] = [
  {
    host: /(^|\.)tripadvisor\.(com|[a-z]{2})$|(^|\.)media-cdn\.tripadvisor\.com$/i,
    why:
      'User-uploaded reviews. TripAdvisor\'s terms do not permit a third party to ' +
      'redistribute member photographs, and there is no per-image licence to rely ' +
      'on. Excluded on the app author\'s instruction, 2026-09-30.',
  },
  {
    host: /(^|\.)booking\.com$/i,
    why:
      'Same position as TripAdvisor: property and guest photographs under terms ' +
      'that do not extend to reuse. Excluded on the app author\'s instruction. ' +
      'NOTE this matches booking.com ONLY — a hut\'s own booking page on its own ' +
      'domain (simplebooking.it, bookingturbo.com, a property\'s booking. ' +
      'subdomain) is the hut publishing its own photo and stays allowed.',
  },
];

/** True when no photograph may be taken from this URL's host. */
export function isBlockedPhotoHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return false;
  }
  return BLOCKED_PHOTO_HOSTS.some((b) => b.host.test(host));
}

/** Which rule blocked it, for reporting. */
export function blockedHostReason(url: string): string | undefined {
  try {
    const host = new URL(url).host;
    return BLOCKED_PHOTO_HOSTS.find((b) => b.host.test(host))?.why;
  } catch {
    return undefined;
  }
}
