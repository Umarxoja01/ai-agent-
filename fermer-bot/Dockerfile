# Fermer hisobchisi - Telegram bot
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production DB_PATH=/data/fermer.db
WORKDIR /app
# ishlash uchun tashqi paket kerak emas: faqat Node (node:sqlite, fetch)
COPY package.json ./
COPY --from=build /app/dist ./dist
COPY scripts/backup.mjs ./scripts/backup.mjs
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
CMD ["node", "--no-warnings", "dist/main.js"]
