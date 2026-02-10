# Stage 1: Install dependencies
FROM oven/bun:latest AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY admin/package.json admin/bun.lock admin/
RUN cd admin && bun install --frozen-lockfile

# Stage 2: Build server and admin panel
FROM oven/bun:latest AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY admin/package.json admin/bun.lock admin/
RUN cd admin && bun install --frozen-lockfile
COPY . .
RUN bun run build
RUN bun run admin:build

# Stage 3: Runtime
FROM oven/bun:latest AS runtime
WORKDIR /app

COPY --from=build /app/dist ./dist
COPY --from=build /app/admin/dist ./admin/dist
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

RUN mkdir -p data

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "dist/index.js"]
