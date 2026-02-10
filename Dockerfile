# Stage 1: Build server and admin panel
FROM oven/bun:latest AS build
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Install deps (cached unless package.json/bun.lock change)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY admin/package.json admin/bun.lock admin/
RUN cd admin && bun install --frozen-lockfile

# Build
COPY . .
RUN bun run build
RUN bun run admin:build

# Production deps only (separate layer for smaller runtime image)
RUN rm -rf node_modules && bun install --frozen-lockfile --production

# Stage 2: Runtime
FROM oven/bun:latest AS runtime
WORKDIR /app

COPY --from=build /app/dist ./dist
COPY --from=build /app/admin/dist ./admin/dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

RUN mkdir -p data

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "dist/index.js"]
