# Deploying

Two ways to change what users see. Knowing which applies saves a week of
waiting for Apple.

## 1. Without an App Store release

### Settings — `docs/config.json`

Edit, commit, push. GitHub Pages serves it and every installed copy picks it up
on its next launch, **including versions from years ago**.

```jsonc
{
  "brouterUrl": "https://routing.example.com",  // moving the routing server
  "supportEmail": "…",
  "notice": "Route planning is down for maintenance"  // tell users something
}
```

Nothing here can break the app: malformed values are rejected, a failed fetch
keeps the previous ones, and with no cache and no network the compiled-in
defaults apply. See `src/api/remoteConfig.ts`.

### JavaScript and bundled data — `npm run ota`

```bash
npm run ota
```

Ships everything in the JS bundle: screens, logic, and — importantly —
**`photo-index.json`**, because it is `require`d rather than downloaded. New
photos reach users in hours instead of at the next release.

## 2. Requiring an App Store release

Anything **native**:

- adding or removing a package with native code (a new `expo-*` module, a map
  library, a permission)
- changing anything in `app.json` under `ios`, `android`, `plugins`, `icon`,
  `splash`, or the permission strings
- upgrading the Expo SDK

⚠️ **`runtimeVersion` is set to `fingerprint`**, which hashes the native project.
An OTA update only reaches builds whose native side matches. That is the safety
net: it makes it *impossible* to push JavaScript expecting a native module the
installed binary does not have, which would otherwise crash on launch for
everyone, unfixably, because the crash happens before the next update can load.
If a change alters the fingerprint, you need a new build. That is the system
working.

## Apple's rule on over-the-air updates

Permitted for bug fixes, content and improvements. **Not** for changing what the
app fundamentally is — see App Store Review Guideline 2.5.2. Shipping new hut
photos, fixing a routing bug, adjusting a screen: all fine. Turning a hiking
planner into something else: not.

## First-time setup (needs an Expo account — free)

`expo-updates` is installed and configured, but it does not yet know where to
fetch from. That requires an EAS project:

```bash
npx eas login
npx eas init          # fills in extra.eas.projectId and updates.url in app.json
```

Then build once so the native side contains `expo-updates`:

```bash
npx eas build --profile production --platform ios
```

**OTA only works from that build onwards.** The binary currently on any phone
has no updates module, so it can never receive one — the first release has to
go through the App Store regardless.

## Before the first submission

- ⚠️ `ios.bundleIdentifier` is `com.msoederhuizen.alpinehuts`. **Permanent once
  published** — it can never be changed afterwards, and it must match the App ID
  registered in your Apple Developer account. Change it now if you want
  something else.
- `PRIVACY_URL` in `app/about.tsx` must resolve — Apple checks it.
- A permanent routing host must exist and be set in `docs/config.json`, or route
  planning will not work for users.
