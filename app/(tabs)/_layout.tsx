import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { coloredShadow, COLORS } from '../../src/constants/theme';

/** Use the filled icon variant when a tab is active, outline when not — a small
 *  touch that makes the selected tab read more clearly. */
function tabIcon(
  base: string,
): (p: { color: string; size: number; focused: boolean }) => React.ReactElement {
  return ({ color, size, focused }) => (
    <Ionicons
      name={(focused ? base : `${base}-outline`) as keyof typeof Ionicons.glyphMap}
      color={color}
      size={size}
    />
  );
}

export default function TabsLayout() {
  // A fixed `height` on tabBarStyle opts OUT of React Navigation's automatic
  // safe-area handling — without adding the bottom inset back in ourselves,
  // the bar sits too low on devices with a home indicator (iPhone X+), so its
  // content (the "Saved trips" label especially, being the longest) crowds
  // against/falls behind that reserved zone instead of sitting above it.
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: COLORS.green,
        tabBarInactiveTintColor: '#9aa5a0',
        headerStyle: {
          backgroundColor: COLORS.headerTint,
          ...coloredShadow(COLORS.green, 0.1),
        },
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '800', color: COLORS.ink },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        tabBarStyle: {
          backgroundColor: COLORS.surface,
          borderTopWidth: 0,
          elevation: 12,
          height: 60 + insets.bottom,
          paddingTop: 6,
          paddingBottom: 8 + insets.bottom,
          shadowColor: COLORS.green,
          shadowOpacity: 0.12,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: -3 },
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Map',
          tabBarIcon: tabIcon('map'),
          // No header here: the map should run edge-to-edge behind the status
          // bar. Everything the header offered (the title) is redundant on a
          // full-bleed map, and the bar cost ~90 px of the view. The Map screen
          // adds the top safe-area inset to its own floating search bar instead
          // — see `searchWrap`.
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{ title: 'Plan', tabBarIcon: tabIcon('sparkles') }}
      />
      <Tabs.Screen
        name="route"
        options={{ title: 'Route', tabBarIcon: tabIcon('trail-sign') }}
      />
      <Tabs.Screen
        name="saved"
        options={{ title: 'Saved trips', tabBarIcon: tabIcon('bookmark') }}
      />
    </Tabs>
  );
}
