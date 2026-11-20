FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM dependencies AS build
# The CI image build passes NEXT_SKIP_CHECKS=true: the fast job already linted and type-checked this change, so `next
# build` does neither (#403). Its default keeps both in a release image or a local build.
ARG NEXT_SKIP_CHECKS=false
COPY . .
RUN npm run build

FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS runner
WORKDIR /app
# The version this image is (#442): the release workflow passes X.Y.Z for a release and main for a main build, and the app
# compares it with the newest on that channel (lib/updates.mjs). A local or CI build has none and checks nothing.
ARG GTMWORKS_VERSION=
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 GTMWORKS_VERSION=$GTMWORKS_VERSION
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# The providers' and apps' logos with their licences (#424): a standalone build does not carry public/.
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/worker ./worker
COPY --from=build --chown=node:node /app/lib ./lib
# The installer registers the install's Engine record through this script (#380); a release image needs it too.
COPY --from=build --chown=node:node /app/scripts/install-engine.mjs /app/scripts/company-add.mjs /app/scripts/company-list.mjs ./scripts/
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md
COPY --from=build --chown=node:node /app/components/paperclip/fonts/*.txt /app/components/paperclip/fonts/NOTICE.md ./licenses/paperclip/fonts/
# Everything an install reads from a source checkout, so a release install needs only its compose file and install
# script: in release mode scripts/install.sh copies /app/install into the install directory (#49).
COPY --from=build --chown=node:node /app/lib ./install/lib
COPY --from=build --chown=node:node /app/scripts/install-db.sql /app/scripts/local-default-privileges.sql /app/scripts/install-key.sh /app/scripts/install-nginx.conf /app/scripts/install-gateway-real-ip.sh /app/scripts/engine-template.yml /app/scripts/engine-managed.yml /app/scripts/engine-listener-address.py /app/scripts/engine-listener-address.sh /app/scripts/engine-ssh-sync-files.sh ./install/scripts/
COPY --from=build --chown=node:node /app/supabase/migrations ./install/supabase/migrations
# The main channel (scripts/get.sh --channel main) has no GitHub Release: its compose file and install script are written
# from these source files by release-assets.mjs, run inside the main image for the digest the install just pulled. Every
# image also carries its own get.sh, the gtmworks command an install or update of it leaves behind (#437).
COPY --from=build --chown=node:node /app/docker-compose.install.yml ./release-source/
COPY --from=build --chown=node:node /app/scripts/install.sh /app/scripts/get.sh /app/scripts/release-assets.mjs /app/scripts/engine-template.yml /app/scripts/engine-managed.yml /app/scripts/engine-listener-address.py /app/scripts/engine-listener-address.sh /app/scripts/engine-ssh-sync-files.sh ./release-source/scripts/
USER node
EXPOSE 3000
CMD ["node", "server.js"]
