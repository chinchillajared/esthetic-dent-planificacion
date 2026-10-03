# syntax=docker/dockerfile:1
FROM nginx:1.29-alpine
RUN apk add --no-cache openssl
COPY nginx.conf /etc/nginx/nginx.conf
COPY templates/ /etc/nginx/templates/
COPY --chmod=755 entrypoint/ /docker-entrypoint.d/
EXPOSE 80 443
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
