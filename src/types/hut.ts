export type HutType =
  | 'alpine_hut'
  | 'wilderness_hut'
  | 'shelter'
  | 'guesthouse'
  | 'village';

/**
 * A mountain hut, derived from an OpenStreetMap element (node or way).
 * `id` is the OSM element id in "node/123" / "way/456" form so it's stable
 * and unique across element types.
 */
export interface Hut {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Elevation in metres, when the OSM `ele` tag is present and parseable. */
  elevation?: number;
  type: HutType;
  /** Direct image URL from the OSM `image` tag, if any. */
  image?: string;
  /** Raw OSM `wikimedia_commons` tag (e.g. "File:Foo.jpg"), if any. */
  wikimediaCommons?: string;
  /** The hut's own website (`website` / `contact:website` / `url`), if any. */
  website?: string;
  /** A dedicated online-reservation URL (`reservation:website`), if any. */
  reservationWebsite?: string;
  /** Wikidata QID (e.g. "Q863996") — used to look up a photo when OSM has none. */
  wikidata?: string;
  /** Wikipedia article reference (`lang:Title`), if any. */
  wikipedia?: string;
  /** Fallback booking site (hut-reservation.org) when a hut has no own links. */
  bookingUrl: string;
  /**
   * Routing-only waypoints for the leg arriving AT this hut — not stops, and
   * never a day of their own.
   *
   * Some published stages take a high line the router won't choose on its own:
   * left alone it drops to the valley, because that is genuinely shorter and
   * easier. Europahütte→Zermatt came out as 13.1 km with +239 m (the road
   * through Randa) instead of the Europaweg. Forcing the line by adding the
   * intermediate as a STOP works, but invents an overnight halt the itinerary
   * doesn't have. These points shape the leg while leaving the day count alone.
   */
  via?: { lat: number; lon: number }[];
  /** All raw OSM tags, kept for later features (contact, capacity, etc.). */
  tags: Record<string, string>;
}
