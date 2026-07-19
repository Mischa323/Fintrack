# Debian (glibc + OpenSSL 3) rather than Alpine: Prisma's musl/OpenSSL detection
# is unreliable and falls back to an openssl-1.1.x engine that cannot load libssl.
FROM node:20-slim AS builder
WORKDIR /app
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
# Skip lifecycle scripts: the postinstall hook runs `prisma generate` (schema not
# copied yet) and `prisma migrate deploy` (no database at build time). The client
# is generated explicitly below; migrations run at container start via CMD.
RUN npm ci --ignore-scripts
COPY prisma ./prisma
RUN npx prisma generate

FROM node:20-slim AS runner
WORKDIR /app
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY src ./src
COPY package.json ./

# Record when this image was built so the app can report it. Placed after the
# source copy so it is refreshed whenever the code changes.
RUN date -u +"%Y-%m-%dT%H:%M:%SZ" > BUILD_TIME

RUN mkdir -p data uploads

EXPOSE 3001

CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]
