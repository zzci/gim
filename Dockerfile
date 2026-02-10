# Stage 1: Build server and admin panel
FROM oven/bun:latest AS build
WORKDIR /app

# Install all deps (skip native module compilation — better-sqlite3 is dev-only, runtime uses bun:sqlite)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY admin/package.json admin/bun.lock admin/
RUN cd admin && bun install --frozen-lockfile

# Build
COPY . .
RUN bun run build
RUN bun run admin:build

# Stage 2: Runtime (production deps only)
FROM oven/bun:latest AS runtime
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/admin/dist ./admin/dist

RUN mkdir -p data

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "dist/index.js"]
