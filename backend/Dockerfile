FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# INSTALL_DEV=1 adds pytest/debugpy for local dev/test images; production omits it.
ARG INSTALL_DEV=0
COPY requirements.txt requirements-dev.txt ./
RUN pip install -r requirements.txt \
    && if [ "$INSTALL_DEV" = "1" ]; then pip install -r requirements-dev.txt; fi

COPY . .

RUN useradd --create-home --uid 1000 app && chown -R app:app /app
USER app

EXPOSE 8001
# /api/health also pings MongoDB.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/api/health', timeout=4)"

# Production: 2 workers fit the 1 GB server. Only Caddy can reach the
# container, so trusting its X-Forwarded-* headers is safe.
# (Local dev and tests override this command in docker-compose.yml.)
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001", \
     "--workers", "2", "--proxy-headers", "--forwarded-allow-ips", "*"]
