# Crystallume server image (cloud mode by default).
#   docker build -t crystallume .
#   docker run -p 8765:8765 -v crystallume-data:/data crystallume
# Local mode with a folder of this machine (runs as you, published on this machine only):
#   mkdir -p crystallume-data
#   docker run -p 127.0.0.1:8765:8765 --user "$(id -u):$(id -g)" -v "$PWD/crystallume-data:/data" \
#     -e CRYSTALLUME_MODE=local -e CRYSTALLUME_TOKEN=<long random string> crystallume
FROM python:3.13-slim

# The image's defaults use the former ATOMSCOPE_* names on purpose: they rank below CRYSTALLUME_*, so both
# `-e CRYSTALLUME_MODE=local` and an existing `-e ATOMSCOPE_MODE=local` (or compose entry) override them.
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
COPY crystallume ./crystallume
COPY atomscope ./atomscope
RUN pip install . \
 && useradd --create-home --uid 1000 crystallume \
 && mkdir -p /data /plugins \
 && chown -R crystallume:crystallume /data /plugins

USER crystallume
VOLUME ["/data"]
EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/v1/health' % (os.environ.get('CRYSTALLUME_PORT') or os.environ.get('ATOMSCOPE_PORT') or '8765'), timeout=4)" || exit 1

CMD ["crystallume", "serve"]
