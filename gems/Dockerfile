FROM node:22-alpine

ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# Install dependencies for canvas and fonts
RUN apk add --no-cache \
    build-base \
    cairo-dev \
    pango-dev \
    jpeg-dev \
    giflib-dev \
    librsvg-dev \
    font-noto-cjk

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev


COPY src/scripts/ ./src/scripts/
COPY agent/ ./agent/
COPY backtests/ ./backtests/
COPY BOT_CHANGELOG.md ./BOT_CHANGELOG.md

# State data directory
RUN mkdir -p /app/data
RUN mkdir -p /app/signals
RUN mkdir -p /app/k_data

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN sed -i 's/\r$//' /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh

CMD ["/docker-entrypoint.sh"]
