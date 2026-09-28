#!/usr/bin/env bash
#
# Turn a bare Ubuntu box into the app's permanent routing server.
#
# Builds on scripts/setup-brouter.sh, which already installs BRouter, fetches
# hiking-beta, generates the app's own profiles and downloads the 13 segment
# tiles. This adds only what a SERVER needs and a laptop does not:
#
#   1. it survives a reboot            (systemd)
#   2. it answers over https           (Caddy, certificate obtained automatically)
#   3. the firewall actually lets it   (Oracle images block everything but ssh,
#                                       in iptables as well as in the console)
#
# Works on any current Ubuntu LTS, x86 or ARM: everything comes from the
# distribution's own repositories rather than pinned versions or third-party
# apt sources, so a newer release does not break it.
#
# The iptables step is only needed on Oracle, whose images block ports a second
# time on the box itself. It is harmless everywhere else, so it stays.
#
#   bash scripts/setup-server.sh routing.yourdomain.com
#
# Re-runnable: every step is skipped if already done.
set -euo pipefail

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  cat >&2 <<'EOF'
Usage: bash scripts/setup-server.sh <domain>

  e.g. bash scripts/setup-server.sh routing.example.com

The domain must already have an A record pointing at THIS machine's public IP.
Caddy proves ownership over port 80 to get the certificate, so DNS has to be
correct before you run this or the certificate request will fail.

⚠️ A domain is not optional. iOS refuses plain http, so the app cannot talk to
a bare IP address whatever else is configured.
EOF
  exit 1
fi

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BROUTER_DIR="$REPO/brouter"
PORT=17777

echo "==> Routing server for $DOMAIN"

# ── 1. Packages ──────────────────────────────────────────────────────────────
# Java runs BRouter; Node generates the profiles; the rest are fetch/unpack.
#
# ⚠️ UBUNTU'S OWN PACKAGES ONLY — no third-party apt repositories for Java or
# Node. NodeSource keys its repo on the release codename and can lag months
# behind a new Ubuntu, which would make this script fail on exactly the newest
# LTS someone is most likely to have just installed. Ubuntu's `nodejs` is old
# by Node's standards and entirely sufficient: make-profiles.mjs reads files,
# edits text and writes files.
#
# `default-jre-headless` rather than a pinned version, for the same reason —
# whatever the distribution considers current will run BRouter.
echo "==> Packages"
sudo apt-get update -qq
sudo apt-get install -y -qq default-jre-headless nodejs unzip curl ca-certificates

java -version 2>&1 | head -1
node --version

# ── 2. BRouter itself ────────────────────────────────────────────────────────
# ~1.2 GB of segments. Resumable, and skipped entirely on a re-run.
echo "==> BRouter (this is the slow part, ~1.2 GB)"
bash "$REPO/scripts/setup-brouter.sh"

# ── 3. Run it as a service ───────────────────────────────────────────────────
#
# ⚠️ THE WHOLE POINT. A tunnel from a laptop died three times in one day and
# took routing down with it. A service restarts on failure and comes back after
# a reboot, without anybody noticing.
#
# Bound to 127.0.0.1 is deliberate: Caddy is the only thing that should reach
# BRouter, so the routing port is never exposed even if the firewall is wrong.
echo "==> systemd service"
sudo tee /etc/systemd/system/brouter.service >/dev/null <<EOF
[Unit]
Description=BRouter routing server for Alpine Huts
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$BROUTER_DIR
ExecStart=/usr/bin/java -Xms2g -Xmx2g -cp $BROUTER_DIR/brouter.jar \\
  btools.server.RouteServer \\
  $BROUTER_DIR/segments4 $BROUTER_DIR/profiles2 $BROUTER_DIR/customprofiles \\
  $PORT 16
Restart=always
RestartSec=5
# Routing is pure computation over local files; it needs nothing else.
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now brouter
sleep 3
systemctl is-active --quiet brouter && echo "    brouter is running" || {
  echo "!! brouter did not start. Logs:"; sudo journalctl -u brouter -n 30 --no-pager; exit 1;
}

# ── 4. https ─────────────────────────────────────────────────────────────────
# Caddy obtains and renews a Let's Encrypt certificate on its own. That is the
# entire reason it is here rather than nginx: no certbot, no cron, no renewal
# that quietly expires eighteen months from now.
echo "==> Caddy"
if ! command -v caddy >/dev/null 2>&1; then
  sudo apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq caddy
fi

# ── 4b. The cache that makes one small box cope ──────────────────────────────
#
# ⚠️ THIS IS WHAT ANSWERS THE CAPACITY QUESTION, NOT THE APP'S OWN CACHE.
# Planning one multi-day trip asks for about 63 legs and BRouter is CPU-bound,
# so a 2-core box serves one or two people planning at once and the rest queue.
# The app caches legs on the phone, but that helps ONE device: the hundredth
# person to plan Rifugio X → Rifugio Y still makes the server compute it.
#
# The huts do not move, and BRouter is a pure function of its URL — the same
# lonlats and profile always produce the same geometry. So identical requests
# are literally identical URLs, and a proxy can answer them from disk without
# waking the router at all. Compute once, serve forever.
#
# ⚠️ NGINX RATHER THAN CADDY, DELIBERATELY. Caddy's standard build has no
# response cache; adding one means a custom binary with a third-party module.
# Putting TLS termination — the thing that must never fail to start — on a
# module that may not survive the next Caddy release is a poor trade for a
# feature nginx has had built in for fifteen years. Caddy keeps doing what it
# was chosen for (certificates, automatically) and proxies to nginx.
#
#   Caddy :443 (TLS)  →  nginx :8080 (cache)  →  BRouter :17777
#
echo "==> nginx (leg cache)"
command -v nginx >/dev/null 2>&1 || sudo apt-get install -y -qq nginx
sudo mkdir -p /var/cache/nginx/brouter

sudo tee /etc/nginx/conf.d/brouter-cache.conf >/dev/null <<EOF
# 5 GB holds a very large number of legs; one is a few hundred coordinate pairs.
# inactive=365d because an unused leg is still correct — eviction should be
# driven by SPACE, not by age, or a quiet winter would throw away a summer's
# worth of computation.
proxy_cache_path /var/cache/nginx/brouter levels=1:2 keys_zone=brouter:50m
                 max_size=5g inactive=365d use_temp_path=off;

server {
	listen 127.0.0.1:8080;

	location / {
		proxy_pass http://127.0.0.1:$PORT;
		proxy_cache brouter;

		# The whole request line, so profile and waypoints are part of the
		# identity. Keying on the path alone would serve a T3 route to
		# someone who asked for T6.
		proxy_cache_key "\$request_uri";

		# A year for real answers. Trails are re-mapped over years, and a
		# stale leg is a slightly wrong line, not a wrong hut.
		proxy_cache_valid 200 365d;

		# ⚠️ Errors get ONE MINUTE, never a year. BRouter answers 4xx for
		# "these two points aren't connected" — but it also fails while the
		# segment files are still loading after a restart. Caching that for
		# a year would permanently teach the server that reachable huts are
		# unreachable, and nothing would ever correct it.
		proxy_cache_valid any 1m;

		# ⚠️ THE SINGLE MOST VALUABLE LINE HERE. Without it, fifty people
		# asking for the same uncached leg at once produce fifty identical
		# BRouter computations. With it, one computes and the rest wait for
		# that answer — which is exactly the burst a popular route creates.
		proxy_cache_lock on;
		proxy_cache_lock_timeout 30s;

		# BRouter sends no caching headers of its own, and what it does send
		# must not be allowed to disable this.
		proxy_ignore_headers Cache-Control Expires Set-Cookie;

		# Keep serving a known-good answer if BRouter dies or is restarting.
		proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
		proxy_cache_background_update on;

		# So you can SEE whether it is working: HIT, MISS or EXPIRED.
		add_header X-Cache-Status \$upstream_cache_status always;
	}
}
EOF

# nginx ships a default site on :80 that would fight Caddy for the port.
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx || sudo systemctl restart nginx

sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
$DOMAIN {
	# Through the cache, not straight to BRouter — see section 4b.
	reverse_proxy 127.0.0.1:8080
}
EOF
sudo systemctl reload caddy || sudo systemctl restart caddy

# Prove it, rather than assume it. The second request for the same URL must say
# HIT; if it says MISS twice the cache is not working and the box will fall over
# under load exactly as it would have without it.
echo "==> checking the cache"
PROBE="http://127.0.0.1:8080/brouter?lonlats=11.0,47.0|11.01,47.01&profile=hiking-t6&alternativeidx=0&format=geojson"
curl -s -o /dev/null -D - "\$PROBE" | grep -i x-cache-status || true
curl -s -o /dev/null -D - "\$PROBE" | grep -i x-cache-status || true
echo "   (the second line should read HIT)"

# ── 5. The firewall nobody expects ───────────────────────────────────────────
#
# ⚠️ ORACLE BLOCKS PORTS TWICE. Opening 80/443 in the console's security list is
# necessary and NOT sufficient: their Ubuntu image also ships iptables rules
# that REJECT everything else, and the rejection happens on the box, so the
# console looks correctly configured while nothing can connect. This is the
# single most common reason an Oracle instance appears dead.
echo "==> Firewall"
for p in 80 443; do
  if ! sudo iptables -C INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport $p -j ACCEPT
    echo "    opened $p"
  fi
done
sudo apt-get install -y -qq iptables-persistent >/dev/null 2>&1 || true
sudo netfilter-persistent save >/dev/null 2>&1 || true

cat <<EOF

==> Done.

Check it from your laptop:

  curl "https://$DOMAIN/brouter?lonlats=7.66,45.97|7.74,45.93&profile=hiking-t3&alternativeidx=0&format=geojson"

Then tell the app, by editing docs/config.json in the repo:

  "brouterUrl": "https://$DOMAIN/brouter"

commit, push. Every installed copy picks it up on its next launch — no app
release. That is the point of the whole arrangement.

Useful:
  sudo systemctl status brouter
  sudo journalctl -u brouter -f
EOF
