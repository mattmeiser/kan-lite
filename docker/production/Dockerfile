# Build from the repo root:
#   docker build -f docker/production/Dockerfile -t kanlite:latest .
#
# A single, self-contained image: nginx serves the built React app and
# proxies /api to a co-located backend process, both supervised by s6 (same
# pattern this household's other self-hosted apps use). One port (80), one
# volume (/data) for the SQLite database and migration reports.
#
# See docs/deployment/DEPLOYMENT.md for full fresh-install and
# Kanboard-import instructions.

# ---- Frontend build ----
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci

COPY shared shared
COPY backend backend
COPY frontend frontend
RUN npm run build --workspace frontend

# ---- Runtime image ----
FROM node:22-alpine

LABEL org.opencontainers.image.title="KanLite" \
    org.opencontainers.image.description="A lightweight household Kanban board"

RUN apk --no-cache add nginx s6 curl tzdata

WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/shared shared
COPY --from=build /app/backend backend
COPY --from=build /app/frontend/dist /usr/share/nginx/html

COPY docker/production/rootfs/ /

RUN mkdir -p /data && rm -f /etc/nginx/http.d/default.conf

ENV NODE_ENV=production \
    PORT=4000 \
    DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 80

HEALTHCHECK --start-period=5s --timeout=5s \
  CMD curl -f http://localhost/api/health || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD []
