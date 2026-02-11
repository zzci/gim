# Stage 1: Extract git info
FROM alpine/git AS git-info
WORKDIR /app
COPY .git .git
RUN printf '{\n  "commit": "%s",\n  "commitFull": "%s",\n  "branch": "%s",\n  "buildTime": "%s"\n}\n' \
  "$(git rev-parse --short HEAD)" \
  "$(git rev-parse HEAD)" \
  "$(git rev-parse --abbrev-ref HEAD)" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > build.json

# Stage 2: Build admin panel
FROM oven/bun:latest AS build
WORKDIR /app

COPY admin/package.json admin/bun.lock admin/
RUN cd admin && bun install --frozen-lockfile

COPY admin/ admin/
RUN cd admin && bun run build

# Stage 3: Runtime
FROM oven/bun:latest
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

COPY app/ app/
COPY drizzle/ drizzle/
COPY tsconfig.json ./
COPY --from=build /app/admin/dist ./admin/dist
COPY --from=git-info /app/build.json ./

RUN mkdir -p data

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "app/index.ts"]
