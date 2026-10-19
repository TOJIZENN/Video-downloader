FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
# Same engine as local development: .venv with yt-dlp, yt-dlp-ejs (YouTube needs
# Node 22+ to solve its JS challenges) and curl_cffi (browser impersonation)
RUN npm run setup

ENV NODE_ENV=production HOST=0.0.0.0
EXPOSE 3000
CMD ["node", "server.js"]
