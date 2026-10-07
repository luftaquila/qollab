FROM node:24.15.0-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/renderer/package.json apps/renderer/package.json
COPY packages/codec/package.json packages/codec/package.json
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
FROM node:24.15.0-bookworm-slim
LABEL org.opencontainers.image.source="https://github.com/luftaquila/qollab" org.opencontainers.image.licenses="MIT"
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY package.json LICENSE ./
RUN mkdir /data && chown node:node /data
USER node
ENV HOST=0.0.0.0 PORT=3000 DATA_DIR=/data NODE_ENV=production
EXPOSE 3000
CMD ["node","dist/server/src/main.js"]
