/**
 * Deciding whether a domain belongs to a place, or merely writes about it.
 *
 * ⚠️ ONE COPY. This logic lived in two scripts and had already drifted once.
 * The same duplication in `isPhoto` cost this project every camera photo with
 * EXIF, because the fix landed in one copy and not the other.
 */

/** Public second levels, so `foo.co.uk` registers at `foo.co.uk`. Crude next to
 *  the real public-suffix list, and sufficient: the Alpine ccTLDs (.at .ch .it
 *  .fr .de .si) all register at the second level. */
const SECOND_LEVEL = /^(co|com|net|org|gov|ac|edu)$/;

/**
 * Hosts where a SUBDOMAIN really is somebody's own site.
 *
 * ⚠️ The opposite of a booking portal, and indistinguishable from one by shape
 * alone — both hand out `name.theirdomain.com`. The difference is what the
 * parent does: a site builder rents you a page you control and fill, a portal
 * lists you among competitors. `landhaus-mayr.jimdoweb.com` is the Landhaus's
 * own site; `gasperlerhof.hotelsintyrol.com` is a listing.
 *
 * So builders are named explicitly and everything else is judged on its
 * registrable domain.
 */
const SITE_BUILDERS =
  /^(jimdoweb|jimdofree|jimdosite|carrd|wixsite|weebly|squarespace|webnode|webs|1and1|business\.site|myportfolio|strikingly|tilda|editorx|netlify|github|pages\.dev|wordpress|blogspot)\b/i;

/** `gasperlerhof.hotelsintyrol.com` → `hotelsintyrol.com`, but
 *  `landhaus-mayr.jimdoweb.com` → `landhaus-mayr.jimdoweb.com`. */
export function registrableDomain(host: string): string {
  const clean = host.replace(/^www\./i, '').toLowerCase();
  const parts = clean.split('.');
  if (parts.length <= 2) return clean;

  const twoLevel = SECOND_LEVEL.test(parts[parts.length - 2])
    ? parts.slice(-3).join('.')
    : parts.slice(-2).join('.');

  // On a builder, the label in front is the part that belongs to the business,
  // so keep it — otherwise every builder-hosted site would be rejected as
  // "the name is not in jimdoweb.com".
  return SITE_BUILDERS.test(twoLevel) ? clean : twoLevel;
}

/**
 * Portals that either hand out a subdomain per property, or whose own name
 * contains a place word and so passes a naive name-in-domain test.
 *
 * Every entry here was observed escaping in a real run — this is a record of
 * measured failures, not a guess at what might exist.
 */
export const PORTAL =
  /(hotels?-?in-?tyrol|hotelsintyrol|italianalpshotel|top-hotels-|com-bavaria|ibooked|grisonshotelsweb|cortinadampezzohotels|hotelinveneto|hotels-veneto|slovenia-hotel|swissalpshotels|tripcombined|inn\.fan|at-austria|hotelszermatt|obertauernhotelrooms|hotelrooms|visitdolomiti|tontondesalpes|booking\.com|tripadvisor|expedia|hotels\.com|airbnb|agoda|trivago|hrs\.de|hostelworld|kayak|priceline|yelp|foursquare|gaiagps|wanderlog|mapcarta|peakvisor|mindat|geonames|tracedetrail|visorando|camptocamp|alpenvereinaktiv|bergsteigen\.com|waymarkedtrails|facebook\.|instagram\.|youtube\.|pinterest\.|wikipedia\.|wikimedia\.|openstreetmap\.|komoot\.|outdooractive\.|alltrails\.|wikiloc\.|bergfex\.|refuges\.info|google\.|bing\.)/i;
