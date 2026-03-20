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

COPY --from=builder /app/dist ./dist/
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json* ./

RUN npm ci --omit=dev && npx prisma generate

RUN mkdir -p /app/data && addgroup -S issues && adduser -S issues -G issues && chown -R issues:issues /app
USER issues

EXPOSE 4000

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:4000/graphql --header='Content-Type: application/json' --post-data='{"query":"{ __typename }"}' || exit 1

CMD sh -c "npx prisma migrate deploy && node dist/prisma/seed.js && exec node dist/src/index.js"
