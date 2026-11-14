# The YouTube app as a pivi app image. Build it from the repository root
# with `bun run app:build apps/youtube <tag>`, which also attaches the
# manifest as the dev.pivi.manifest label (see scripts/apps.ts).
#
# Stage 1 bundles the app and the protocol SDK it imports into one file, so
# nothing has to be installed where it runs. Only packages/sdk and this directory
# go into the build: the app can't reach host code even by accident, since it
# isn't there. The layout mirrors the repo so the app's `file:../../packages/sdk`
# dependency resolves the same way in both, and the app is installed from its
# own lockfile.
# The bundle is plain JS, so this stage runs natively even when CI builds the
# arm64 image, instead of running bun under emulation.
FROM --platform=$BUILDPLATFORM oven/bun:1 AS build
WORKDIR /build
COPY packages/sdk ./packages/sdk
COPY apps/youtube ./apps/youtube
RUN cd apps/youtube && bun install --frozen-lockfile --production
# pivi-source reads @pivi/sdk's TypeScript, so the SDK needn't be built first.
RUN bun build ./apps/youtube/main.ts --target=bun --conditions pivi-source --outfile=/out/main.js

# Stage 2 is the runtime: bun, the bundle, and the yt-dlp the app shells out
# to. yt-dlp is baked in because at runtime the sandbox only lets the app
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
