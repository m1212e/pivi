# The base image the YouTube app is published on: Node, like every pivi app,
# plus the yt-dlp it shells out to. Only this needs Docker; the app itself is
# bundled and added on top by `pivi-app publish` (base set in ../package.json).
# Rebuilt only when yt-dlp is bumped: the tag is the yt-dlp version, see
# .github/workflows/apps.yml.
#
# yt-dlp is installed from PyPI rather than taken from the standalone release
# binary, and deliberately without its `default` extra: that extra brings
# certifi, and yt-dlp (like the standalone build, which bundles it) then trusts
# only certifi's own CA list. In the sandbox, HTTPS goes through an inspecting
# proxy whose CA is in the *system* trust store, so yt-dlp has to use that store,
# which it does when certifi is absent. yt-dlp-ejs is the YouTube challenge
# solver, which runs on the image's node (stream.ts passes --js-runtimes node).
FROM node:26-alpine
ARG YTDLP_VERSION=2026.10.26
# Links the image on ghcr.io to the repository, so it shares its visibility.
LABEL org.opencontainers.image.source=https://github.com/m1212e/pivi
RUN apk add --no-cache python3 \
	&& python3 -m venv /opt/yt-dlp \
	&& /opt/yt-dlp/bin/pip install --no-cache-dir "yt-dlp==${YTDLP_VERSION}" yt-dlp-ejs \
	&& /opt/yt-dlp/bin/yt-dlp --version
ENV PIVI_YTDLP_BINARY=/opt/yt-dlp/bin/yt-dlp
