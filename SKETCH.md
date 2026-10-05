# Pivi — Preliminary Sketch

A fully custom Chromecast/Apple-TV-alternative platform built on Raspberry Pi.

## Vision

- Custom on-screen UI/OS shell with Apple-TV-style swipe/focus navigation
- Native apps (real code, not embedded websites) for each service — Jellyfin,
  Immich, Spotify, Twitch, and YouTube — sharing one navigation system and one
  video player
- A mobile-optimized PWA remote control app, paired via QR code, driving the TV
  over the local network
- An unofficial open-source Google Cast receiver, so any phone can also cast
  directly to it
- Single Pi/TV per install for now; apps installed by pointing at a repo
  (no hosted store yet)

## Key decisions and why

- **Target hardware**: Raspberry Pi 4 and Pi 5, designed for the lowest common
  denominator between them.
- **No generic browser wrapping.** Apps like YouTube/Twitch/Spotify are built
  for mouse/touch, not swipe/focus navigation. Wrapping their websites in a
  browser can't give consistent Apple-TV-style navigation — every app
  instead is native code rendered through a shared UI/navigation layer, the
  same approach real TV platforms (tvOS, Android TV, Kodi) use.
- **Stay Pi + fully custom platform**, rather than pivoting to Android TV
  hardware. Android TV would solve native app support and DRM "for free" but
  would mean giving up the custom gesture navigation and app architecture
  entirely — the actual point of this project.
- **YouTube**: support a yt-dlp-style extraction app (gets
  ad-free
- **Google Cast**: unofficial open-source DIAL + Cast receiver rather than
  registering for the official Google Cast SDK (CAF) — avoids developer
  registration/fees/terms, fits the self-hosted ethos, works today.
- **Backend runtime**: Node.js/TypeScript throughout — one language across the
  SvelteKit UI, app API, and backend services.
- **Remote control app**: mobile-optimized PWA (SvelteKit), not native iOS/
  Android — single codebase, no app store distribution overhead.
- **Remote pairing**: TV shows a QR code containing a pairing token +
  local address; phone scans it and connects directly over the LAN — no
  accounts, no cloud relay.
- **App depth**: full app runtime/SDK (real TypeScript packages with a
  defined API), not a lightweight manifest-pointing-at-a-URL model — required
  because navigation/gestures must be consistent across apps.
- **App distribution — an OCI image per app.** An app is an image
  reference written like a docker-compose `image:` (bare/`owner/name` is
  Docker Hub, anything else names its registry: `ghcr.io/owner/name:1.2`).
  The host never builds anything. The manifest ships as an image label
  (`dev.pivi.manifest`), readable from the registry before any layer is
  pulled, so the install screen shows what's being asked for first. Images
  must be signed (cosign); the signer's identity is pinned at install and an
  update signed by anyone else isn't applied. Updates re-resolve the tag to
  a digest; one that adds a permission or a domain waits for the user's
  approval, anything else is applied (and rolled back by re-pinning the
  previous digest if it fails to start). Authors publish multi-arch images
  (arm64 for the Pi). A hosted store is still a later milestone.
- **App UI composition — three tiers, shell always renders.** Apps
  never hand the shell raw markup or CSS. Tier 1: typed dashboard data (home
  cards, continue-watching items) rendered by the shell's existing
  component set. Tier 2: a declarative UI tree (list/form/button/toggle/
  text-input primitives) for full custom screens — settings, browsing —
  still rendered and focus-managed by the shell, the same idea as Slack's
  Block Kit or Android Auto/CarPlay's app templates. Tier 3: a sandboxed
  webview, reserved for services with no API and no workable Tier 2
  mapping — visually second-class, isolated by the iframe boundary, still
  reports back through the same typed contract for anything it needs on
  the shared dashboard.
- **App theming — design tokens, not raw CSS.** An app sets a small
  fixed set of CSS custom properties (accent color, logo, corner radius),
  scoped inside a per-app Shadow DOM boundary. That gives brand identity
  without an app's styling being able to escape its own subtree, override
  focus-visible styling, or exfiltrate data via `url()`. Free-form CSS
  stays out of scope until a concrete app needs it, and would need
  sanitization, not blind trust, even then.
- **App sandboxing — untrusted OCI image, stdio protocol, user-granted
  permissions.** Apps can be written in any language: the contract is
  JSON-RPC 2.0 over the container entrypoint's stdin/stdout, one JSON
  message per line (stderr is logs), with schemas published as JSON Schema.
  No ports and no path back to the host are exposed to the app. The
  manifest requests `permissions` from a fixed enum the user toggles —
  `network` (all of the manifest's declared domains together, nothing else:
  not other domains, the LAN, localhost or the host), `storage` (persistent
  `/storage`, per app and profile, not encrypted) and `cache` (disposable
  `/cache`, host may wipe it) — plus `features` saying what it implements
  (dashboard, screen, playback, skipSegments), so the host only calls
  what was declared. The host never fetches a URL an app returns unless
  its host is within that app's declared domains and resolves to a public
  address. Backend: microsandbox (KVM microVMs; libkrun), behind a small
  `SandboxBackend` interface. Findings that shaped it: domain rules need TLS
  interception (the Host header is only inspected then — without it a
  CDN-fronted request to another site passes through an allowed IP), and
  runtimes that carry their own CA list (certifi, PyInstaller builds) must be
  made to use the system store; the guest's own DNS is filtered, so raw IPs and
  unlisted names don't resolve or connect; `/cache` is a disk-backed volume, not
  tmpfs (RAM); stdin writes are capped at 4 MiB per frame so the host chunks
  them; a killed VM's stream ends with no `exited` event. Verified on x86_64
  (including a real signed image end to end); Pi 4/5 KVM and the NixOS package
  are unverified. Signatures are cosign key-based only — keyless isn't verified.
  Full reference: `docs/apps.md`. This model also gives crash isolation for free.
- **Exclusive/passthrough sessions — a fourth capability, not a UI tier.**
  Some apps need direct hardware access instead of shell-mediated
  rendering/input: game streaming (Moonlight/Sunshine) and playback itself.
  These get their own display plane (the same pattern as libmpv "rendering
  to its own layer under/behind the kiosk UI") and, for game streaming,
  direct passthrough of a gamepad's input device node to the app
  process, bypassing the focus/nav layer entirely for the session's
  duration. Granted only while a session declaring that need is active,
  reclaimed by the shell the moment it ends.
- **Login — the app's own problem, not a host feature.** There's no
  dedicated sign-in protocol: an app that needs one builds the prompt (a
  code, a link) out of its own Tier 2 screen content, and the one thing the
  host actually offers is generic — a button action that pushes a URL to the
  paired phone (`openOnPhone`, see dashboard.ts), reusing the same relay
  already built for remote pairing. A dedicated `auth` feature/protocol
  (device-code and phone-handoff schemas, an `/oauth/callback` route) was
  tried first and removed: it bought nothing a plain screen + one generic
  button couldn't already do, for a lot more host-side surface area to keep
  matching whatever a given provider's flow actually looks like.
- **Reuse strategy for apps.** Reuse existing implementations at the
  API/logic layer — official or community SDKs (Jellyfin, Spotify Web API,
  Immich's OpenAPI client, Twitch Helix) — and via subprocess for headless
  native tools (yt-dlp, moonlight-embedded) rather than reimplementing
  protocols. Android app virtualization (Waydroid/Anbox) is ruled out: too
  heavy for Pi 4/5, no Widevine L1 for DRM content anyway, and it would
  throw away the shared navigation model that's the actual point of this
  project.
- **Video player**: in-page playback via Media Source Extensions / Shaka
  Player (`src/lib/mse/dualTrackPlayer.ts`), replacing the original plan of an
  embedded libmpv driven over its JSON IPC socket — one playback code path
  shared by every app and the Cast receiver either way, but it lives in the
  shell's own renderer rather than a separate process, which is why the kiosk
  browser is what needs hardware-accelerated decode (V4L2/VAAPI).
- **Video quality target**: 1080p as the reliable baseline; 4K/HDR is
  best-effort, expected to work better on Pi 5 than Pi 4.
- **Wifi provisioning — the phone is the keyboard.** With no known network,
  the device serves its own WPA2 access point (NetworkManager shared mode); the
  TV shows a `WIFI:` QR to join it plus the usual pairing QR, and the paired
  phone's remote gains a scan/pick/password screen. Built into the app rather
  than adopting comitup or balena wifi-connect: neither is packaged for nixpkgs,
  and both would add a second web server with its own captive-portal UI
  duplicating the phone remote this project already has. Wi-Fi Easy Connect
  (DPP) is a better long-term fit for a device that has a screen — the TV could
  simply display a DPP QR — but it is Android-10+-only with no iOS support, so
  it can only ever be an additional fast path, not the mechanism. The Pi's
  single radio can't reliably be an AP and a station at once (`brcmfmac`), so
  provisioning is sequential: AP down, join, AP back up on failure.
- **Network exposure**: two HTTP listeners over one SvelteKit app — the TV
  shell on loopback for the local kiosk browser only, and a LAN listener that
  serves nothing but the phone remote's own paths (`deploy/pivi-server.mjs`).
  The GraphQL endpoint and every TV route stay unreachable from the wifi.
- **Scope**: single Pi/TV per install for v1. Multi-room/multi-Pi sync is
  explicitly deferred, not designed for yet.
- **OS/base image**: NixOS. The app is packaged as a Nix flake plus a NixOS
  module (`flake.nix`, `nix/`, documented in DEPLOYMENT.md) that brings up the
  server, the database, the firewall rules and the fullscreen kiosk, plus
  flashable SD images per board (Pi 4 and Pi 5 need separate ones — different
  kernel, different device tree) built on release by
  `.github/workflows/image.yml`. Chosen
  over Raspberry Pi OS Lite because the flashable image this needs next falls
  out of a declarative config directly. The remaining risk is unchanged and now
  concentrated in one place: hardware video decode in the kiosk browser on Pi
  hardware. The app itself stays OS-agnostic (a plain systemd unit + the
  runtime dependency list in RUNTIME_DEPENDENCIES.md), so this is still a
  packaging decision rather than an architectural one.

## Proposed tech stack

### On-device shell & UI

- SvelteKit, compiled to a static SPA, rendered full-screen in a minimal
  Chromium/WebKit kiosk view (a rendering host for the custom UI, not a
  general browser for third-party sites)
- Custom focus/spatial-navigation layer mapping remote swipe gestures to
  directional focus movement (build this early — every app depends on it)
- Apps expose UI via the shared Svelte component library + navigation
  manager, not iframes

### App runtime

- Node.js/TypeScript host process, running each app as a sandboxed OCI
  container (see the distribution and sandboxing decisions above; `apps/youtube`
  is the first one, built as an image with `bun run app:build`)
- Each app talks to the host over JSON-RPC on stdio. Contract
  types for that channel live in `src/lib/apps/`:
  - `manifest.ts` — `AppManifest`, the permission/feature enums and
    domain rules, read at install time to decide what an app may touch
  - `imageRef.ts` — compose-style image reference parsing
  - `dashboard.ts` — Tier 1 `HomeCard`/`DashboardContribution`, shaped to
    match the existing `ContinueWatchingRow`/`PosterRow`/`AppsRow`
    components
  - `ui.ts` — Tier 2 `UiNode`/`AppScreen`/`UiEvent`, the declarative
    component-tree language for full custom screens
  - `session.ts` — Tier 3 `SessionRequest`/`SessionEnded`/`WebviewScreen`,
    exclusive display/input handoff and the webview fallback
  - `theme.ts` — `AppTheme`, the fixed design-token set for branding
  - `host.ts` — `AppToHost`/`HostToApp`, the actual RPC envelope
    tying all of the above together
- App API surface: navigation/focus events, HTTP client, credential/token
  storage, and a playback handoff API (`player.play(url, {headers, drm?})`)
- Reference apps to build first:
  - **Jellyfin** — official REST API, well documented
  - **Spotify** — Web API + Spotify Connect for playback control (no audio
    streaming logic needed on our side)
  - **Immich** — REST API, mostly for browsing/casting photos
  - **Twitch** — Helix API + HLS stream URLs
  - **YouTube** — yt-dlp extraction (ad-free) + Cast-from-phone fallback
    - Built as a prototype (`apps/youtube/`) to validate the app
      contracts. No browsing without signing in — only this account's
      actual personalized YouTube home feed and search
      (`apps/youtube/tvHomeFeed.ts` / `tvSearch.ts`), via the TV
      InnerTube client — the one client OAuth2 is documented to work with.
      `youtubei.js`'s own typed WEB-oriented parser classes
      (`HomeFeed`/`Search`) can't read TV's response shape (direct
      authenticated InnerTube calls also reliably 400 on the WEB client
      itself — OAuth-only auth, no cookie), but the raw TV JSON turned out
      to be plain and readable (unobfuscated field names), so both walk it
      directly with a small recursive tile-finder (`apps/youtube/tvTiles.ts`)
      instead of needing typed parser classes — cheaper than it looked at
      first. A PO token (BotGuard attestation, via `bgutils-js`) was tried
      and ruled out along the way as unrelated to the WEB-client 400s.
      An earlier version of this app used a self-hosted Invidious
      sidecar for generic/signed-out trending and search; dropped since
      this app has no anonymous/public-content use case, and search turned
      out to work through the same raw-TV-client approach as the home feed.
      - Sign-in itself (`apps/youtube/auth.ts`) goes through `youtubei.js`
        directly either way — device-code OAuth2, no registered Google
        client needed.

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

- One long-running daemon (systemd service) hosting: app runtime,
  WebSocket remote server, Cast receiver, mpv IPC bridge
- Local SQLite for app config, pairing tokens, watch state/resume positions
- mDNS (Bonjour) advertisement for discovery

### OS/deployment

- Deferred. Scaffold the app OS-agnostically (systemd unit + documented
  runtime dependencies) so Raspberry Pi OS Lite vs NixOS stays a packaging
  decision. If NixOS: check `nixos-raspberrypi`/`nixos-hardware` Pi 4/5 board
  and GPU/media driver support before committing.

## Suggested build order

1. libmpv playback service + minimal SvelteKit shell with hardcoded focus
   navigation (prove the core feel before anything else)
2. App SDK contracts + host process/RPC skeleton (`src/lib/apps/`,
   see above) — build once, before the first real app depends on it
3. Jellyfin app (best-documented API, immediately useful)
4. PWA remote + QR pairing + WebSocket gesture protocol
5. Spotify Connect app, then Immich
6. Cast receiver
7. Twitch, then YouTube (both app variants)
8. Moonlight/Sunshine game-streaming app (exclusive/passthrough session
   tier, reusing moonlight-embedded)

## Open questions for later

- Multi-room/multi-Pi sync architecture, if pursued
- Whether/how to build a real hosted app store and registry
- Native remote app (iOS/Android) vs staying PWA long-term
- Final OS base image decision (NixOS vs Raspberry Pi OS Lite)
- Exact design-token set exposed for app theming, and whether a
  sanitized-CSS escape hatch is ever worth adding once Tier 2 proves
  insufficient for some real app
- How exclusive-session capability grants (display/input passthrough) get
  surfaced to and audited by the user at app-install time, given they're
  a materially bigger trust decision than a plain network capability
