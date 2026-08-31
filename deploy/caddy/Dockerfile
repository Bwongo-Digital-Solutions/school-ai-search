# Caddy with a DNS provider plugin built in.
#
# The stock caddy image ships with no DNS providers at all, and a wildcard certificate can only be
# issued over the DNS-01 challenge — so `tls { dns cloudflare ... }` in the Caddyfile fails to load
# on the stock image with "getting module named 'dns.providers.cloudflare'". This builds the one
# plugin in. That is why the compose service builds rather than pulling.
#
# For a different DNS provider, change the module below to the matching one from
# https://github.com/caddy-dns — for example github.com/caddy-dns/route53 — and change the provider
# name in deploy/caddy/Caddyfile to match.
FROM caddy:2-builder-alpine AS builder
RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
