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
FROM gcc:12-bookworm AS native
COPY containers/warm-input.c /tmp/warm-input.c
RUN gcc -shared -fPIC -O2 -Wall -Wextra -Werror -o /tmp/warm-input.so /tmp/warm-input.c -ldl
FROM node:24.15.0-bookworm-slim
ARG TARGETARCH
ARG QUARTO_VERSION=1.10.19
# Debian snapshot locks TeX Live and font packages together with the base image.
RUN rm /etc/apt/sources.list.d/debian.sources && printf 'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20260901T000000Z/ bookworm main\ndeb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20260901T000000Z/ bookworm-security main\n' > /etc/apt/sources.list
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl python3 fontconfig texlive-xetex texlive-luatex texlive-latex-extra texlive-fonts-recommended texlive-lang-korean fonts-noto-cjk fonts-dejavu-core lmodern && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL -o /tmp/quarto.deb https://github.com/quarto-dev/quarto-cli/releases/download/v${QUARTO_VERSION}/quarto-${QUARTO_VERSION}-linux-${TARGETARCH}.deb && \
    case "$TARGETARCH" in amd64) checksum=7f0c4769e7f0e55f50d922f44b18db5118fb388d2b8fd27291fe1f8beafb43eb ;; arm64) checksum=35bb613052da98bef92ec3b7de77c3405a8e546363c7d2aa3abe15a39efa5045 ;; *) exit 1 ;; esac && \
    echo "$checksum  /tmp/quarto.deb" | sha256sum -c - && dpkg -i /tmp/quarto.deb && rm /tmp/quarto.deb
# Single TeX files taken from pinned Debian packages instead of whole bundles:
# - ctexhook.sty: xeCJK (CJKmainfont, a Hangul font beside a Latin body font).
# - soul.sty, ulem.sty: underlines ([text]{.underline}), also with xeCJK.
# xeCJK.cfg makes xeCJK follow Korean spacing instead of Chinese rules.
# soul.cfg underlines and strikes out with ulem, which keeps Hangul under XeTeX.
COPY containers/xeCJK.cfg /usr/local/share/texmf/tex/xelatex/xecjk/xeCJK.cfg
COPY containers/soul.cfg /usr/local/share/texmf/tex/generic/soul/soul.cfg
RUN cd /tmp && apt-get update && apt-get download texlive-lang-chinese texlive-plain-generic && \
    dpkg-deb --fsys-tarfile texlive-lang-chinese_*.deb | tar -x ./usr/share/texlive/texmf-dist/tex/latex/ctex/ctexhook.sty && \
    dpkg-deb --fsys-tarfile texlive-plain-generic_*.deb | tar -x ./usr/share/texlive/texmf-dist/tex/generic/soul/soul.sty ./usr/share/texlive/texmf-dist/tex/generic/ulem/ulem.sty && \
    for f in latex/ctex/ctexhook.sty generic/soul/soul.sty generic/ulem/ulem.sty; do \
      install -D -m 0644 usr/share/texlive/texmf-dist/tex/$f /usr/local/share/texmf/tex/$f; done && \
    mktexlsr /usr/local/share/texmf && rm -rf /tmp/*.deb /tmp/usr /var/lib/apt/lists/*
# Pretendard (SIL OFL 1.1), the same static TTFs LaTeX projects such as the
# Formula Student Korea rules build with.
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
COPY containers/render_cache.py /opt/qollab/render_cache.py
COPY containers/render_fast.py /opt/qollab/render_fast.py
COPY --from=native /tmp/warm-input.so /opt/qollab/warm-input.so
COPY containers/xelatex.py /opt/qollab/bin/xelatex
COPY containers/xelatex.py /opt/qollab/bin/lualatex
COPY containers/warm-luatex.py /tmp/warm-luatex.py
COPY containers/warm-quarto.py /tmp/warm-quarto.py
COPY containers/capture-pandoc.py /tmp/capture-pandoc.py
COPY tests/fixtures/figure.png /tmp/warmup.png
RUN mkdir -p /work && chown 10001:10001 /work && chmod 0555 /opt/qollab/bin/xelatex /opt/qollab/bin/lualatex /tmp/capture-pandoc.py && fc-cache -f && python3 /tmp/warm-quarto.py && python3 /tmp/warm-luatex.py && rm /tmp/warm-quarto.py /tmp/warm-luatex.py /tmp/capture-pandoc.py /tmp/warmup.png && dpkg-query -W > /opt/qollab/packages.txt
ENV HOME=/work
WORKDIR /work
CMD ["node","/opt/qollab/renderer.mjs"]

LABEL org.opencontainers.image.source="https://github.com/luftaquila/qollab" org.opencontainers.image.licenses="MIT"
