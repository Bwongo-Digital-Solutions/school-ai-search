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
