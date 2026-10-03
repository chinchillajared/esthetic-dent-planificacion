# syntax=docker/dockerfile:1

# ---- Build: lint + Tailwind + copia de assets ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY eslint.config.js .htmlvalidate.json ./
COPY scripts ./scripts
COPY src ./src
COPY public ./public
RUN npm run check && npm run build

# ---- Runtime: nginx sin privilegios sirviendo archivos estáticos en :3000 ----
FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=101:101 /app/dist /usr/share/nginx/html
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/healthz || exit 1
