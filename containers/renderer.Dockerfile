FROM node:24.15.0-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/renderer/package.json apps/renderer/package.json
COPY packages/codec/package.json packages/codec/package.json
RUN npm ci
COPY apps/renderer/src/ ./
RUN ./node_modules/.bin/esbuild main.ts --bundle --platform=node --format=esm --outfile=renderer.mjs
FROM docker:29.2.1-cli AS dockercli
FROM node:24.15.0-bookworm-slim
ARG TARGETARCH
ARG PANDOC_VERSION=3.10
ARG TYPST_VERSION=0.15.1
# Debian snapshot locks the font packages together with the base image.
RUN rm /etc/apt/sources.list.d/debian.sources && printf 'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20260901T000000Z/ bookworm main\ndeb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20260901T000000Z/ bookworm-security main\n' > /etc/apt/sources.list
# Fonts: Noto CJK, DejaVu, Latin Modern (OpenType), Un and Baekmuk (Hangul),
# Pretendard below.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl python3 python3-yaml fontconfig fonts-noto-cjk fonts-dejavu-core fonts-lmodern fonts-unfonts-core fonts-baekmuk && rm -rf /var/lib/apt/lists/*
# Pandoc and Typst release binaries.
RUN case "$TARGETARCH" in \
      amd64) pandoc=e0f8af62d0f267d22baa5bcefe6d5dda3a097ccc60de794b759fe03159923244 typst=a6d077d0a95eed5a2eba715b2dae06be954f624ccbf85758a03f389ded33118c triple=x86_64 ;; \
      arm64) pandoc=55413dfb0c1aec861641fe858f1f73e84848f3db497b1c0c02e62887ea76f4a4 typst=5aa8d74a3d906e60ea12a66ac2f37f8eef1b14cbad7182a745e393a10c23dcee triple=aarch64 ;; \
      *) exit 1 ;; esac && \
    curl -fsSL -o /tmp/pandoc.tar.gz https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}/pandoc-${PANDOC_VERSION}-linux-${TARGETARCH}.tar.gz && \
    echo "$pandoc  /tmp/pandoc.tar.gz" | sha256sum -c - && \
    tar -xzf /tmp/pandoc.tar.gz -C /tmp && install -m 0755 /tmp/pandoc-${PANDOC_VERSION}/bin/pandoc /usr/local/bin/pandoc && \
    curl -fsSL -o /tmp/typst.tar.xz https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-${triple}-unknown-linux-musl.tar.xz && \
    echo "$typst  /tmp/typst.tar.xz" | sha256sum -c - && \
    python3 -c "import tarfile; tarfile.open('/tmp/typst.tar.xz').extract('typst-${triple}-unknown-linux-musl/typst', '/tmp')" && \
    install -m 0755 /tmp/typst-${triple}-unknown-linux-musl/typst /usr/local/bin/typst && \
    rm -rf /tmp/pandoc* /tmp/typst* && pandoc --version | head -1 && typst --version
# Pretendard (SIL OFL 1.1), the same static TTFs projects such as the Formula
# Student Korea rules are typeset with.
ARG PRETENDARD_VERSION=1.3.9
RUN curl -fsSL -o /tmp/pretendard.zip https://github.com/orioncactus/pretendard/releases/download/v${PRETENDARD_VERSION}/Pretendard-${PRETENDARD_VERSION}.zip && \
    echo "04be351a74d6bf7d60c480a3087e51d185485d35a52023142af1df19eb8c428a  /tmp/pretendard.zip" | sha256sum -c - && \
    mkdir -p /usr/share/fonts/truetype/pretendard /usr/share/doc/fonts-pretendard && \
    python3 -c "import zipfile; z = zipfile.ZipFile('/tmp/pretendard.zip'); \
[open(d + n.split('/')[-1], 'wb').write(z.read(n)) for d, n in [ \
('/usr/share/fonts/truetype/pretendard/', 'public/static/alternative/Pretendard-Regular.ttf'), \
('/usr/share/fonts/truetype/pretendard/', 'public/static/alternative/Pretendard-Bold.ttf'), \
('/usr/share/doc/fonts-pretendard/', 'LICENSE.txt')]]" && \
    rm /tmp/pretendard.zip
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=build /app/renderer.mjs /opt/qollab/renderer.mjs
COPY containers/render.py /opt/qollab/render.py
COPY containers/typst/ /opt/qollab/typst/
RUN mkdir -p /work && chown 10001:10001 /work && chmod -R a+rX /opt/qollab/typst && fc-cache -f && \
    (dpkg-query -W && printf 'pandoc\t%s\ntypst\t%s\n' "$PANDOC_VERSION" "$TYPST_VERSION") > /opt/qollab/packages.txt
ENV HOME=/work
WORKDIR /work
CMD ["node","/opt/qollab/renderer.mjs"]

LABEL org.opencontainers.image.source="https://github.com/luftaquila/qollab" org.opencontainers.image.licenses="MIT"
