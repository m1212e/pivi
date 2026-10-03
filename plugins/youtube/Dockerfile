# The YouTube plugin as a pivi plugin image. Build it from the repository root
# with `bun run plugin:build plugins/youtube <tag>`, which also attaches the
# manifest as the dev.pivi.manifest label (see scripts/build-plugin-image.ts).
#
# Stage 1 bundles the plugin and everything it imports — including the shared
# protocol code in src/lib — into one file, so nothing has to be installed where
# it runs. plugins/youtube/package.json becomes the build's package.json: it
# carries both the dependencies and the `#lib/*` import mapping.
FROM oven/bun:1 AS build
WORKDIR /build
COPY plugins/youtube/package.json ./package.json
RUN bun install
COPY src/lib ./src/lib
COPY plugins/youtube ./plugin
# The copy of package.json inside ./plugin would become the nearest one for the
# plugin's own files, and its `#lib/*` mapping is relative to the wrong directory.
RUN rm ./plugin/package.json && bun build ./plugin/main.ts --target=bun --outfile=/out/main.js

# Stage 2 is the runtime: bun, the bundle, and the yt-dlp the plugin shells out
# to. yt-dlp is baked in because at runtime the sandbox only lets the plugin
# reach the domains its manifest lists.
#
# It's installed from PyPI rather than taken from the standalone release binary,
# and deliberately without its `default` extra: that extra brings certifi, and
# yt-dlp (like the standalone build, which bundles it) then trusts only certifi's
# own CA list. In the sandbox, HTTPS goes through an inspecting proxy whose CA is
# installed in the *system* trust store, so yt-dlp has to use that store, which
# it does when certifi is absent. yt-dlp-ejs is the YouTube challenge solver.
FROM oven/bun:1
ARG YTDLP_VERSION=2026.08.19
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
	&& python3 -m venv /opt/yt-dlp \
	&& /opt/yt-dlp/bin/pip install --no-cache-dir "yt-dlp==${YTDLP_VERSION}" yt-dlp-ejs \
	&& rm -rf /var/lib/apt/lists/*
ENV PIVI_YTDLP_BINARY=/opt/yt-dlp/bin/yt-dlp
WORKDIR /app
COPY --from=build /out/main.js ./main.js
ENTRYPOINT ["bun", "run", "/app/main.js"]
