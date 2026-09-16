# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

## This project is pinned to Expo SDK 54 — do not upgrade blindly

As of Expo's May 2026 change, the public **App Store / Play Store Expo Go is capped at SDK 54**.
Newer SDKs (55/56/57) require `eas go` / TestFlight / a development build. We test on a
**physical iPhone via App Store Expo Go**, so the project must stay on **SDK 54** unless we move
to a development build first. Scaffolding on a newer SDK will show "you need a newer version of
the app" in Expo Go.

To change SDK: set `expo` in package.json, `npm install --legacy-peer-deps`, then
`npx expo install --fix` to realign every managed dependency.
