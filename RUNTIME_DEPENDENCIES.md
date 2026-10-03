# Runtime dependencies

Everything outside `node_modules` that pivi needs installed on the host (or
baked into a Docker image) to actually run — not build-time tooling, just
what has to be present when the app is executing. Referenced from
SKETCH.md's "OS/deployment" decision, which calls for exactly this list.

## Required

| Binary       | Why                                                                                                                                                                                                                      | Debian/Ubuntu (`apt`)                                                                           | Fedora (`dnf`)                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **bun**      | The runtime the app runs under in development, and what `pivi-db-push` runs under. (The packaged server runs under node; plugins are no longer spawned as bun processes — see below.)                                    | `curl -fsSL https://bun.sh/install \| bash` (no apt package)                                    | same — no official Fedora package, use the install script         |
| **postgres** | The app's database (`DATABASE_URL`). Not necessarily inside the _app's own_ image — the existing `docker-compose.yaml` runs it as a separate service, which is the pattern to keep for any production compose setup too. | `apt install postgresql` (or keep it a separate container/service, as in `docker-compose.yaml`) | `dnf install postgresql-server` (or, again, a separate container) |

## Required for wifi provisioning

| Binary/service               | Why                                                                                                                                                                                                                                                      | Debian/Ubuntu (`apt`)         | Fedora (`dnf`)         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------------------- |
| **NetworkManager** (`nmcli`) | Scanning, joining, and serving the setup access point (`src/api/wifi.ts`). Only needed for the phone-driven wifi setup — a wired device, or one whose network is configured declaratively, works without it and simply reports provisioning unavailable. | `apt install network-manager` | preinstalled on Fedora |

The binary is located via `PIVI_NMCLI` when set (the Nix module pins it), else
found on `PATH`. A device with no wireless interface at all reports
provisioning as unavailable rather than offering a setup screen nothing could
satisfy.

## Required for plugins

| Requirement                  | Why                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **KVM** (`/dev/kvm`)         | Every plugin runs in a microVM (`src/api/plugins/sandbox/`, the `microsandbox` npm package, whose native runtime ships inside it for x86_64 and arm64 glibc Linux). The service user needs read/write access to `/dev/kvm` (the NixOS module adds `pivi` to the `kvm` group). Without KVM everything else works; plugins just can't start. |
| A short `PIVI_SANDBOX_HOME`  | Where the sandbox keeps images, volumes and sockets. Must be short (unix socket path limit) — the NixOS module sets it to `<stateDir>/sandbox`.                                                                                                                                                                                            |
| Network access to a registry | Only when installing or updating a plugin (Docker Hub, GHCR, or whichever registry the image reference names).                                                                                                                                                                                                                             |

Plugins are OCI images; **anything a plugin needs (yt-dlp for the YouTube
plugin, its JS runtime, certificates) is inside its image**, not installed on
the host. See `docs/plugins.md`.

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

- **Python, yt-dlp, deno** — nothing on the host; the YouTube plugin image
  carries its own yt-dlp and runs it under bun.
- **googleapis / google-auth-library** or any Google Cloud credentials —
  the YouTube plugin uses `youtubei.js` instead (`plugins/youtube/innertube.ts`),
  which needs no registered OAuth client, API key, or secret of any kind.

## Not yet relevant

The Cast receiver's mDNS stack isn't built yet — nothing to install for it
until it exists. This file should grow alongside the actual code, not get
ahead of it.

## Moved, no longer needed

- **mpv** — playback now happens in the page (MSE/Shaka Player, see
  `src/lib/mse/dualTrackPlayer.ts` and `src/routes/play/`), and no code under
  `src/` or `plugins/` references mpv any more. What needs hardware video
  decode is the kiosk browser instead, which is why `nix/module.nix` passes
  Chromium the VA-API flags and puts the kiosk user in `video`/`render`. See
  DEPLOYMENT.md.
