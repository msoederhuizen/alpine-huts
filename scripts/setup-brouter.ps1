# One-time setup for a LOCAL BRouter routing server (PowerShell version).
#
# WHY: the public brouter.de answers the route generator's request burst with
# "403 Please, retry later!". A 5-day search issues ~63 leg requests and most get
# rejected — which the generator reads as "these huts are unreachable" and
# reports as "couldn't link N days at all". Measured: 8 concurrent requests →
# 100% rejected; a full search → 40 of 63 rejected even gated to 4. The public
# server cannot carry this app, so we run our own.
#
# Downloads ~1.2 GB of routing segments. Safe to re-run: every step is skipped if
# already present.
#
#   npm run setup-brouter
#   npm run brouter          # start it

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dir  = Join-Path $root 'brouter'
$seg  = Join-Path $dir 'segments4'
$prof = Join-Path $dir 'profiles2'
$cust = Join-Path $dir 'customprofiles'
foreach ($d in @($seg, $prof, $cust)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }

Write-Output "==> BRouter home: $dir"

# --- 0. Java -----------------------------------------------------------------
# BRouter is a JVM program. Nothing else in this project needs Java.
$java = Get-Command java -ErrorAction SilentlyContinue
if (-not $java) {
  Write-Output ""
  Write-Output "!! Java not found. Open a NEW terminal (the PATH change needs a fresh shell),"
  Write-Output "   or for this shell only:"
  Write-Output '     $env:Path = "$env:LOCALAPPDATA\jdk-portable\bin;$env:Path"'
  Write-Output ""
} else {
  $v = (& java -version 2>&1 | Select-Object -First 1)
  Write-Output "==> java: $v"
}

# --- 1. The server itself ----------------------------------------------------
$jar = Join-Path $dir 'brouter.jar'
if (-not (Test-Path $jar)) {
  Write-Output "==> Resolving latest BRouter release..."
  $rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/abrensch/brouter/releases/latest' `
                           -Headers @{ 'User-Agent' = 'alpine-huts-setup' }
  $asset = $rel.assets | Where-Object { $_.name -like '*.zip' } | Select-Object -First 1
  if (-not $asset) { throw "No .zip asset in the latest BRouter release." }
  Write-Output "==> $($asset.browser_download_url)"
  $zip = Join-Path $dir 'brouter.zip'
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip
  $tmp = Join-Path $dir '_unzip'
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  Remove-Item -Force $zip

  # The jar sits at different depths across releases - normalise it.
  $found = Get-ChildItem $tmp -Recurse -Filter 'brouter*.jar' | Select-Object -First 1
  if (-not $found) { throw "brouter jar not found inside the release zip." }
  Copy-Item $found.FullName $jar

  # Keep whatever stock profiles the zip brought along.
  $sp = Get-ChildItem $tmp -Recurse -Directory -Filter 'profiles2' | Select-Object -First 1
  if ($sp) { Copy-Item (Join-Path $sp.FullName '*.brf') $prof -Force -ErrorAction SilentlyContinue }
  Remove-Item -Recurse -Force $tmp
}
Write-Output "==> brouter.jar ok"

# --- 2. The EXACT profile the app asks for -----------------------------------
# hiking-beta is NOT in the standard BRouter distribution - only brouter.de
# serves it. Fetching the real file is what keeps self-hosted routes identical to
# what the app produces today; substituting hiking-mountain would silently change
# every distance and ascent figure.
$hb = Join-Path $prof 'hiking-beta.brf'
if (-not (Test-Path $hb)) {
  Write-Output "==> Fetching hiking-beta.brf (the profile src/api/brouter.ts requests)"
  Invoke-WebRequest -Uri 'https://brouter.de/brouter/profiles2/hiking-beta.brf' -OutFile $hb
}
Write-Output "==> hiking-beta.brf ok ($((Get-Item $hb).Length) bytes)"

# --- 2b. The app's own profiles ---------------------------------------------
# Derived from the pristine hiking-beta download; see scripts/make-profiles.mjs
# for each named edit and why it exists.
& node (Join-Path $PSScriptRoot "make-profiles.mjs") $prof

# --- 3. Routing segments for every region ------------------------------------
# 5x5 degree tiles covering Switzerland, Italy, France, Austria, Germany,
# Slovenia, N. Spain, Portugal, Corsica AND the two Nordic regions.
#
# ⚠️ A region whose tile is absent cannot be routed AT ALL, and the failure gives
# no hint why - legs simply never resolve. E5_N60 (Jotunheimen) and E15_N65
# (Kungsleden) were missing for exactly that reason: they were added to
# constants/region.ts without anyone updating this list. If you add a region
# outside the Alps, check its tile is here.
$segments = @('E0_N40','E0_N45','E5_N40','E5_N45','E10_N40','E10_N45',
              'E15_N40','E15_N45','W5_N35','W5_N40','W10_N40',
              'E5_N60','E15_N65')
Write-Output "==> Segments (~1.2 GB total)"
foreach ($s in $segments) {
  $f = Join-Path $seg "$s.rd5"
  if ((Test-Path $f) -and (Get-Item $f).Length -gt 0) {
    $mb = [math]::Round((Get-Item $f).Length / 1MB)
    Write-Output "    - $s cached ($mb MB)"
  } else {
    Write-Output "    downloading $s ..."
    try {
      Invoke-WebRequest -Uri "https://brouter.de/brouter/segments4/$s.rd5" -OutFile $f
      $mb = [math]::Round((Get-Item $f).Length / 1MB)
      Write-Output "      done ($mb MB)"
    } catch {
      # Some tiles legitimately don't exist (all ocean).
      Write-Output "      (no such segment - skipping)"
      if (Test-Path $f) { Remove-Item -Force $f }
    }
  }
}

Write-Output ""
Write-Output "==> Done."
Write-Output ""
Write-Output "Start the server with:   npm run brouter"
Write-Output ""
Write-Output "Then point the app at it. Find this machine's LAN IP (NOT localhost -"
Write-Output "the app runs on your phone, where localhost is the phone):"
Write-Output ""
Write-Output "  ipconfig    ->  'IPv4 Address'"
Write-Output ""
Write-Output "and put it in a .env file at the project root:"
Write-Output ""
Write-Output "  EXPO_PUBLIC_BROUTER_URL=http://<LAN-IP>:17777/brouter"
Write-Output ""
Write-Output "Restart Expo afterwards. The app raises routing concurrency from 4 to 16"
Write-Output "automatically once it is not using brouter.de."
