# ---------------------------------------------------------------------------
# FiberTrack Pro - Self-hosting Dockerfile
# Builds a production image of the Next.js app that you can run anywhere.
#
# Build context MUST be this directory (the folder containing package.json).
#   docker build -t fibertrack-pro .
# Or simply use docker-compose.yml which sets the context for you.
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
#    --production=false forces devDependencies (tailwindcss, postcss,
#    tailwindcss-animate, etc.) to install even though NODE_ENV=production -
#    they are required by `yarn build`. A committed yarn.lock makes the install
#    fully reproducible from a clean clone.
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=false --network-timeout 600000

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
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" yarn build

# 5) Entrypoint applies the DB schema (and optionally seeds) before starting.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["yarn", "start"]
