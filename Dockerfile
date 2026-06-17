FROM node:22-bookworm-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

RUN npm prune --omit=dev

FROM node:22-bookworm-slim

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/src/db/schema.sql ./dist/db/schema.sql
COPY --from=build /app/src/dashboard/public ./dist/dashboard/public

RUN mkdir -p /app/data

ENV NODE_ENV=production

CMD ["node", "dist/cli/index.js", "start", "--foreground"]
