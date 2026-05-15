FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vitest.config.ts ./
COPY src ./src
COPY demo ./demo
COPY tests ./tests

RUN npm run build && npm test

# Default: full P-01 benchmark (must score 1.0)
CMD ["python3", "tests/p01-crdt/run.py", \
     "--adapter", "adapters.myteam:Engine", \
     "--fk-policy", "tombstone", \
     "--out", "/tmp/report.json"]
