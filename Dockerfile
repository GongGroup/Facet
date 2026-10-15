# AtomScope server image (cloud mode by default).
#   docker build -t atomscope .
#   docker run -p 8765:8765 -v atomscope-data:/data atomscope
# Local mode with a folder of this machine (runs as you, published on this machine only):
#   mkdir -p atomscope-data
#   docker run -p 127.0.0.1:8765:8765 --user "$(id -u):$(id -g)" -v "$PWD/atomscope-data:/data" \
#     -e ATOMSCOPE_MODE=local -e ATOMSCOPE_TOKEN=<long random string> atomscope
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    ATOMSCOPE_HOST=0.0.0.0 \
    ATOMSCOPE_PORT=8765 \
    ATOMSCOPE_MODE=cloud \
    ATOMSCOPE_DATA_DIR=/data \
    ATOMSCOPE_PLUGIN_DIRS=/plugins

WORKDIR /app
COPY pyproject.toml README.md ./
COPY atomscope ./atomscope
RUN pip install . \
 && useradd --create-home --uid 1000 atomscope \
 && mkdir -p /data /plugins \
 && chown -R atomscope:atomscope /data /plugins

USER atomscope
VOLUME ["/data"]
EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/v1/health' % os.environ.get('ATOMSCOPE_PORT', '8765'), timeout=4)" || exit 1

CMD ["atomscope", "serve"]
