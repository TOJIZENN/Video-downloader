FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 ffmpeg ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

ENV NODE_ENV=production HOST=0.0.0.0
EXPOSE 3000
CMD ["node", "server.js"]