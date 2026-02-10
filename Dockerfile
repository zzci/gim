# Stage 1: Build admin panel
FROM oven/bun:latest AS build
WORKDIR /app

COPY admin/package.json admin/bun.lock admin/
RUN cd admin && bun install --frozen-lockfile

COPY admin/ admin/
RUN bun run admin:build

# Stage 2: Runtime
FROM oven/bun:latest
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

COPY app/ app/
COPY drizzle/ drizzle/
COPY tsconfig.json ./
COPY --from=build /app/admin/dist ./admin/dist

RUN mkdir -p data

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "app/index.ts"]
