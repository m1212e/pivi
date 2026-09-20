# Pivi — Preliminary Sketch

A fully custom Chromecast/Apple-TV-alternative platform built on Raspberry Pi.

## Vision

- Custom on-screen UI/OS shell with Apple-TV-style swipe/focus navigation
- Native plugins (real code, not embedded websites) for each service — Jellyfin,
  Immich, Spotify, Twitch, and YouTube — sharing one navigation system and one
  video player
- A mobile-optimized PWA remote control app, paired via QR code, driving the TV
  over the local network
- An unofficial open-source Google Cast receiver, so any phone can also cast
  directly to it
- Single Pi/TV per install for now; plugins installed by pointing at a repo
  (no hosted store yet)

## Key decisions and why

- **Target hardware**: Raspberry Pi 4 and Pi 5, designed for the lowest common
  denominator between them.
- **No generic browser wrapping.** Apps like YouTube/Twitch/Spotify are built
  for mouse/touch, not swipe/focus navigation. Wrapping their websites in a
  browser can't give consistent Apple-TV-style navigation — every plugin
  instead is native code rendered through a shared UI/navigation layer, the
  same approach real TV platforms (tvOS, Android TV, Kodi) use.
- **Stay Pi + fully custom platform**, rather than pivoting to Android TV
  hardware. Android TV would solve native app support and DRM "for free" but
  would mean giving up the custom gesture navigation and plugin architecture
  entirely — the actual point of this project.
- **YouTube**: support both a yt-dlp/Invidious-style extraction plugin (gets
  ad-free
- **Google Cast**: unofficial open-source DIAL + Cast receiver rather than
  registering for the official Google Cast SDK (CAF) — avoids developer
  registration/fees/terms, fits the self-hosted ethos, works today.
- **Backend runtime**: Node.js/TypeScript throughout — one language across the
  SvelteKit UI, plugin API, and backend services.
- **Remote control app**: mobile-optimized PWA (SvelteKit), not native iOS/
  Android — single codebase, no app store distribution overhead.
- **Remote pairing**: TV shows a QR code containing a pairing token +
  local address; phone scans it and connects directly over the LAN — no
  accounts, no cloud relay.
- **Plugin depth**: full plugin runtime/SDK (real TypeScript packages with a
  defined API), not a lightweight manifest-pointing-at-a-URL model — required
  because navigation/gestures must be consistent across apps.
- **Plugin distribution**: local sideload / git-based install for now (like
  Homebridge or HACS). A real hosted store/registry is a later milestone.
- **Video player**: libmpv embedded in the shell, controlled from the Node
  backend over its JSON IPC socket. Hardware-accelerated decode via
  V4L2/VAAPI. One playback code path shared by every plugin and the Cast
  receiver.
- **Video quality target**: 1080p as the reliable baseline; 4K/HDR is
  best-effort, expected to work better on Pi 5 than Pi 4.
- **Scope**: single Pi/TV per install for v1. Multi-room/multi-Pi sync is
  explicitly deferred, not designed for yet.
- **OS/base image**: deferred. Leaning toward NixOS for declarative, minimal
  config, but Raspberry Pi OS Lite is the fallback if Pi GPU/media driver
  support in Nix proves too immature. The app itself should stay OS-agnostic
  (a systemd unit + a documented runtime dependency list) so this stays a
  packaging decision, not an architecture one.

## Proposed tech stack

### On-device shell & UI
- SvelteKit, compiled to a static SPA, rendered full-screen in a minimal
  Chromium/WebKit kiosk view (a rendering host for the custom UI, not a
  general browser for third-party sites)
- Custom focus/spatial-navigation layer mapping remote swipe gestures to
  directional focus movement (build this early — every plugin depends on it)
- Plugins expose UI via the shared Svelte component library + navigation
  manager, not iframes

### Plugin runtime
- Node.js/TypeScript host process, loading plugins as local packages
  (git-clone/npm-link style install, versioned via package.json)
- Plugin API surface: navigation/focus events, HTTP client, credential/token
  storage, and a playback handoff API (`player.play(url, {headers, drm?})`)
- Reference plugins to build first:
  - **Jellyfin** — official REST API, well documented
  - **Spotify** — Web API + Spotify Connect for playback control (no audio
    streaming logic needed on our side)
  - **Immich** — REST API, mostly for browsing/casting photos
  - **Twitch** — Helix API + HLS stream URLs
  - **YouTube** — dual plugin: Invidious/yt-dlp extraction (ad-free) + Cast-from-phone fallback

### Playback engine
- libmpv, embedded and controlled from the Node backend over its JSON IPC
  socket, rendering to its own layer under/behind the kiosk UI
- Hardware-accelerated decode via V4L2/VAAPI
- Also the target for the Cast receiver's stream handoff — one playback path
  for every source

### Remote control app
- SvelteKit PWA, mobile-first
- Pairing: QR code on the TV (pairing token + local address) scanned by the
  phone, opens a direct WebSocket connection — no cloud relay, no login
- Transport: WebSocket for low-latency directional/gesture events

### Cast receiver
- Unofficial DIAL + Cast v2 protocol implementation (Node service), advertised
  via mDNS
- Hands off to the same libmpv playback path

### Backend/system services (all Node/TS)
- One long-running daemon (systemd service) hosting: plugin runtime,
  WebSocket remote server, Cast receiver, mpv IPC bridge
- Local SQLite for plugin config, pairing tokens, watch state/resume positions
- mDNS (Bonjour) advertisement for discovery

### OS/deployment
- Deferred. Scaffold the app OS-agnostically (systemd unit + documented
  runtime dependencies) so Raspberry Pi OS Lite vs NixOS stays a packaging
  decision. If NixOS: check `nixos-raspberrypi`/`nixos-hardware` Pi 4/5 board
  and GPU/media driver support before committing.

## Suggested build order

1. libmpv playback service + minimal SvelteKit shell with hardcoded focus
   navigation (prove the core feel before anything else)
2. Jellyfin plugin (best-documented API, immediately useful)
3. PWA remote + QR pairing + WebSocket gesture protocol
4. Spotify Connect plugin, then Immich
5. Cast receiver
6. Twitch, then YouTube (both plugin variants)

## Open questions for later

- Multi-room/multi-Pi sync architecture, if pursued
- Whether/how to build a real hosted plugin store and registry
- Native remote app (iOS/Android) vs staying PWA long-term
- Final OS base image decision (NixOS vs Raspberry Pi OS Lite)
