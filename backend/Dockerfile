# syntax=docker/dockerfile:1

# ---- Dependencias ----
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt

# ---- Pruebas: la imagen solo se construye si pasan ----
FROM base AS test
COPY requirements-dev.txt ./
RUN pip install -r requirements-dev.txt
COPY . .
RUN python -m pytest

# ---- Runtime: usuario sin privilegios ----
FROM base AS runtime
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --home-dir /app --shell /usr/sbin/nologin app \
 && mkdir -p /data/uploads && chown -R app:app /data
COPY --from=test /app/app ./app
COPY --from=test /app/alembic ./alembic
COPY --from=test /app/alembic.ini ./alembic.ini
COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*", "--no-server-header"]
