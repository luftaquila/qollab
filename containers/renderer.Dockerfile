FROM node:24.15.0-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/renderer/package.json apps/renderer/package.json
COPY packages/codec/package.json packages/codec/package.json
RUN npm ci
COPY apps/renderer/src/main.ts ./main.ts
RUN ./node_modules/.bin/esbuild main.ts --bundle --platform=node --format=esm --outfile=renderer.mjs
FROM docker:29.2.1-cli AS dockercli
FROM node:24.15.0-bookworm-slim
ARG TARGETARCH
ARG QUARTO_VERSION=1.10.19
# Debian snapshot locks TeX Live and font packages together with the base image.
RUN rm /etc/apt/sources.list.d/debian.sources && printf 'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20260901T000000Z/ bookworm main\ndeb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20260901T000000Z/ bookworm-security main\n' > /etc/apt/sources.list
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl python3 texlive-xetex texlive-latex-extra texlive-fonts-recommended texlive-lang-korean fonts-noto-cjk fonts-dejavu-core lmodern && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL -o /tmp/quarto.deb https://github.com/quarto-dev/quarto-cli/releases/download/v${QUARTO_VERSION}/quarto-${QUARTO_VERSION}-linux-${TARGETARCH}.deb && \
    case "$TARGETARCH" in amd64) checksum=7f0c4769e7f0e55f50d922f44b18db5118fb388d2b8fd27291fe1f8beafb43eb ;; arm64) checksum=35bb613052da98bef92ec3b7de77c3405a8e546363c7d2aa3abe15a39efa5045 ;; *) exit 1 ;; esac && \
    echo "$checksum  /tmp/quarto.deb" | sha256sum -c - && dpkg -i /tmp/quarto.deb && rm /tmp/quarto.deb
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=build /app/renderer.mjs /opt/qollab/renderer.mjs
COPY containers/render.py /opt/qollab/render.py
RUN mkdir -p /work && chown 10001:10001 /work && fc-cache -f && dpkg-query -W > /opt/qollab/packages.txt
ENV HOME=/work
WORKDIR /work
CMD ["node","/opt/qollab/renderer.mjs"]

LABEL org.opencontainers.image.source="https://github.com/luftaquila/qollab" org.opencontainers.image.licenses="MIT"
