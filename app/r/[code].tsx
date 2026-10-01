/**
 * `alpinehuts://r/ABCD2345` — a shared route arriving by link.
 *
 * ⚠️ THE LINK IS THE CONVENIENCE AND THE CODE IS THE FEATURE. A link only works
 * for someone who already has the app; everyone else sees a dead URL. So this
 * screen does nothing the Account tab cannot do with the code typed in by hand
 * — it just saves the typing for the people it does reach. If this route is ever
 * removed, sharing still works.
 *
 * It opens the same sheet rather than a screen of its own, so there is one place
 * where a code becomes a trip, and one set of words for every way it can fail.
 */
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import OpenSharedRoute from '../../src/components/OpenSharedRoute';
import { COLORS } from '../../src/constants/theme';

export default function SharedRouteLink() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const router = useRouter();

  // Dismissing leaves nothing behind: back to the saved trips, which is where
  // the route went if it was accepted and the obvious place to be if not.
  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/saved');
  };

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ title: 'Shared route' }} />
      <OpenSharedRoute visible initialCode={String(code ?? '')} onClose={leave} />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
});
