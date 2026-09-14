# ---------------------------------------------------------------------------
# FiberTrack Pro - Self-hosting Dockerfile
# Builds a production image of the Next.js app that you can run anywhere.
#
# Build context MUST be this directory (the folder containing package.json).
#   docker build -t fibertrack-pro .
# Or simply use docker-compose.yml which sets the context for you.
#
# SECURITY (Sections J/L): the app runs as a dedicated NON-ROOT user. Only the
# minimal set of directories the app must write at runtime are made writable by
# that user; all source, Prisma migrations, and bootstrap scripts stay readable.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS app

# openssl + ca-certificates are required by Prisma's query engine at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

# 1) Install dependencies first for better layer caching.
#    This is a Yarn 4 (Berry) project: the committed yarn.lock is Berry-format
#    and .yarnrc.yml + the package.json "packageManager" field pin the exact
#    toolchain. corepack activates Yarn 4.9.2 and `--immutable` guarantees the
#    lockfile is honored exactly (fails the build if it would change), so the
#    install is fully reproducible from a clean clone. devDependencies
#    (tailwindcss, postcss, ...) are needed by the build and install by default.
COPY package.json yarn.lock .yarnrc.yml ./
RUN corepack enable \
    && corepack prepare yarn@4.9.2 --activate \
    && YARN_NETWORK_TIMEOUT=600000 yarn install --immutable

# 2) Copy the rest of the application source.
COPY . .

# 3) The committed Prisma schema points its generated client at a path that only
#    exists on the build platform. Rewrite it to a location inside this image
#    before generating the client. (Mirrors what the hosting platform does at
#    deploy time - the committed schema itself is left untouched.)
RUN sed -i 's#/home/ubuntu/fibertrack_pro/nextjs_space/node_modules/.prisma/client#../node_modules/.prisma/client#' prisma/schema.prisma \
    && yarn prisma generate

# 4) Build the Next.js app. A syntactically-valid dummy DATABASE_URL is supplied
#    so the build never needs a live database (no queries run at build time).
#    Section 14: self-hosting builds use the webpack builder (build:selfhost)
#    with an enlarged Node heap so large route graphs never OOM. APP_BUILD_SHA
#    is baked in so the running app can report the exact commit it was built from.
ARG APP_BUILD_SHA=unknown
ENV APP_BUILD_SHA=${APP_BUILD_SHA}
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    NODE_OPTIONS="--max-old-space-size=12288" \
    yarn build:selfhost

# 5) Entrypoint applies the DB schema (and optionally seeds) before starting.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# 6) SECURITY (Sections J/L): create a dedicated non-root user and grant it
#    ONLY the runtime-writable directories it needs:
#      - /app/data        -> update staging/backups + local branding/logo store
#      - /app/.next/cache -> Next.js runtime image/data cache
#    Everything else (source, prisma/migrations, scripts/db-bootstrap.mjs,
#    scripts/bootstrap-admin.ts, node_modules, the built .next output) stays
#    owned by root and world-readable, so it can be read/executed but NOT
#    modified by the app process.
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /app --shell /usr/sbin/nologin app \
    && mkdir -p /app/data/updates/staging /app/data/updates/backups /app/data/branding /app/.next/cache \
    && chown -R app:app /app/data /app/.next/cache \
    && chmod -R u+rwX,go+rX /app/prisma /app/scripts

USER app

EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["yarn", "start"]
