# Build from the repository root: docker build -f apps/server/Dockerfile .

# ---------- deps ----------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
RUN npm ci --workspace apps/server --include-workspace-root

# ---------- build ----------
FROM deps AS build
COPY apps/server apps/server
RUN npm run build --workspace apps/server \
 && npm prune --omit=dev --workspace apps/server

# ---------- runtime ----------
FROM node:20-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data
WORKDIR /app

RUN apk add --no-cache tini \
 && mkdir -p /data && chown node:node /data

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/server/dist ./dist
COPY --from=build --chown=node:node /app/apps/server/package.json ./

USER node
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
