FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM dependencies AS build
COPY . .
RUN npm run build

FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/worker ./worker
COPY --from=build --chown=node:node /app/lib ./lib
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md
COPY --from=build --chown=node:node /app/components/paperclip/fonts/*.txt /app/components/paperclip/fonts/NOTICE.md ./licenses/paperclip/fonts/
# Everything an install reads from a source checkout, so a release install needs only its compose file and install
# script: in release mode scripts/install.sh copies /app/install into the install directory (#49).
COPY --from=build --chown=node:node /app/lib ./install/lib
COPY --from=build --chown=node:node /app/scripts/install-db.sql /app/scripts/local-default-privileges.sql /app/scripts/install-key.sh /app/scripts/install-nginx.conf /app/scripts/install-gateway-real-ip.sh ./install/scripts/
COPY --from=build --chown=node:node /app/supabase/migrations ./install/supabase/migrations
# The main channel (scripts/get.sh --channel main) has no GitHub Release: its compose file and install script are written
# from these source files by release-assets.mjs, run inside the main image for the digest the install just pulled.
COPY --from=build --chown=node:node /app/docker-compose.install.yml ./release-source/
COPY --from=build --chown=node:node /app/scripts/install.sh /app/scripts/release-assets.mjs ./release-source/scripts/
USER node
EXPOSE 3000
CMD ["node", "server.js"]
