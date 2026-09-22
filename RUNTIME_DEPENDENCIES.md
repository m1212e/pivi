# Runtime dependencies

Everything outside `node_modules` that pivi needs installed on the host (or
baked into a Docker image) to actually run — not build-time tooling, just
what has to be present when the app is executing. Referenced from
SKETCH.md's "OS/deployment" decision, which calls for exactly this list.

## Required

| Binary       | Why                                                                                                                                                                                                                              | Debian/Ubuntu (`apt`)                                                                           | Fedora (`dnf`)                                                                                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **bun**      | The runtime the app itself runs under, and what the plugin host (`src/api/plugins/runtime.ts`) spawns each plugin's child process with — plugins won't load without it on `PATH`, even if the main server is started via `node`. | `curl -fsSL https://bun.sh/install \| bash` (no apt package)                                    | same — no official Fedora package, use the install script                                                                                                                                     |
| **mpv**      | Video/audio playback (`src/api/plugins/runtime.ts`'s `playMedia`) — a plugin's session request shells out to this directly, per SKETCH.md's "Video player" decision.                                                             | `apt install mpv`                                                                               | needs [RPM Fusion](https://rpmfusion.org/Configuration) first: `dnf install https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm && dnf install mpv` |
| **postgres** | The app's database (`DATABASE_URL`). Not necessarily inside the _app's own_ image — the existing `docker-compose.yaml` runs it as a separate service, which is the pattern to keep for any production compose setup too.         | `apt install postgresql` (or keep it a separate container/service, as in `docker-compose.yaml`) | `dnf install postgresql-server` (or, again, a separate container)                                                                                                                             |

## Auto-installed, no action needed

- **yt-dlp** (`plugins/youtube/stream.ts`) — downloaded automatically on
  first use via `yt-dlp-wrap`'s `downloadFromGithub` into `.cache/yt-dlp`
  (gitignored). For a Docker build, it's worth triggering this download
  during the image build instead of on first request, so a fresh container
  doesn't pay that latency (and works offline): run the app once with
  network access during the build stage, or call
  `YTDlpWrap.downloadFromGithub()` directly in a build script, so
  `.cache/yt-dlp` is already present in the image layer.

## Recommended, not currently required

- **deno** — yt-dlp warns `No supported JavaScript runtime could be found`
  without one, since YouTube's newer anti-bot challenges need real JS
  execution to solve. Extraction still worked in testing without it, but
  yt-dlp itself calls this "deprecated" behavior — installing deno makes
  extraction more reliable and is where yt-dlp's own docs point
  (`--js-runtimes`). Not in a package manager either;
  https://docs.deno.com/runtime/getting_started/installation/ for the
  install script.

## Explicitly not needed

- **Python** — modern `yt-dlp` releases are self-contained binaries (no
  separate Python install required).
- **googleapis / google-auth-library** or any Google Cloud credentials —
  the YouTube plugin uses `youtubei.js` instead (`plugins/youtube/innertube.ts`),
  which needs no registered OAuth client, API key, or secret of any kind.

## Not yet relevant

SKETCH.md's longer-term shell (a Chromium/WebKit kiosk view, libmpv linked
directly rather than shelled out to, V4L2/VAAPI hardware decode drivers,
the Cast receiver's mDNS stack) isn't built yet — nothing to install for
any of that until it exists. This file should grow alongside the actual
code, not get ahead of it.
