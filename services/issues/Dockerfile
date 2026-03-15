FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
COPY prisma ./prisma/

RUN npm ci
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src/

RUN npm run build

FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json* ./

RUN npm ci --omit=dev && npx prisma generate

RUN mkdir -p /app/data && addgroup -S issues && adduser -S issues -G issues && chown -R issues:issues /app
USER issues

EXPOSE 4000

CMD sh -c "npx prisma migrate deploy && node dist/prisma/seed.js && node dist/index.js"
