FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install

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

EXPOSE 8787

CMD ["node", "server/local-backend.mjs"]

# # syntax=docker/dockerfile:1.7

# # ============================================================
# # Base
# # ============================================================
# FROM node:20-alpine AS base

# WORKDIR /app

# ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
#     NPM_CONFIG_FUND=false


# # ============================================================
# # Dependencies
# # ============================================================
# FROM base AS deps

# COPY package*.json ./

# RUN npm ci


# # ============================================================
# # Build
# #
# # IMPORTANT:
# # .env files remain excluded by .dockerignore.
# # VITE_* values are supplied explicitly as build arguments.
# # ============================================================
# FROM deps AS build

# COPY . .

# ARG VITE_API_BASE_URL

# ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

# RUN npm run build


# # ============================================================
# # Production
# # ============================================================
# FROM node:20-alpine AS production

# WORKDIR /app

# ENV NODE_ENV=production \
#     PORT=8787 \
#     HOST=0.0.0.0

# # Production dependencies
# COPY --from=deps /app/node_modules ./node_modules

# # Frontend
# COPY --from=build /app/dist ./dist

# # Backend
# COPY --from=build /app/server ./server

# # Package metadata
# COPY --from=build /app/package.json ./package.json

# # If your backend requires these directories at runtime,
# # uncomment/copy them as appropriate:
# #
# COPY --from=build /app/reports ./reports
# COPY --from=build /app/public ./public

# # Run as non-root
# RUN addgroup -S appgroup && \
#     adduser -S appuser -G appgroup && \
#     chown -R appuser:appgroup /app

# USER appuser

# EXPOSE 8787

# # Docker/Kubernetes can use this endpoint.
# HEALTHCHECK --interval=30s \
#             --timeout=5s \
#             --start-period=30s \
#             --retries=3 \
#             CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

# CMD ["node", "server/local-backend.mjs"]
