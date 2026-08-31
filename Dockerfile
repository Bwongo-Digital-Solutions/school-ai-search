# Three stages: install once, build the frontend, ship only what runs.
#
# Note what is deliberately absent: there is no `ARG VITE_API_BASE_URL`. The bundle is built with no
# API base at all, so every request it makes is same-origin and relative — which is precisely what
# lets one image serve kampala-high.eschool.ink, gulu-ss.eschool.ink and every school after them.
# Baking a host in would tie an image to a single tenant.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` rather than `npm install`: it installs exactly the lockfile, and fails instead of
# silently resolving something new when the two have drifted.
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV LOCAL_BACKEND_HOST=0.0.0.0
ENV LOCAL_BACKEND_PORT=8787
ENV LOCAL_STATIC_ROOT=/app/dist

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/package.json ./package.json

# Runs as a normal user. Nothing here writes to disk — PDFs are generated in memory and every record
# lives in Postgres — so the whole filesystem can stay read-only to the process.
RUN addgroup -S appgroup \
 && adduser -S appuser -G appgroup \
 && chown -R appuser:appgroup /app
USER appuser

EXPOSE 8787

# Compose and orchestrators use this to know the app is actually serving, not merely started. It
# checks the same endpoint the compose healthcheck does; wget is in the alpine base already.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --no-verbose --spider http://127.0.0.1:8787/api/health || exit 1

CMD ["node", "server/local-backend.mjs"]
