# The Twitch app as a pivi app image. Build it from the repository root
# with `bun run app:build apps/twitch <tag>`, which also attaches the
# manifest as the dev.pivi.manifest label (see scripts/apps.ts).
#
# Same layout as apps/youtube/Dockerfile: stage 1 bundles the app and the
# protocol SDK into one file, natively even for the arm64 image. Unlike
# YouTube there is no extractor to ship, the app talks to Twitch with plain
# fetch, so the runtime is just bun and the bundle.
FROM --platform=$BUILDPLATFORM oven/bun:1 AS build
WORKDIR /build
COPY packages/sdk ./packages/sdk
COPY apps/twitch ./apps/twitch
RUN cd apps/twitch && bun install --frozen-lockfile --production
# pivi-source reads @pivi/sdk's TypeScript, so the SDK needn't be built first.
RUN bun build ./apps/twitch/main.ts --target=bun --conditions pivi-source --outfile=/out/main.js

FROM oven/bun:1
WORKDIR /app
COPY --from=build /out/main.js ./main.js
ENTRYPOINT ["bun", "run", "/app/main.js"]
