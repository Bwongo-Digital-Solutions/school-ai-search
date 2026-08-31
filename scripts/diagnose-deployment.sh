#!/bin/sh
# Run this ON THE SERVER, from the repo directory.
DOMAIN="${TENANT_ROOT_DOMAIN:-eschool.ink}"
echo "=== 1. DNS ==="
getent hosts "$DOMAIN" || echo "  !! $DOMAIN does not resolve"
getent hosts "test.$DOMAIN" || echo "  !! *.$DOMAIN wildcard does not resolve"
echo "  this server's public IP: $(curl -s --max-time 5 https://api.ipify.org || echo unknown)"

echo; echo "=== 2. Is anything listening on 80/443? ==="
(ss -lntp 2>/dev/null || netstat -lntp 2>/dev/null) | grep -E ':(80|443)\s' || echo "  !! nothing is listening on 80 or 443"

echo; echo "=== 3. Is the app itself up? ==="
curl -sS -m 5 -o /dev/null -w '  127.0.0.1:8787/api/health -> %{http_code}\n' http://127.0.0.1:8787/api/health \
  || echo "  !! the app is not answering on 127.0.0.1:8787"

echo; echo "=== 4. Which nginx is in play? ==="
systemctl is-active nginx 2>/dev/null | sed 's/^/  host nginx: /'
docker ps --format '  container: {{.Names}} {{.Status}} {{.Ports}}' 2>/dev/null | grep -Ei 'nginx|caddy|school' || echo "  no proxy container running"

echo; echo "=== 5. Does the nginx config even load? ==="
if systemctl is-active --quiet nginx 2>/dev/null || [ -d /etc/nginx ]; then
  nginx -v 2>&1 | sed 's/^/  /'
  nginx -t 2>&1 | sed 's/^/  /'
fi
docker compose --profile proxy-nginx logs --tail=25 nginx 2>/dev/null | sed 's/^/  /'

echo; echo "=== 6. Certificate files ==="
for f in /etc/letsencrypt/live/$DOMAIN/fullchain.pem deploy/nginx/certs/fullchain.pem; do
  [ -f "$f" ] && echo "  present: $f" || echo "  MISSING: $f"
done

echo; echo "=== 7. Firewall ==="
(ufw status 2>/dev/null | head -5) || (firewall-cmd --list-all 2>/dev/null | head -8) || echo "  no ufw/firewalld"

echo; echo "=== 8. What does the outside see? ==="
curl -sS -m 8 -o /dev/null -w '  http  -> %{http_code}\n' "http://$DOMAIN" || echo "  http  -> failed"
curl -sSk -m 8 -o /dev/null -w '  https -> %{http_code}\n' "https://$DOMAIN" || echo "  https -> failed"
