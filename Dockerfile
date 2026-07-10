# ---- Build stage ----
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --only=production && rm -rf ~/.npm

# ---- Runtime stage ----
FROM node:20-alpine

RUN apk add --no-cache tini

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY . .

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3000
ENV MARGIN_DB_PATH=/app/data/echo.sqlite

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
