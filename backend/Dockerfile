FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
# Skip lifecycle scripts: the postinstall hook runs `prisma generate` (schema not
# copied yet) and `prisma migrate deploy` (no database at build time). The client
# is generated explicitly below; migrations run at container start via CMD.
RUN npm ci --ignore-scripts
COPY prisma ./prisma
RUN npx prisma generate

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY src ./src
COPY package.json ./

RUN mkdir -p data uploads

EXPOSE 3001

CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]
