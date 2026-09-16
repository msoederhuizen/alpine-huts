#!/usr/bin/env bash
#
# One-time setup for a LOCAL BRouter routing server.
#
# WHY: the public brouter.de answers the route generator's request burst with
# "403 Please, retry later!". A 5-day search issues ~63 leg requests and most get
# rejected — which the generator reads as "these huts are unreachable" and
# reports as "couldn't link N days at all". Measured: 8 concurrent requests →
# 100% rejected; a full search → 40 of 63 rejected even gated to 4. The public
# server simply cannot carry this app, so we run our own.
#
# Downloads ~1.2 GB of routing segments. Safe to re-run: every step is skipped
# if already present, and segment downloads resume.
#
#   bash scripts/setup-brouter.sh
#   npm run brouter          # start it
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/brouter"
SEG="$DIR/segments4"
PROF="$DIR/profiles2"
CUSTOM="$DIR/customprofiles"
mkdir -p "$SEG" "$PROF" "$CUSTOM"

echo "==> BRouter home: $DIR"

# ── 0. Java ──────────────────────────────────────────────────────────────────
# BRouter is a JVM program. Nothing else here needs Java, so it's easy to miss.
if ! command -v java >/dev/null 2>&1; then
  cat <<'EOJ'

!! Java not found — BRouter needs a JVM (17+).

   No admin rights needed; use a portable JDK, the same way Node is set up here:

   1. Download the Temurin 21 JDK **.zip** for Windows x64:
        https://adoptium.net/temurin/releases/?os=windows&arch=x64&package=jdk
   2. Extract to  %LOCALAPPDATA%\jdk-portable
   3. In each shell that runs the server:
        $env:Path = "$env:LOCALAPPDATA\jdk-portable\bin;$env:Path"
      (or add it to your user PATH permanently, like nodejs-portable)
   4. Check with:  java -version

   Then re-run this script. Everything below still downloaded fine, so re-running
   only picks up where it left off.

EOJ
  JAVA_MISSING=1
else
  echo "==> java: $(java -version 2>&1 | head -1)"
fi

# ── 1. The server itself ─────────────────────────────────────────────────────
if [ ! -f "$DIR/brouter.jar" ]; then
  echo "==> Resolving latest BRouter release…"
  ZIP_URL=$(curl -fsSL https://api.github.com/repos/abrensch/brouter/releases/latest \
    | grep -o '"browser_download_url": *"[^"]*\.zip"' | head -1 | cut -d'"' -f4)
  if [ -z "$ZIP_URL" ]; then
    echo "!! Could not resolve a release zip. Download manually from"
    echo "   https://github.com/abrensch/brouter/releases and place brouter.jar in $DIR"
    exit 1
  fi
  echo "==> $ZIP_URL"
  curl -fL --retry 3 -o "$DIR/brouter.zip" "$ZIP_URL"
  ( cd "$DIR" && unzip -o -q brouter.zip && rm -f brouter.zip )
  # The jar sits at different depths across releases — normalise it.
  if [ ! -f "$DIR/brouter.jar" ]; then
    FOUND=$(find "$DIR" -name 'brouter*.jar' | head -1)
    [ -n "$FOUND" ] && cp "$FOUND" "$DIR/brouter.jar"
  fi
  # Stock profiles ship inside the zip; keep whatever it brought.
  FOUNDP=$(find "$DIR" -type d -name 'profiles2' | grep -v "^$PROF$" | head -1 || true)
  [ -n "$FOUNDP" ] && cp -n "$FOUNDP"/*.brf "$PROF"/ 2>/dev/null || true
fi
[ -f "$DIR/brouter.jar" ] || { echo "!! brouter.jar missing"; exit 1; }
echo "==> brouter.jar ok"

# ── 2. The EXACT profile the app asks for ────────────────────────────────────
# ⚠️ `hiking-beta` is NOT in the standard BRouter distribution — it's an older
# profile that only brouter.de serves. Fetching the real file is what keeps
# self-hosted routes identical to what the app produces today; substituting
# `hiking-mountain` would silently change every distance and ascent figure.
if [ ! -f "$PROF/hiking-beta.brf" ]; then
  echo "==> Fetching hiking-beta.brf (the profile src/api/brouter.ts requests)"
  curl -fL --retry 3 -o "$PROF/hiking-beta.brf" \
    https://brouter.de/brouter/profiles2/hiking-beta.brf
fi
echo "==> hiking-beta.brf ok ($(wc -c < "$PROF/hiking-beta.brf") bytes)"

# ── 2b. The app's own profiles ──────────────────────────────────────────────
# Derived from the pristine hiking-beta download; see scripts/make-profiles.mjs
# for each named edit and why it exists.
node "$(dirname "${BASH_SOURCE[0]}")/make-profiles.mjs" "$PROF"

# ── 3. Routing segments for the app's 42 regions ─────────────────────────────
# 5°x5° tiles. This list covers Switzerland, Italy, France, Austria, Germany,
# Slovenia, N. Spain, Portugal and Corsica — i.e. every bbox in constants/region.ts.
SEGMENTS="E0_N40 E0_N45 E5_N40 E5_N45 E10_N40 E10_N45 E15_N40 E15_N45 W5_N35 W5_N40 W10_N40 E5_N60 E15_N65"
echo "==> Segments (~1.2 GB total; resumable)"
for s in $SEGMENTS; do
  f="$SEG/$s.rd5"
  if [ -s "$f" ]; then
    echo "    • $s cached ($(du -h "$f" | cut -f1))"
  else
    echo "    ↓ $s"
    # -C - resumes a partial file; some tiles legitimately 404 (all ocean).
    curl -fL --retry 3 -C - -o "$f" "https://brouter.de/brouter/segments4/$s.rd5" \
      || { echo "      (no such segment — skipping)"; rm -f "$f"; }
  fi
done

cat <<EOF

==> Done.

Start the server with:      npm run brouter

Then point the app at it. Find this machine's LAN IP (NOT localhost — the app
runs on your phone, where localhost is the phone):

  Windows:  ipconfig      → "IPv4 Address"
  macOS:    ipconfig getifaddr en0

and put it in a .env file at the project root:

  EXPO_PUBLIC_BROUTER_URL=http://<LAN-IP>:17777/brouter

Restart Expo afterwards so the value is picked up. The app raises its routing
concurrency from 4 to 16 automatically once it is not using brouter.de.
EOF
