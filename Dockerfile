# ---- Build stage ----
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev && rm -rf ~/.npm

# ---- Runtime stage ----
FROM node:22-alpine

RUN apk add --no-cache tini

WORKDIR /app

COPY --from=build /app ./

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3000
ENV MARGIN_SURFACE_HOST=0.0.0.0
ENV MARGIN_SURFACE_PORT=3000

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "scripts/run-margin-surface.js"]
