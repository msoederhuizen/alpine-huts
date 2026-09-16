import { Ionicons } from '@expo/vector-icons';
import { SacInfoButton } from '../../src/components/SacInfoButton';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Keyboard,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchRides } from '../../src/api/lifts';
import { coloredShadow, COLORS, GRADIENT, RADIUS } from '../../src/constants/theme';
import { ProgressDonut } from '../../src/components/ProgressDonut';
import { DayIssueCard } from '../../src/components/plan/DayIssueCard';
import { formStyles } from '../../src/components/plan/formStyles';
import {
  NumberField,
  OptionStat,
  OptionToggle,
  RangeControl,
} from '../../src/components/plan/PlanControls';
import {
  CLASSIC_ROUTES,
  isRouteReady,
  resolveClassicRoute,
  type ClassicRoute,
} from '../../src/constants/classicRoutes';
import { REGIONS, regionForPoint } from '../../src/constants/region';
import {
  bundledHutById,
  bundledRegionOf,
  bundledRides,
  searchBundledPlaces,
} from '../../src/data/hutBundle';
import { MaxDifficultyPicker } from '../../src/components/MaxDifficultyPicker';
import { useHuts } from '../../src/hooks/useHuts';
import { legQueryOptions } from '../../src/hooks/useRouteLegs';
import { useVillages } from '../../src/hooks/useVillages';
import { useAlternativesStore } from '../../src/store/alternativesStore';
import { useSelectedRegionsStore } from '../../src/store/selectedRegionsStore';
import { useTripStore } from '../../src/store/tripStore';
import type { Hut, HutType } from '../../src/types/hut';
import { formatDistance, formatElevation } from '../../src/utils/format';
import {
  compareRating,
  donutProgress,
  ratingIsClean,
  ratingKey,
  ratingSummary,
  rideNote,
} from '../../src/utils/planRating';
import {
  SAC_SCALE_DIFFICULTY,
  SAC_SCALE_GRADE,
  SAC_SCALE_ORDER,
  type SacScale,
} from '../../src/utils/sacScale';
import { ACCOM_TYPES, hutTypeLabel } from '../../src/utils/hutMeta';
import {
  planRoute,
  type DayCompromise,
  type PlanOutcome,
} from '../../src/utils/planRoute';

/** A notice shown after generation: either informational (OK only) or a review
 *  the user must accept/cancel before the route is applied. */
interface PlanNotice {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  title: string;
  /** Plain lines shown above any per-day breakdown. */
  items?: string[];
  /** Per-day criteria that had to be relaxed, shown as individual cards. */
  dayIssues?: DayCompromise[];
  /** Total days in the route, so the summary can read "2 of 5 days" rather than
   *  a bare count — "2 days couldn't meet your criteria" gives no sense of
   *  whether that's most of the trip or a small part of it. */
  totalDays?: number;
  /** Present only for a route awaiting the user's accept/cancel. */
  onConfirm?: () => void;
  confirmLabel?: string;
  /** Overrides the dismiss button's label (default "Cancel"). */
  cancelLabel?: string;
}

/** One card in the alternative-routes carousel. */
interface PlanRouteOption {
  key: string;
  /** Distance-position label among the shown cards ("Shorter"/"Longer"/…). */
  label: string;
  /** The genuinely best-rated route (may be any card, not always the balanced). */
  recommended: boolean;
  outcome: PlanOutcome;
}

export default function PlanScreen() {
  const { huts, isLoading: hutsLoading } = useHuts();
  const villages = useVillages();
  const setTrip = useTripStore((s) => s.setTrip);
  // Classic routes resolved against the bundle once. Only offered when their
  // stages actually resolve — a region the user hasn't loaded won't parse, so a
  // route whose huts are all missing is hidden rather than shown as a dead card.
  // Every curated route, resolved where possible. Routes whose stages aren't
  // verified yet (or whose region's offline data hasn't been generated) are kept
  // in the list but shown as unavailable — they're a visible roadmap rather than
  // silently absent, and tapping one can't load a half-built itinerary.
  const classicRoutes = useMemo(
    () =>
      CLASSIC_ROUTES.map((route) => {
        const { huts, missing } = resolveClassicRoute(route, bundledHutById);
        return { route, huts, missing, ready: isRouteReady(route) && huts.length > 0 };
      }),
    [],
  );

  /** Grouped into one dropdown per country, preserving declaration order. */
  const classicByCountry = useMemo(() => {
    const byCountry = new Map<string, typeof classicRoutes>();
    for (const entry of classicRoutes) {
      const list = byCountry.get(entry.route.country);
      if (list) list.push(entry);
      else byCountry.set(entry.route.country, [entry]);
    }
    return [...byCountry.entries()];
  }, [classicRoutes]);

  /** The single "Select your route" menu. Countries inside it don't collapse —
   *  they're indentation levels in one list, not nested dropdowns. */
  const [classicOpen, setClassicOpen] = useState(false);
  /** Hardest trail grade to allow. Undefined = no limit. */
  const [maxSac, setMaxSac] = useState<SacScale | undefined>(undefined);

  const previewTrip = useTripStore((s) => s.previewTrip);
  const router = useRouter();

  /**
   * Load a classic route as the current trip. Lands on the Route tab, not the
   * Map: these are starting points to review, and the Route tab is where days are
   * reordered, removed and saved.
   */
  const loadClassicRoute = useCallback(
    (route: ClassicRoute, huts: Hut[], missing: string[]) => {
      // ⚠️ SCENIC ON. These are published mountain routes, and their stages cross
      // passes the effort-optimised line goes round: without it the Via Alpina's
      // Elm→Linthal came back at +220 m instead of +1524 m over the Richetlipass,
      // and Grindelwald→Lauterbrunnen at +313 m instead of +1149 m over the
      // Kleine Scheidegg. Drawing the valley road for a stage that crosses a pass
      // isn't a milder version of the route, it's a different walk.
      //
      // Checked before enabling: of 174 legs, 28 change and NONE of them is one
      // confirmed against a GPX the user supplied (Adlerweg 11, Schladminger 6–7,
      // Berliner 2/3/7, Besseggen). Scenic sharpens the unverified legs and
      // leaves the verified ones exactly where they are.
      //
      // No rides: nothing was generated here, so there are no lift choices to
      // replay — legs get routed from the stops themselves.
      setTrip(huts, true, []);
      if (missing.length > 0) {
        // Never silently short-change an itinerary — a walker can't tell a day is
        // absent just by looking at the list.
        Alert.alert(
          route.name,
          `Loaded ${huts.length} of ${route.stageIds?.length ?? huts.length} stages. ` +
            `${missing.length} couldn’t be found in the offline data, so that ` +
            `part of the route is missing — add it by hand on the Route tab.`,
        );
      }
      router.navigate('/route');
    },
    [setTrip, router],
  );
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();

  const [start, setStart] = useState<Hut | null>(null);
  const selectedRegionIds = useSelectedRegionsStore((st) => st.selected);
  const addRegion = useSelectedRegionsStore((st) => st.add);
  const [days, setDays] = useState('3');
  const [kmMin, setKmMin] = useState('10');
  const [kmMax, setKmMax] = useState('15');
  const [ascentMin, setAscentMin] = useState('500');
  const [ascentMax, setAscentMax] = useState('1000');
  const [descentMin, setDescentMin] = useState('500');
  const [descentMax, setDescentMax] = useState('1000');
  const [types, setTypes] = useState<Set<HutType>>(() => new Set(ACCOM_TYPES));
  const [roundtrip, setRoundtrip] = useState(true);
  const [scenic, setScenic] = useState(false);
  const [useLifts, setUseLifts] = useState(false);
  // Off by default: the app's premise is hut-to-hut, so a village night should
  // be something you opt into rather than something the generator quietly does.
  const [allowVillages, setAllowVillages] = useState(false);

  const toggleType = (t: HutType) =>
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  // When "Scenic route" auto-widens a max to 1500 we remember what it was, so
  // turning on lifts (which remove the need for a wide climbing range) can undo
  // it — but only if the user hasn't edited that field by hand since (which
  // clears the memory via the wrapped setters below).
  const autoAscentPrev = useRef<string | null>(null);
  const autoDescentPrev = useRef<string | null>(null);

  // Wrapped max setters: a manual edit clears the "scenic auto-widened" memory,
  // so lifts won't later overrule a value the user chose themselves.
  const onAscentMax = (v: string) => {
    autoAscentPrev.current = null;
    setAscentMax(v);
  };
  const onDescentMax = (v: string) => {
    autoDescentPrev.current = null;
    setDescentMax(v);
  };

  const toggleScenic = () => {
    const next = !scenic;
    setScenic(next);
    // Turning scenic ON widens the ascent/descent ceilings to 1500 (scenic
    // mountain routes climb & descend a lot) so they aren't rejected — the user
    // can trim these back just below. Remember the prior value so turning on
    // lifts can undo it. Only ever widens, never shrinks.
    if (next) {
      const na = parseFloat(ascentMax);
      if (!(Number.isFinite(na) && na >= 1500)) {
        autoAscentPrev.current = ascentMax;
        setAscentMax('1500');
      }
      const nd = parseFloat(descentMax);
      if (!(Number.isFinite(nd) && nd >= 1500)) {
        autoDescentPrev.current = descentMax;
        setDescentMax('1500');
      }
    }
  };

  const toggleLifts = () => {
    const next = !useLifts;
    setUseLifts(next);
    // A lift/train skips the climb, so the wide scenic range isn't needed. If
    // scenic auto-widened a max and it hasn't been edited by hand since, undo
    // that widening (1500 → back to what it was). Manually-set values are kept.
    if (next) {
      if (autoAscentPrev.current !== null) {
        setAscentMax(autoAscentPrev.current);
        autoAscentPrev.current = null;
      }
      if (autoDescentPrev.current !== null) {
        setDescentMax(autoDescentPrev.current);
        autoDescentPrev.current = null;
      }
    }
  };

  // Only these places may be used as overnight stops by the generator.
  const eligibleHuts = useMemo(
    () => huts.filter((h) => types.has(h.type)),
    [huts, types],
  );

  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [progress, setProgress] = useState<{
    day: number;
    total: number;
    /** Shown while generating one of the two alternative routes (after the
     *  main route turned out to need compromises). */
    variantLabel?: string;
    /**
     * Which search of `ALT_PHASES` (see src/utils/planRating.ts) is running
     * (0-based), for the
     * alternatives hunt. The ring spans ALL the searches as one 0→100% sweep, so
     * it only ever moves forward.
     *
     * It used to be reset to day 1 for each phase, which made the donut appear to
     * "reload" — the balanced search filled the ring, then it emptied and filled
     * again for the shorter/longer pair. That's meaningful if you know three
     * routes are being explored, and baffling if you don't.
     */
    phase?: number;
  } | null>(null);
  const [notice, setNotice] = useState<PlanNotice | null>(null);
  const [options, setOptions] = useState<PlanRouteOption[] | null>(null);
  const [optionPage, setOptionPage] = useState(0);
  const [panelWidth, setPanelWidth] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const startOptions = useMemo(() => {
    // Villages first — trips ideally start (and end) at a village trailhead.
    const all = [...(villages ?? []), ...huts];
    const q = search.trim().toLowerCase();
    if (!q) return all.slice(0, 100);
    const loaded = all.filter((h) => h.name.toLowerCase().includes(q));
    // ⚠️ Then everywhere else. Starting a trip from a place outside the selected
    // regions is completely reasonable — you might be walking INTO your chosen
    // area — so the picker must not hide it. Picking one adds its region (see
    // the row's onPress). Same all-regions index the Map tab's search uses.
    const seen = new Set(loaded.map((h) => h.id));
    const elsewhere = searchBundledPlaces(q, 60)
      .filter((e) => !seen.has(e.hut.id))
      .map((e) => e.hut);
    return [...loaded, ...elsewhere].slice(0, 100);
  }, [huts, villages, search]);

  const onGenerate = async () => {
    if (!start) {
      Alert.alert('Pick a starting point first');
      return;
    }
    if (types.size === 0) {
      Alert.alert(
        'Pick at least one accommodation type',
        'The route needs somewhere to stay overnight.',
      );
      return;
    }
    const input = {
      start,
      days: Math.max(1, Math.min(14, parseInt(days, 10) || 3)),
      kmMin: parseFloat(kmMin) || 0,
      kmMax: parseFloat(kmMax) || 100,
      ascentMin: parseFloat(ascentMin) || 0,
      ascentMax: parseFloat(ascentMax) || 3000,
      descentMin: parseFloat(descentMin) || 0,
      descentMax: parseFloat(descentMax) || 3000,
      roundtrip,
      maxSac,
      allowVillages,
    };
    // Villages are needed for a one-way trip's finish (rule 4) and, when the
    // toggle is on, for every day's candidate slate — so either case needs them
    // loaded before a search can be meaningful.
    if ((!roundtrip || allowVillages) && (villages?.length ?? 0) === 0) {
      Alert.alert('Villages still loading', 'Give it a second and try again.');
      return;
    }

    const applyOutcome = (outcome: PlanOutcome) => {
      // scenic drives which walk geometry the map fetches; legRides replays the
      // exact lift/train segments the generator chose.
      setTrip(outcome.huts, scenic, outcome.legRides);
      // Land on the Map so the trail shows right away (numbered pins + orange
      // trail lines, auto-framed). Reorder/save live on the Route tab.
      router.navigate('/');
    };

    // A route is only usable if it satisfies the hard rules: all requested days,
    // and (one-way) finishing at a village. Rule 7 is enforced inside planRoute,
    // so a route that stopped short means the limits couldn't be met — treat as
    // a failure, not a partial suggestion.
    const isComplete = (o: PlanOutcome) =>
      o.plannedDays >= o.requestedDays && (roundtrip || o.endsAtVillage);

    // Build the alternative cards from every route surfaced by the three biased
    // searches — each search returns its whole surviving beam (up to BEAM_WIDTH
    // distinct routes, not just its own winner; see planRoute's return), so
    // pooling all three gives up to ~9 candidates to pick 3 genuinely different
    // ones from, rather than just the 3 searches' single best picks. That's what
    // makes "always show 3 alternatives" actually achievable in practice.
    const showOptions = (
      balancedAll: PlanOutcome[],
      underAll: PlanOutcome[],
      overAll: PlanOutcome[],
    ) => {
      const sig = (o: PlanOutcome) => o.huts.map((h) => h.id).join('|');
      const seen = new Set<string>();
      const unique: PlanOutcome[] = [];
      for (const o of [...balancedAll, ...underAll, ...overAll]) {
        if (!isComplete(o)) continue;
        const s = sig(o);
        if (seen.has(s)) continue;
        seen.add(s);
        unique.push(o);
      }

      if (unique.length <= 1) {
        const fallback = unique[0] ?? balancedAll[0];
        setNotice({
          icon: 'alert-circle',
          iconColor: '#ef6c00',
          title: 'Closest route',
          items: [
            'This is the closest route to your criteria — some days fall outside your ranges:',
          ],
          dayIssues: fallback.compromises,
          totalDays: fallback.plannedDays,
          onConfirm: () => applyOutcome(fallback),
          confirmLabel: 'Use this route',
        });
        return;
      }

      // Rank every distinct route by closest fit to the inputs (see ratingKey).
      const ranked = unique.sort((a, b) =>
        compareRating(ratingKey(a, roundtrip), ratingKey(b, roundtrip)),
      );

      // How many of two routes' stops (by day position) differ. Fixed points
      // (the shared start; a roundtrip's mandatory return) always match, so
      // they naturally contribute 0 — no need to special-case them.
      const stopsDiffer = (a: PlanOutcome, b: PlanOutcome): number => {
        const len = Math.max(a.huts.length, b.huts.length);
        let diff = 0;
        for (let i = 0; i < len; i++) if (a.huts[i]?.id !== b.huts[i]?.id) diff++;
        return diff;
      };

      // Alternative 1 is always the outright best fit. For 2 and 3, prefer a
      // route that's MEANINGFULLY different from what's already picked over
      // the next-best score — the pool is drawn from nearby beam-search
      // branches, so without this the top 3 by score alone tended to be
      // near-duplicates differing by one hut on one day. Falls back to
      // filling remaining slots with the next-best regardless of diversity if
      // there aren't 3 sufficiently different feasible routes in the pool —
      // 3 close alternatives beats fewer than 3 at all.
      const minDiffDays = Math.max(1, Math.round(input.days * 0.3));
      const top: PlanOutcome[] = [];
      for (const o of ranked) {
        if (top.length >= 3) break;
        if (top.every((p) => stopsDiffer(o, p) >= minDiffDays)) top.push(o);
      }
      for (const o of ranked) {
        if (top.length >= 3) break;
        if (!top.includes(o)) top.push(o);
      }

      // Alternative 1 (the recommended, best fit), Alternative 2, Alternative
      // 3 — best-fit first.
      const cards: PlanRouteOption[] = top.map((o, i) => ({
        key: sig(o),
        label: i === 0 ? 'Alternative 1 (Recommended)' : `Alternative ${i + 1}`,
        recommended: i === 0,
        outcome: o,
      }));
      setOptionPage(0); // open on Alternative 1 (best fit)
      setOptions(cards);

      // Remember these alternatives (and default-preview the best fit) so the
      // Map tab can offer the same swipe-to-compare — the user can decide from
      // there, even without touching this carousel at all.
      useAlternativesStore.getState().setOptions(cards, scenic);
      previewTrip(top[0].huts, scenic, top[0].legRides);
    };

    // Lifts/trains are scoped to the region the trip STARTS in (a route stays
    // near its start, and fetching every region's lifts would be wasteful) —
    // fetched (and cached per region) only when the option is on. A failed fetch
    // just falls back to walking, never blocks generation. Query-cache backed,
    // so calling this again (for the background prefetch below) is instant.
    const rideRegion =
      regionForPoint(input.start.lat, input.start.lon) ?? REGIONS[0];
    // Prefer the shipped snapshot — that's what makes lift-assisted planning
    // work with no signal. `bundledRides` returns undefined only when this
    // region's rides were never generated, in which case we fall back to the
    // live Overpass fetch (which needs network, and fails to [] without it).
    const getRideList = async () => {
      if (!useLifts) return [];
      const offline = bundledRides(rideRegion.id);
      if (offline) return offline;
      return queryClient
        .ensureQueryData({
          queryKey: ['rides', rideRegion.id],
          queryFn: ({ signal }: { signal: AbortSignal }) =>
            fetchRides(rideRegion.bbox, signal),
          staleTime: 1000 * 60 * 60,
        })
        .catch(() => []);
    };

    const genFailed = (err: unknown) =>
      setNotice({
        icon: 'close-circle',
        iconColor: '#b00020',
        title: 'Generation failed',
        items: [err instanceof Error ? err.message : 'Please try again.'],
      });

    // One biased search, parameterised so the SAME call can drive either the
    // foreground pass (visible progress donut) or a silent background
    // prefetch (`onProgress` a no-op — nothing on screen is showing it yet).
    const generate = (
      bias: 'balanced' | 'under' | 'over',
      bestEffort: boolean,
      rideList: Awaited<ReturnType<typeof getRideList>>,
      signal: AbortSignal,
      onProgress: (day: number, total: number) => void,
    ) =>
      planRoute(
        { ...input, bias, bestEffort },
        eligibleHuts,
        villages ?? [],
        (from, to) => queryClient.ensureQueryData(legQueryOptions(from, to, scenic)),
        onProgress,
        signal,
        rideList,
      );

    // Second pass: build the three biased routes and show them as a carousel.
    // `precomputed` reuses run()'s own 'balanced' search when it already ran
    // with this exact bestEffort — recomputing the identical search was pure
    // waste. `prefetch`, when given, is a head start on 'under'/'over' that
    // run() already kicked off in the background while the "No full match"
    // notice was on screen, so by the time the user taps through here it's
    // often already done — falls back to a fresh (still parallel) pair if
    // there's no prefetch, or it failed.
    // One steady message for the whole "finding alternatives" phase. 'under'
    // and 'over' now run in PARALLEL (see the prefetch optimisation below) —
    // giving each its own progress label made the overlay flicker back and
    // forth between "shorter"/"longer" as their async completions interleaved
    // unpredictably. One fixed label + a day counter that only ever moves
    // forward (the higher of whichever search is further along, never
    // whichever happened to report last) reads as a single coherent search.
    const ALT_LABEL = 'Looking for alternative routes that best match your search…';

    const revealAlternatives = async (
      bestEffort: boolean,
      /** May be a PROMISE: when the strict pass failed we kick the bestEffort
       *  balanced search off in the background immediately, so by the time this
       *  runs it is usually already resolved. */
      precomputed?: PlanOutcome[] | Promise<PlanOutcome[]>,
      prefetch?: Promise<{ underAll: PlanOutcome[]; overAll: PlanOutcome[] }>,
    ) => {
      const controller = new AbortController();
      abortRef.current = controller;
      // ONE ring for the whole hunt: phase 0 is the balanced search, phase 1 the
      // shorter/longer pair (which run in parallel). Each phase fills its own
      // half, so the ring sweeps 0→100% exactly once.
      let phase = 0;
      setProgress({ day: 1, total: input.days, variantLabel: ALT_LABEL, phase });
      let maxDay = 1;
      const bump = (day: number) => {
        if (day > maxDay) {
          maxDay = day;
          setProgress({
            day: maxDay,
            total: input.days,
            variantLabel: ALT_LABEL,
            phase,
          });
        }
      };
      try {
        const rideList = await getRideList();
        if (controller.signal.aborted) return;

        const pre = precomputed ? await precomputed : undefined;
        const balancedAll =
          pre ?? (await generate('balanced', bestEffort, rideList, controller.signal, bump));
        if (controller.signal.aborted) return;
        if (!isComplete(balancedAll[0])) {
          // ⚠️ "We couldn't ASK" is not "there is no route". When the routing
          // service is down, throttled or timing out, every leg fails and the
          // search legitimately finds nothing — but telling someone their walk
          // is impossible is wrong and sends them off changing inputs that were
          // never the problem. That misdiagnosis happened twice in one day: once
          // when brouter.de was throttling us, once when a tunnel had dropped.
          const offline = balancedAll[0]?.stoppedReason === 'router-unavailable';
          setNotice(
            offline
              ? {
                  icon: 'cloud-offline-outline',
                  iconColor: '#b00020',
                  title: 'Couldn’t reach the routing service',
                  items: [
                    'The trail router didn’t respond, so no routes could be calculated. This is a connection problem, not a problem with your trip.',
                    'Check your connection and try again — your settings are fine as they are.',
                  ],
                }
              : {
                  icon: 'close-circle',
                  iconColor: '#b00020',
                  title: 'No route possible',
                  items: [
                    `Couldn’t link ${input.days} days${
                      roundtrip ? '' : ' ending at a village'
                    } from there at all — even ignoring your distance/ascent/descent limits.`,
                    'Try a different start point, fewer days, or allowing more accommodation types.',
                  ],
                },
          );
          return;
        }

        // Move into the second half of the ring. `maxDay` restarts because the
        // new search re-routes day 1 upward, but `phase` carries the completed
        // work, so the ring continues forward instead of emptying.
        phase = 1;
        maxDay = 1;
        setProgress({ day: 1, total: input.days, variantLabel: ALT_LABEL, phase });
        let underAll: PlanOutcome[];
        let overAll: PlanOutcome[];
        try {
          if (!prefetch) throw new Error('no prefetch');
          ({ underAll, overAll } = await prefetch);
        } catch {
          // No head start (or it failed) — run both fresh, still in parallel
          // with each other rather than one after another. Both report
          // through the same `bump`, so the day counter reflects whichever is
          // further along, never regressing when the other's callback lands.
          [underAll, overAll] = await Promise.all([
            generate('under', bestEffort, rideList, controller.signal, bump),
            generate('over', bestEffort, rideList, controller.signal, bump),
          ]);
        }
        if (controller.signal.aborted) return;
        showOptions(balancedAll, underAll, overAll);
      } catch (err) {
        if (!controller.signal.aborted) genFailed(err);
      } finally {
        abortRef.current = null;
        setProgress(null);
      }
    };

    // First pass: a strict search. If it's a clean, fully-in-range WALKING match
    // use it straight away; otherwise explain what didn't fit and offer the
    // alternatives — the "no full match → continue with best alternative →
    // 3 options" flow. A route that overshoots a range, stops short, or relies on
    // a lift/train (which skips the climb, so it's never a plain in-range match)
    // all count as "not a full match" and go through the review.
    const run = async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      // Start the donut showing "1 (of N)" right away rather than an empty "·"
      // placeholder — day 1 is what's about to be computed, so there's no need
      // to show a blank state first while onProgress's first real call (which
      // is only a microtask away) catches up.
      setProgress({ day: 1, total: input.days });
      try {
        const rideList = await getRideList();
        if (controller.signal.aborted) return;
        const balancedAll = await generate(
          'balanced',
          false,
          rideList,
          controller.signal,
          (day, total) => setProgress({ day, total }),
        );
        if (controller.signal.aborted) return;
        const balanced = balancedAll[0];

        // A route that meets every range is a full match and applies straight
        // away — whether it walks the whole way or uses a lift/train (you turned
        // that on, so it's a valid way to meet the criteria, not a compromise).
        const complete = isComplete(balanced);
        if (complete && balanced.compromises.length === 0) {
          applyOutcome(balanced);
          return;
        }

        // Get a head start on the two alternatives right now, in the
        // background, while the user reads the notice below and decides — by
        // the time they tap "Show best alternatives" that's often already
        // done, instead of only starting then. Only worth it when the strict
        // pass actually completed: that's the exact bestEffort:false setting
        // "Show best alternatives" will use here, so it's a real head start —
        // not a gamble on the (rarer, and different) bestEffort:true retry,
        // which might not even be needed. Errors are swallowed here;
        // revealAlternatives retries fresh if this didn't pan out.
        const bg = new AbortController();
        // ⚠️ Head-start BOTH cases, not just the tidy one. This used to be skipped
        // whenever the strict pass couldn't finish (`!complete`) — which is
        // exactly the SLOW path: tapping "Show best alternatives" then started a
        // fresh bestEffort balanced search PLUS both biased ones, from nothing,
        // while the user watched. bestEffort searches are the expensive kind
        // (they drop the hard wall, so far more candidates survive to be routed).
        // Starting them while the notice is on screen is free wall-clock time.
        const beBias = !complete;
        const prefetchBalanced = complete
          ? undefined
          : generate('balanced', true, rideList, bg.signal, () => {});
        const prefetch = Promise.all([
          generate('under', beBias, rideList, bg.signal, () => {}),
          generate('over', beBias, rideList, bg.signal, () => {}),
        ]).then(([underAll, overAll]) => ({ underAll, overAll }));
        // `prefetch` (above) still rejects normally when awaited in
        // revealAlternatives, which triggers its fresh-retry fallback; this
        // separate handle just stops that same rejection from also logging an
        // "unhandled promise rejection" warning if the user never taps through
        // to use it (e.g. picks "Adjust criteria" instead).
        prefetch.catch(() => {});
        prefetchBalanced?.catch(() => {});

        // No full match. Show a plain message (no specific route/day figures —
        // that read as an unpickable route) and let the user choose: adjust the
        // criteria, or see the closest alternatives (the 3-card carousel).
        setNotice({
          icon: 'help-circle',
          iconColor: '#ef6c00',
          title: 'No full match',
          items: [
            complete
              ? `No route meets all of your criteria exactly. You can adjust your criteria, or see the closest alternatives — some days will fall outside your ranges.`
              : `No ${input.days}-day route${
                  roundtrip ? '' : ' ending at a village'
                } can stay within your limits every day. You can adjust your criteria, or see the closest alternatives — some days will go beyond your limits.`,
          ],
          cancelLabel: 'Adjust criteria',
          confirmLabel: 'Show best alternatives',
          onConfirm: () => {
            setNotice(null);
            void revealAlternatives(
              !complete,
              complete ? balancedAll : prefetchBalanced,
              prefetch,
            );
          },
        });
      } catch (err) {
        if (!controller.signal.aborted) genFailed(err);
      } finally {
        abortRef.current = null;
        setProgress(null);
      }
    };

    await run();
  };

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}
        keyboardShouldPersistTaps="handled"
        // The number pad has no return key, so the keyboard used to need an
        // explicit "Done". Now scrolling dismisses it, and the wrapper below
        // dismisses it on a tap anywhere that isn't a field or control.
        keyboardDismissMode="on-drag"
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View>
        <Text style={styles.title}>Plan a route</Text>

        {/* ── Option 1 ────────────────────────────────────────────────────────
            A single "Select your route" menu. Country rows and route rows live in
            ONE list, distinguished by indentation rather than by nested
            accordions — two levels of collapsing meant two taps to reach any
            route, and it read as a stack of controls rather than a menu. */}
        {classicByCountry.length > 0 && (
          <View style={styles.optionBlock}>
            <Text style={styles.optionKicker}>Option 1</Text>
            <Text style={styles.optionTitle}>Load a classic route</Text>
            <Text style={styles.optionHint}>
              A famous multi-day walk, already planned — tap one and it’s ready on
              the Route tab.
            </Text>

            <TouchableOpacity
              style={styles.classicRoot}
              onPress={() => setClassicOpen((v) => !v)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ expanded: classicOpen }}
            >
              <Ionicons name="trail-sign-outline" size={18} color={COLORS.green} />
              <Text style={styles.classicRootText}>Select your route</Text>
              <Ionicons
                name={classicOpen ? 'chevron-up' : 'chevron-down'}
                size={17}
                color="#aaa"
              />
            </TouchableOpacity>

            {classicOpen && (
              <View style={styles.routeMenu}>
                {classicByCountry.map(([country, routes]) => (
                  <View key={country}>
                    {/* Indent level 0 — the country. */}
                    <View style={styles.menuCountryRow}>
                      <Text style={styles.menuCountryText}>{country}</Text>
                    </View>
                    {/* Indent level 1 — its routes. */}
                    {routes.map(({ route, huts, missing, ready }) => (
                      <TouchableOpacity
                        key={route.id}
                        style={[styles.menuRouteRow, !ready && styles.menuRouteRowOff]}
                        onPress={() => {
                          if (!ready) return;
                          setClassicOpen(false);
                          loadClassicRoute(route, huts, missing);
                        }}
                        disabled={!ready}
                        activeOpacity={0.6}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.menuRouteName}>{route.name}</Text>
                          <Text style={styles.menuRouteMeta}>
                            {[route.length, route.days, route.difficulty]
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                          <Text style={styles.menuRouteMeta}>
                            {ready
                              ? `${route.where} · ${huts.length} stages ready`
                              : `${route.where} · offline data coming soon`}
                          </Text>
                        </View>
                        {ready && (
                          <Ionicons name="chevron-forward" size={16} color="#c4c4c4" />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* ── Option 2 ──────────────────────────────────────────────────────── */}
        <View style={styles.optionDivider}>
          <View style={styles.optionDividerLine} />
          <Text style={styles.optionDividerText}>or</Text>
          <View style={styles.optionDividerLine} />
        </View>

        <View style={styles.optionBlock}>
          <Text style={styles.optionKicker}>Option 2</Text>
          <Text style={styles.optionTitle}>Let us build your route</Text>
          <Text style={styles.optionHint}>
            Pick a start anywhere across the regions and your daily targets — the
            app builds a hut-to-hut route you can then tweak on the Route tab.
          </Text>
        </View>

        <Text style={formStyles.label}>Start point</Text>
        <TouchableOpacity
          style={styles.startBtn}
          onPress={() => setPickerOpen(true)}
        >
          <Ionicons
            name="location-outline"
            size={18}
            color={start ? '#2f6f4f' : '#aaa'}
          />
          <Text style={[styles.startText, !start && styles.startPlaceholder]}>
            {start ? start.name : 'Choose a hut or village…'}
          </Text>
          <Ionicons name="chevron-forward" size={18} color="#aaa" />
        </TouchableOpacity>

        <NumberField label="Number of days" value={days} onChange={setDays} />

        <View style={styles.optionsCard}>
          <OptionToggle
            icon="image-outline"
            title="Scenic route"
            hint="Prefer high mountain trails with views over the fast valley path. Widens the ascent/descent range below (scenic days climb more) — trim it if that's too much."
            value={scenic}
            onValueChange={toggleScenic}
          />
          <View style={styles.optionsDivider} />
          <OptionToggle
            icon="git-network-outline"
            title="Use lifts & mountain trains"
            hint="Let a day ride a cable car, gondola, funicular or scenic railway to skip a climb — this reaches huts too high or too far to walk in a day. Assumes the lift/train is running."
            value={useLifts}
            onValueChange={toggleLifts}
          />
          <View style={styles.optionsDivider} />
          {/* Not a toggle: the SAC ceiling is a threshold with six settings, and
              it applies app-wide (loaded routes, Map-tab legs, generated plans)
              rather than only to what this screen generates. */}
          <MaxDifficultyPicker />
          <View style={styles.optionsDivider} />
          <OptionToggle
            icon="home-outline"
            title="Allow overnight in villages"
            hint="Let a day finish in a village rather than only at a hut or mountain guesthouse. Villages have far more beds and are much denser than huts, so this makes a route that fits your distances much easier to find — especially in areas where huts are thin."
            value={allowVillages}
            onValueChange={setAllowVillages}
          />
        </View>

        <RangeControl
          label="Distance per day (km)"
          lo={0}
          hi={30}
          step={1}
          min={kmMin}
          max={kmMax}
          onMin={setKmMin}
          onMax={setKmMax}
        />
        <RangeControl
          label="Ascent per day (m)"
          lo={0}
          hi={2500}
          step={50}
          min={ascentMin}
          max={ascentMax}
          onMin={setAscentMin}
          onMax={onAscentMax}
        />
        <RangeControl
          label="Descent per day (m)"
          lo={0}
          hi={2500}
          step={50}
          min={descentMin}
          max={descentMax}
          onMin={setDescentMin}
          onMax={onDescentMax}
        />

        <Text style={formStyles.label}>Stay at</Text>
        <Text style={styles.typesHint}>
          {types.size === 0
            ? 'Pick at least one — the route needs somewhere to stay.'
            : `${eligibleHuts.length} place${eligibleHuts.length === 1 ? '' : 's'} to choose from.`}
        </Text>
        <View style={styles.chipRow}>
          {ACCOM_TYPES.map((t) => {
            const on = types.has(t);
            return (
              <TouchableOpacity
                key={t}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => toggleType(t)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
              >
                <Ionicons
                  name={on ? 'checkmark-circle' : 'ellipse-outline'}
                  size={15}
                  color={on ? 'white' : '#bbb'}
                />
                <Text style={[styles.chipText, on && styles.chipTextOn]}>
                  {hutTypeLabel(t)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.labelRow}>
          <Text style={[formStyles.label, styles.labelInRow]}>Hardest trail</Text>
          {/* No `highlight`: this control is about choosing a ceiling, so the
              sheet shows the whole scale rather than singling one out. */}
          <SacInfoButton size={17} />
        </View>
        <Text style={styles.typesHint}>
          {maxSac
            ? `Only up to ${SAC_SCALE_GRADE[maxSac]} — ${SAC_SCALE_DIFFICULTY[maxSac].toLowerCase()}. Harder graded trails are never used.`
            : 'Any grade. Pick a limit if you’d rather avoid exposed or alpine ground.'}
        </Text>
        <View style={styles.chipRow}>
          <TouchableOpacity
            style={[styles.chip, !maxSac && styles.chipOn]}
            onPress={() => setMaxSac(undefined)}
            accessibilityRole="radio"
            accessibilityState={{ selected: !maxSac }}
          >
            <Text style={[styles.chipText, !maxSac && styles.chipTextOn]}>Any</Text>
          </TouchableOpacity>
          {SAC_SCALE_ORDER.map((s) => {
            const on = maxSac === s;
            return (
              <TouchableOpacity
                key={s}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => setMaxSac(s)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`Up to ${SAC_SCALE_GRADE[s]}, ${SAC_SCALE_DIFFICULTY[s]}`}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>
                  {SAC_SCALE_GRADE[s]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {/* NB: the on-screen caveat about ungraded trails was removed on request.
            The limitation itself still stands — most OSM segments carry no
            `sac_scale`, and `isWithinSacLimit` treats unknown as within-limit —
            so this filters what's KNOWN to be harder rather than guaranteeing
            easy ground. Worth re-surfacing somewhere before release. */}

        <Text style={formStyles.label}>Trip type</Text>
        <View style={styles.segment}>
          <TouchableOpacity
            style={[styles.segmentBtn, roundtrip && styles.segmentActive]}
            onPress={() => setRoundtrip(true)}
          >
            <Text style={[styles.segmentText, roundtrip && styles.segmentTextActive]}>
              Roundtrip
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segmentBtn, !roundtrip && styles.segmentActive]}
            onPress={() => setRoundtrip(false)}
          >
            <Text style={[styles.segmentText, !roundtrip && styles.segmentTextActive]}>
              One-way
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>
          {roundtrip
            ? 'Returns to your starting point.'
            : 'Ends at a village with public transport.'}
        </Text>

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onGenerate}
          disabled={hutsLoading}
        >
          <LinearGradient
            colors={hutsLoading ? ['#a9c7b6', '#a9c7b6'] : GRADIENT.primary}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.generateBtn}
          >
            <Ionicons name="sparkles" size={18} color="white" />
            <Text style={styles.generateText}>
              {hutsLoading ? 'Loading huts…' : 'Generate route'}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
          </View>
        </TouchableWithoutFeedback>
      </ScrollView>

      {/* Start picker */}
      <Modal
        visible={pickerOpen}
        animationType="slide"
        onRequestClose={() => setPickerOpen(false)}
      >
        <View style={[styles.pickerRoot, { paddingTop: insets.top }]}>
          <View style={styles.pickerHeader}>
            <TextInput
              style={styles.pickerSearch}
              placeholder="Search hut or village…"
              value={search}
              onChangeText={setSearch}
              autoFocus
            />
            <TouchableOpacity
              onPress={() => setPickerOpen(false)}
              hitSlop={8}
              style={styles.cancelPill}
              activeOpacity={0.85}
            >
              <Text style={styles.cancelPillText}>Cancel</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={startOptions}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.pickerRow}
                onPress={() => {
                  // A start outside the selected regions needs that region
                  // loaded, or the generator has no huts around it to route to.
                  const home = bundledRegionOf(item.id);
                  if (home && !selectedRegionIds.includes(home)) {
                    const label =
                      REGIONS.find((r) => r.id === home)?.name ?? home;
                    addRegion(home);
                    Alert.alert(
                      `${label} added`,
                      `“${item.name}” is in ${label}, which wasn't among your selected areas — it's now been added so the route generator can use its huts and trails.`,
                    );
                  }
                  setStart(item);
                  setPickerOpen(false);
                  setSearch('');
                }}
              >
                <Text style={styles.pickerName}>{item.name}</Text>
                <Text style={styles.pickerMeta}>{hutTypeLabel(item.type)}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>

      {/* Generating overlay */}
      {progress && (
        <View style={styles.overlay}>
          <View style={styles.overlayCard}>
            <ProgressDonut progress={donutProgress(progress)}>
              <View style={styles.donutCenter}>
                {progress.phase == null ? (
                  // Single route: the day being routed is the honest unit.
                  <>
                    <Text style={styles.donutDay}>
                      {progress.day > 0 ? progress.day : '·'}
                    </Text>
                    <Text style={styles.donutTotal}>of {progress.total}</Text>
                  </>
                ) : (
                  // Alternatives: the ring spans several searches, so a day
                  // number would contradict it (ring at 60%, centre "2 of 4").
                  // A percentage matches what the ring is actually showing.
                  <Text style={styles.donutDay}>
                    {Math.round(donutProgress(progress) * 100)}%
                  </Text>
                )}
              </View>
            </ProgressDonut>
            <Text style={styles.overlayTitle}>
              {progress.variantLabel ? 'Exploring alternatives…' : 'Planning your route…'}
            </Text>
            <Text style={styles.overlayText}>
              {progress.variantLabel ??
                (progress.day > 0 ? 'Finding the best trails…' : 'Getting started…')}
            </Text>
            <TouchableOpacity
              onPress={() => abortRef.current?.abort()}
              style={[styles.cancelPill, styles.overlayCancelPill]}
              activeOpacity={0.85}
            >
              <Text style={styles.cancelPillText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Post-generation notice: informational (OK) or a route awaiting
          accept/cancel, with a per-day breakdown instead of one run-on string. */}
      {notice && (
        <View style={styles.overlay}>
          <View style={styles.noticeCard}>
            <View style={styles.noticeHeader}>
              <Ionicons name={notice.icon} size={24} color={notice.iconColor} />
              <Text style={styles.noticeTitle}>{notice.title}</Text>
            </View>

            <ScrollView
              style={styles.noticeScroll}
              contentContainerStyle={styles.noticeScrollContent}
            >
              {notice.items?.map((item, i) => (
                <Text key={i} style={styles.noticeItemText}>
                  {item}
                </Text>
              ))}

              {!!notice.dayIssues?.length && (
                <>
                  <Text style={styles.noticeSectionLabel}>
                    {notice.totalDays
                      ? `Criteria not met on ${notice.dayIssues.length} of ${notice.totalDays} days`
                      : `Criteria not met on ${notice.dayIssues.length} ${
                          notice.dayIssues.length === 1 ? 'day' : 'days'
                        }`}
                  </Text>
                  {notice.dayIssues.map((d) => (
                    <DayIssueCard key={d.day} compromise={d} />
                  ))}
                </>
              )}

              {notice.onConfirm && !!notice.dayIssues?.length && (
                <Text style={styles.noticeFooterNote}>
                  This is the closest route I could build.
                </Text>
              )}
            </ScrollView>

            <View style={styles.noticeButtons}>
              {notice.onConfirm ? (
                <>
                  {/* Red pill only for an actual CANCEL. A custom label like
                      "Adjust criteria" is a legitimate alternative action, not
                      an abandon — colouring it red would misread it. */}
                  <TouchableOpacity
                    style={
                      notice.cancelLabel
                        ? styles.noticeCancelBtn
                        : [styles.noticeCancelBtn, styles.cancelPill]
                    }
                    activeOpacity={0.85}
                    onPress={() => setNotice(null)}
                  >
                    <Text
                      style={
                        notice.cancelLabel
                          ? styles.noticeCancelText
                          : styles.cancelPillText
                      }
                    >
                      {notice.cancelLabel ?? 'Cancel'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.noticeConfirmWrap}
                    activeOpacity={0.85}
                    onPress={() => {
                      notice.onConfirm!();
                      setNotice(null);
                    }}
                  >
                    <LinearGradient
                      colors={GRADIENT.primary}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.noticeConfirmBtn}
                    >
                      <Text style={styles.noticeConfirmText}>
                        {notice.confirmLabel ?? 'OK'}
                      </Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  style={[styles.noticeConfirmWrap, styles.noticeConfirmFull]}
                  activeOpacity={0.85}
                  onPress={() => setNotice(null)}
                >
                  <LinearGradient
                    colors={GRADIENT.primary}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.noticeConfirmBtn}
                  >
                    <Text style={styles.noticeConfirmText}>OK</Text>
                  </LinearGradient>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      )}

      {/* Alternative-routes carousel: shown instead of the single-route notice
          when the balanced route needed compromises. Swipe to compare three
          options; "Use this route" on a card applies that one directly. */}
      {options && (
        <View style={styles.overlay}>
          <View style={styles.optionsPanel}>
            <View style={styles.optionsHeader}>
              <View style={styles.optionsHeaderText}>
                <Text style={styles.noticeTitle}>Choose a route</Text>
                <Text style={styles.optionsSubtitle}>
                  Your criteria couldn’t be fully met. Swipe to compare — they’re
                  ranked by closest fit to your inputs, so Alternative 1 fits
                  best.
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setOptions(null)}
                hitSlop={10}
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={22} color="#999" />
              </TouchableOpacity>
            </View>

            <View
              style={styles.optionsPagerWrap}
              onLayout={(e) => setPanelWidth(e.nativeEvent.layout.width)}
            >
              {panelWidth > 0 && (
                <ScrollView
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  onMomentumScrollEnd={(e) => {
                    const i = Math.round(
                      e.nativeEvent.contentOffset.x / panelWidth,
                    );
                    setOptionPage(i);
                    // Swiping here previews that alternative too, so it's
                    // already showing if the user switches to Map without
                    // tapping "Use this route".
                    const opt = options[i];
                    if (opt) {
                      useAlternativesStore.getState().setActiveIndex(i);
                      previewTrip(opt.outcome.huts, scenic, opt.outcome.legRides);
                    }
                  }}
                >
                  {options.map((opt) => (
                    <View key={opt.key} style={{ width: panelWidth }}>
                      <ScrollView
                        style={styles.optionCardScroll}
                        contentContainerStyle={styles.optionCardContent}
                      >
                        <View style={styles.optionBadgeRow}>
                          <View
                            style={[
                              styles.optionBadge,
                              opt.recommended && styles.optionBadgeMain,
                            ]}
                          >
                            <Ionicons
                              name={opt.recommended ? 'star' : 'trail-sign-outline'}
                              size={14}
                              color="white"
                            />
                            <Text style={styles.optionBadgeText}>{opt.label}</Text>
                          </View>
                        </View>

                        {/* The rating, made explicit so the ★ is self-evident. */}
                        <View
                          style={[
                            styles.ratingChip,
                            ratingIsClean(opt.outcome, roundtrip)
                              ? styles.ratingChipGood
                              : styles.ratingChipWarn,
                          ]}
                        >
                          <Ionicons
                            name={
                              ratingIsClean(opt.outcome, roundtrip)
                                ? 'checkmark-circle'
                                : 'alert-circle'
                            }
                            size={15}
                            color={
                              ratingIsClean(opt.outcome, roundtrip)
                                ? '#2f6f4f'
                                : '#b5651d'
                            }
                          />
                          <Text style={styles.ratingChipText}>
                            {ratingSummary(opt.outcome, roundtrip)}
                          </Text>
                        </View>

                        {/* Per-day figures FIRST — that's what the form's limits
                            constrain. Whole-trip totals follow, clearly labelled,
                            so a multi-day total isn't mistaken for a per-day value. */}
                        {(() => {
                          const d = Math.max(1, opt.outcome.plannedDays);
                          return (
                            <>
                              <View style={styles.optionStatsRow}>
                                <OptionStat
                                  icon="calendar-outline"
                                  value={String(opt.outcome.plannedDays)}
                                  label={
                                    opt.outcome.plannedDays === 1 ? 'day' : 'days'
                                  }
                                />
                                <OptionStat
                                  icon="walk-outline"
                                  value={formatDistance(opt.outcome.totalDistance / d)}
                                  label="km / day"
                                />
                                <OptionStat
                                  icon="trending-up-outline"
                                  value={formatElevation(opt.outcome.totalAscent / d)}
                                  label="↑ / day"
                                />
                                <OptionStat
                                  icon="trending-down-outline"
                                  value={formatElevation(opt.outcome.totalDescent / d)}
                                  label="↓ / day"
                                />
                              </View>
                              <Text style={styles.optionTotalLine}>
                                Whole trip:{' '}
                                {formatDistance(opt.outcome.totalDistance)} · ↑
                                {formatElevation(opt.outcome.totalAscent)} · ↓
                                {formatElevation(opt.outcome.totalDescent)}
                              </Text>
                            </>
                          );
                        })()}

                        {rideNote(opt.outcome) && (
                          <Text style={styles.optionRideLine}>
                            {rideNote(opt.outcome)}
                          </Text>
                        )}

                        {opt.outcome.compromises.length > 0 && (
                          <>
                            <Text style={styles.noticeSectionLabel}>
                              Day-by-day details
                            </Text>
                            {opt.outcome.compromises.map((d) => (
                              <DayIssueCard key={d.day} compromise={d} />
                            ))}
                          </>
                        )}
                      </ScrollView>

                      <View style={styles.optionCardFooter}>
                        <TouchableOpacity
                          activeOpacity={0.85}
                          onPress={() => {
                            setTrip(opt.outcome.huts, scenic, opt.outcome.legRides);
                            router.navigate('/');
                            setOptions(null);
                          }}
                        >
                          <LinearGradient
                            colors={GRADIENT.primary}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.optionUseBtn}
                          >
                            <Ionicons name="checkmark" size={18} color="white" />
                            <Text style={styles.optionUseText}>Use this route</Text>
                          </LinearGradient>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>

            <View style={styles.dotsRow}>
              {options.map((_, i) => (
                <View
                  key={i}
                  style={[styles.dot, i === optionPage && styles.dotActive]}
                />
              ))}
            </View>

            <TouchableOpacity
              style={styles.seeOnMapBtn}
              activeOpacity={0.7}
              onPress={() => {
                // The alternatives store already tracks whichever card you're
                // currently viewing (kept in sync as you swipe above), so Map
                // opens already showing it — with its own swipe strip to
                // compare/pick from there instead.
                router.navigate('/');
                setOptions(null);
              }}
            >
              <Ionicons name="map-outline" size={17} color="#2f6f4f" />
              <Text style={styles.seeOnMapText}>See on map</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  title: { fontSize: 23, fontWeight: '800', color: COLORS.ink, marginBottom: 22 },
  // (`subtitle` removed — the page intro became the two Option blocks' own
  // `optionHint` text, so nothing referenced it any more.)
  // ⚠️ The margins live HERE, not on `label`. `label` carries marginTop 16 /
  // marginBottom 6, so inside an `alignItems: center` row its box is 22px taller
  // than its text and sits low within it — centring the icon on that box put the
  // icon visibly above the words. The row owns the spacing; the label drops it.
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 16,
    marginBottom: 6,
  },
  labelInRow: { marginTop: 0, marginBottom: 0 },
  // `label` and `input` live in src/components/plan/formStyles.ts — the
  // extracted NumberField/RangeControl need them too.
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderColor: '#e2e8e4',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  /** The one outer dropdown. Styled like `startBtn` so it reads as a control. */
  classicRoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderColor: '#e2e8e4',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  classicRootText: {
    flex: 1,
    fontSize: 14.5,
    fontWeight: '700',
    color: COLORS.ink,
  },
  // Country layers sit indented inside the dropdown, lighter than the outer
  // control so the hierarchy is obvious at a glance.
  // ── Option blocks ─────────────────────────────────────────────────────────
  optionBlock: { marginTop: 4, marginBottom: 6 },
  optionKicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: COLORS.green,
  },
  optionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.ink,
    marginTop: 2,
  },
  optionHint: {
    fontSize: 13,
    color: COLORS.muted,
    marginTop: 4,
    marginBottom: 12,
    lineHeight: 18,
  },
  optionDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 18,
  },
  optionDividerLine: { flex: 1, height: 1, backgroundColor: '#dfe7e2' },
  optionDividerText: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // ── The route menu ────────────────────────────────────────────────────────
  // One list; hierarchy comes from `paddingLeft` alone, so it reads as a menu
  // rather than as nested controls.
  routeMenu: {
    marginTop: 8,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: '#e2e8e4',
    overflow: 'hidden',
    paddingVertical: 4,
  },
  /** Indent level 0. */
  menuCountryRow: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4 },
  menuCountryText: {
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: COLORS.muted,
  },
  /** Indent level 1 — deliberately a larger left pad than the country above. */
  menuRouteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 30,
    paddingRight: 14,
    paddingVertical: 11,
  },
  /** Curated but not yet loadable — visible as a roadmap, not tappable. */
  menuRouteRowOff: { opacity: 0.45 },
  menuRouteName: { fontSize: 15, fontWeight: '700', color: COLORS.ink },
  menuRouteMeta: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  startText: { flex: 1, fontSize: 16, color: COLORS.ink },
  startPlaceholder: { color: '#aab4ad' },
  typesHint: { fontSize: 12, color: COLORS.muted, marginBottom: 10 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: '#e2e8e4',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: COLORS.surface,
  },
  chipOn: { backgroundColor: COLORS.green, borderColor: COLORS.green },
  chipText: { fontSize: 13, color: COLORS.muted, fontWeight: '600' },
  chipTextOn: { color: 'white' },
  segment: {
    flexDirection: 'row',
    backgroundColor: '#e6ede8',
    borderRadius: RADIUS.md,
    padding: 4,
  },
  segmentBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center' },
  segmentActive: {
    backgroundColor: COLORS.surface,
    ...coloredShadow(COLORS.green, 0.12),
  },
  segmentText: { fontSize: 14, color: COLORS.muted, fontWeight: '600' },
  segmentTextActive: { color: COLORS.green, fontWeight: '800' },
  hint: { fontSize: 12, color: COLORS.muted, marginTop: 6 },
  // Grouped card holding the scenic / lifts toggles, above the range sliders.
  optionsCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    paddingHorizontal: 16,
    marginTop: 18,
    marginBottom: 4,
    ...coloredShadow(COLORS.green, 0.09),
  },
  optionsDivider: { height: 1, backgroundColor: '#eef2ef' },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: RADIUS.md,
    marginTop: 28,
    ...coloredShadow(COLORS.greenDeep, 0.3),
  },
  generateText: { color: 'white', fontWeight: '800', fontSize: 16 },
  pickerRoot: { flex: 1, backgroundColor: COLORS.surface },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8e4',
  },
  pickerSearch: {
    flex: 1,
    backgroundColor: '#f0f3f1',
    borderRadius: RADIUS.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  // Red pill cancel — solid `COLORS.danger` fill, white label, fully rounded.
  cancelPill: {
    backgroundColor: COLORS.danger,
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    ...coloredShadow(COLORS.danger, 0.28),
  },
  cancelPillText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
    textAlign: 'center',
  },
  /** The overlay sits on a dark scrim, so give the pill a little breathing room. */
  overlayCancelPill: { marginTop: 14, alignSelf: 'center' },
  pickerRow: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eef2ef',
  },
  pickerName: { fontSize: 16, color: COLORS.ink },
  pickerMeta: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,25,20,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    padding: 28,
    alignItems: 'center',
    gap: 10,
    width: 264,
    ...coloredShadow(COLORS.ink, 0.25),
  },
  donutCenter: { alignItems: 'center', justifyContent: 'center' },
  donutDay: { fontSize: 30, fontWeight: '800', color: COLORS.ink, lineHeight: 34 },
  donutTotal: { fontSize: 13, color: COLORS.muted, marginTop: 1 },
  overlayTitle: { fontSize: 17, fontWeight: '800', color: COLORS.ink, marginTop: 4 },
  overlayText: { fontSize: 14, color: COLORS.muted, textAlign: 'center' },
  noticeCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    paddingTop: 22,
    paddingHorizontal: 22,
    paddingBottom: 18,
    width: '86%',
    maxWidth: 380,
    maxHeight: '78%',
    ...coloredShadow(COLORS.ink, 0.25),
  },
  noticeHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  noticeTitle: { fontSize: 18, fontWeight: '800', color: COLORS.ink, flexShrink: 1 },
  noticeScroll: { marginTop: 14 },
  noticeScrollContent: { paddingBottom: 4 },
  noticeItemText: {
    fontSize: 14,
    color: '#444',
    lineHeight: 20,
    marginBottom: 8,
  },
  noticeSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginTop: 6,
    marginBottom: 10,
  },
  noticeFooterNote: {
    fontSize: 13,
    color: COLORS.muted,
    fontStyle: 'italic',
    marginTop: 10,
  },
  noticeButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  noticeCancelBtn: {
    flex: 1,
    minHeight: 46,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef2ef',
  },
  noticeCancelText: {
    color: '#5a655d',
    fontWeight: '700',
    fontSize: 15,
    textAlign: 'center',
  },
  noticeConfirmWrap: { flex: 1 },
  noticeConfirmBtn: {
    minHeight: 46,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noticeConfirmFull: { flex: 1 },
  noticeConfirmText: {
    color: 'white',
    fontWeight: '800',
    fontSize: 15,
    textAlign: 'center',
  },
  optionsPanel: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    paddingTop: 20,
    paddingBottom: 14,
    width: '92%',
    maxWidth: 420,
    height: '78%',
    ...coloredShadow(COLORS.ink, 0.25),
  },
  optionsHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 20,
  },
  optionsHeaderText: { flex: 1 },
  optionsSubtitle: { fontSize: 13, color: COLORS.muted, marginTop: 4, lineHeight: 18 },
  optionsPagerWrap: { flex: 1, marginTop: 12 },
  optionCardScroll: { flex: 1, paddingHorizontal: 20 },
  optionCardContent: { paddingBottom: 12 },
  optionBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  optionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#9aa5a0',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 20,
  },
  optionBadgeMain: { backgroundColor: COLORS.green },
  optionBadgeText: { color: 'white', fontWeight: '800', fontSize: 13 },
  ratingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: RADIUS.sm,
  },
  ratingChipGood: { backgroundColor: COLORS.greenTint },
  ratingChipWarn: { backgroundColor: '#fbf0e3' },
  ratingChipText: { fontSize: 13, color: '#444', fontWeight: '600', flexShrink: 1 },
  optionStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.md,
    padding: 12,
    marginTop: 14,
  },
  optionTotalLine: {
    fontSize: 12,
    color: COLORS.muted,
    marginTop: 8,
    textAlign: 'center',
  },
  optionRideLine: {
    fontSize: 13,
    color: '#6a4bb0',
    fontWeight: '700',
    marginTop: 10,
    textAlign: 'center',
  },
  optionCardFooter: { paddingHorizontal: 20, paddingTop: 12 },
  optionUseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: RADIUS.md,
    ...coloredShadow(COLORS.greenDeep, 0.28),
  },
  optionUseText: { color: 'white', fontWeight: '800', fontSize: 16 },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: 4,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#d5ded8' },
  dotActive: { backgroundColor: COLORS.green, width: 16 },
  seeOnMapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 14,
    marginHorizontal: 20,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.green,
  },
  seeOnMapText: { color: COLORS.green, fontWeight: '700', fontSize: 15 },
});
