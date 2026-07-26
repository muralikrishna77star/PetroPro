# Build context is the repo root (see docker-compose.yml) — needed for npm workspace installs.
FROM node:22-alpine AS build
WORKDIR /repo

# NEXT_PUBLIC_* variables are baked into the client bundle at build time, not read at container
# start — set this at build time (docker-compose.yml's `build.args`) if the API won't be at
# http://localhost:4000 from the browser's perspective.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared-types packages/shared-types
RUN npm ci
RUN npm run build --workspace packages/shared-types
COPY apps/web apps/web
RUN npm run build --workspace apps/web

# `output: "standalone"` (next.config.ts) traces only the deps actually used at runtime into
# .next/standalone, mirroring the monorepo path (apps/web/server.js) — static assets and the
# public/ folder aren't included there and must be copied in separately.
FROM node:22-alpine
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public

EXPOSE 3000
ENV PORT=3000
CMD ["node", "apps/web/server.js"]
