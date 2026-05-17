FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM base AS builder
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY src ./src
COPY package.json ./

RUN mkdir -p uploads

EXPOSE 3001

CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]
