# Build context is the repo root (see docker-compose.yml) — needed for npm workspace installs.
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared-types packages/shared-types
RUN npm ci
RUN npm run build --workspace packages/shared-types
COPY apps/api apps/api
RUN npm run build --workspace apps/api

FROM node:22-alpine
WORKDIR /repo
ENV NODE_ENV=production
# node:sqlite is a Node built-in — no native module rebuild needed, unlike better-sqlite3.
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json

ENV DB_PATH=/repo/data/petropro.db
VOLUME ["/repo/data"]
EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]
