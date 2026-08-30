FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
# The repository lockfile is currently out of sync with package.json. Use npm install
# during the image build so npm can reconcile the lockfile instead of failing npm ci.
RUN npm install --omit=dev --no-audit --no-fund

COPY . ./
RUN node scripts/patch-realtime-sdp.mjs
RUN npm run build

ENV NODE_ENV=production

CMD ["node", "server/bootstrap-voice-v2.mjs"]
