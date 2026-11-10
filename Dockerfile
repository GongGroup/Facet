# Facet server image (cloud mode by default).
#   docker run -p 8765:8765 -v facet-data:/data ghcr.io/mastreina/facet
# Local mode with a folder of this machine (runs as you, published on this machine only):
#   mkdir -p facet-data
#   docker run -p 127.0.0.1:8765:8765 --user "$(id -u):$(id -g)" -v "$PWD/facet-data:/data" \
#     -e FACET_MODE=local -e FACET_TOKEN=<long random string> ghcr.io/mastreina/facet
# Build it yourself:
#   docker build -t facet .
FROM python:3.13-slim

LABEL org.opencontainers.image.title="Facet" \
      org.opencontainers.image.description="See, build and export atoms, clusters and crystals in the browser" \
      org.opencontainers.image.licenses="MIT"

# The image's defaults use the oldest names (ATOMSCOPE_*) on purpose: they rank below FACET_* and CRYSTALLUME_*,
# so `-e FACET_MODE=local`, an existing `-e CRYSTALLUME_MODE=local` and an existing `-e ATOMSCOPE_MODE=local`
# (or compose entry) all override them.
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
COPY facet ./facet
COPY crystallume ./crystallume
COPY atomscope ./atomscope
RUN pip install . \
 && useradd --create-home --uid 1000 facet \
 && mkdir -p /data /plugins \
 && chown -R facet:facet /data /plugins

USER facet
VOLUME ["/data"]
EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/v1/health' % (os.environ.get('FACET_PORT') or os.environ.get('CRYSTALLUME_PORT') or os.environ.get('ATOMSCOPE_PORT') or '8765'), timeout=4)" || exit 1

CMD ["facet", "serve"]
