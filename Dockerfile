FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY . ./
RUN node scripts/patch-realtime-sdp.mjs
RUN npm run build

ENV NODE_ENV=production

CMD ["node", "server/bootstrap-voice.mjs"]
