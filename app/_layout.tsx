import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useRef } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RegionPicker } from '../src/components/RegionPicker';
import { COLORS } from '../src/constants/theme';
import { useSelectedRegionsStore } from '../src/store/selectedRegionsStore';

// ⚠️ react-query AsyncStorage PERSISTENCE WAS REMOVED (2026-07). It used to
// persist the huts/villages cache so reopens were fast — but that job is now
// done far better by the shipped offline bundle (see [[bundle-dataset-milestone]]),
// which `useHuts`/`useVillages` read DIRECTLY as a base layer, so the map is
// fully populated on the first frame with zero disk/network wait. Persistence
// had become actively harmful: an old or partial persisted cache would restore
// on launch and SHADOW the bundle (map "loaded one by one" again), and the
// async restore itself gated live fetches behind an `isRestoring` delay. Plain
// QueryClientProvider = no restore step, no shadowing, bundle always wins.
// (Photos/notes/routes persist separately via Zustand — unaffected.)

export default function RootLayout() {
  // One client for the app's lifetime; huts rarely change so cache them long.
  const queryClient = useRef(
    new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 1000 * 60 * 60, // 1 hour
          gcTime: 1000 * 60 * 60 * 24 * 7,
          retry: 1,
        },
      },
    }),
  ).current;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <StatusBar style="dark" />
          <AppContent />
        </SafeAreaProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

/**
 * First-run gate: until the user has chosen where to walk, show the region
 * picker instead of the app. Once a selection exists (persisted), go straight
 * to the map. `_hydrated` guards against briefly flashing the picker over an
 * already-made choice while the persisted value loads from disk.
 */
function AppContent() {
  const hydrated = useSelectedRegionsStore((s) => s._hydrated);
  const hasSelection = useSelectedRegionsStore((s) => s.selected.length > 0);

  if (!hydrated) return <View style={{ flex: 1, backgroundColor: COLORS.bg }} />;
  if (!hasSelection) return <RegionPicker firstRun />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="hut/[id]"
        options={{
          presentation: 'modal',
          headerShown: true,
          title: 'Hut',
        }}
      />
      <Stack.Screen
        name="leg/[index]"
        options={{
          presentation: 'modal',
          headerShown: true,
          title: 'Day',
        }}
      />
    </Stack>
  );
}
