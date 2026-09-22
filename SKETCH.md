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
- **YouTube**: support a yt-dlp-style extraction plugin (gets
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
- **Plugin UI composition — three tiers, shell always renders.** Plugins
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
- **Plugin theming — design tokens, not raw CSS.** A plugin sets a small
  fixed set of CSS custom properties (accent color, logo, corner radius),
  scoped inside a per-plugin Shadow DOM boundary. That gives brand identity
  without a plugin's styling being able to escape its own subtree, override
  focus-visible styling, or exfiltrate data via `url()`. Free-form CSS
  stays out of scope until a concrete plugin needs it, and would need
  sanitization, not blind trust, even then.
- **Plugin sandboxing — one child process per plugin, RPC boundary,
  capability manifest.** Plugins run as separate Node/Deno child processes
  talking to the trusted host over RPC (the VS Code extension-host model),
  not in-process (`vm`/`vm2`-style sandboxes are too weak — `vm2`
  specifically has unresolved CVEs). Each plugin declares required
  capabilities in its manifest (network domains, credential storage,
  exclusive display/input); the host grants only what's declared. No
  filesystem capability exists at all — a plugin has no legitimate need to
  read/write arbitrary paths, so it's not offered as an option to grant.
  This model also gives crash isolation for free — a broken plugin can't
  take down the shell or other plugins.
- **Exclusive/passthrough sessions — a fourth capability, not a UI tier.**
  Some plugins need direct hardware access instead of shell-mediated
  rendering/input: game streaming (Moonlight/Sunshine) and playback itself.
  These get their own display plane (the same pattern as libmpv "rendering
  to its own layer under/behind the kiosk UI") and, for game streaming,
  direct passthrough of a gamepad's input device node to the plugin
  process, bypassing the focus/nav layer entirely for the session's
  duration. Granted only while a session declaring that need is active,
  reclaimed by the shell the moment it ends.
- **Login — OAuth device authorization grant first, phone handoff
  second.** TV platforms solve on-screen login the same way industry-wide
  (YouTube, Netflix, Spotify): show a code/QR, the user completes it on
  another device, the TV polls for a token. That's expressible entirely
  with Tier 1 components — no custom login UI needed. For the minority of
  services without device-flow support, hand the login webview to the
  paired phone (real keyboard, password manager, 2FA autofill) instead of
  rendering a form on the TV, reusing the same QR-pairing mechanism already
  built for remote pairing.
- **Reuse strategy for plugins.** Reuse existing implementations at the
  API/logic layer — official or community SDKs (Jellyfin, Spotify Web API,
  Immich's OpenAPI client, Twitch Helix) — and via subprocess for headless
  native tools (yt-dlp, moonlight-embedded) rather than reimplementing
  protocols. Android app virtualization (Waydroid/Anbox) is ruled out: too
  heavy for Pi 4/5, no Widevine L1 for DRM content anyway, and it would
  throw away the shared navigation model that's the actual point of this
  project.
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
  (a systemd unit + a documented runtime dependency list — see
  RUNTIME_DEPENDENCIES.md) so this stays a packaging decision, not an
  architecture one.

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
- Each plugin runs in its own child process (Node or Deno), talking to the
  host over an RPC channel — see the sandboxing decision above. Contract
  types for that channel live in `src/lib/plugins/`:
  - `manifest.ts` — `PluginManifest`/`PluginCapability`, read at install
    time to decide what a plugin's process is allowed to touch
  - `dashboard.ts` — Tier 1 `HomeCard`/`DashboardContribution`, shaped to
    match the existing `ContinueWatchingRow`/`PosterRow`/`AppsRow`
    components
  - `ui.ts` — Tier 2 `UiNode`/`PluginScreen`/`UiEvent`, the declarative
    component-tree language for full custom screens
  - `session.ts` — Tier 3 `SessionRequest`/`SessionEnded`/`WebviewScreen`,
    exclusive display/input handoff and the webview fallback
  - `auth.ts` — `DeviceCodeAuth`/`PhoneAuthHandoff`, the device-flow-first
    login model
  - `theme.ts` — `PluginTheme`, the fixed design-token set for branding
  - `host.ts` — `PluginToHost`/`HostToPlugin`, the actual RPC envelope
    tying all of the above together
- Plugin API surface: navigation/focus events, HTTP client, credential/token
  storage, and a playback handoff API (`player.play(url, {headers, drm?})`)
- Reference plugins to build first:
  - **Jellyfin** — official REST API, well documented
  - **Spotify** — Web API + Spotify Connect for playback control (no audio
    streaming logic needed on our side)
  - **Immich** — REST API, mostly for browsing/casting photos
  - **Twitch** — Helix API + HLS stream URLs
  - **YouTube** — yt-dlp extraction (ad-free) + Cast-from-phone fallback
    - Built as a prototype (`plugins/youtube/`) to validate the plugin
      contracts. No browsing without signing in — only this account's
      actual personalized YouTube home feed and search
      (`plugins/youtube/tvHomeFeed.ts` / `tvSearch.ts`), via the TV
      InnerTube client — the one client OAuth2 is documented to work with.
      `youtubei.js`'s own typed WEB-oriented parser classes
      (`HomeFeed`/`Search`) can't read TV's response shape (direct
      authenticated InnerTube calls also reliably 400 on the WEB client
      itself — OAuth-only auth, no cookie), but the raw TV JSON turned out
      to be plain and readable (unobfuscated field names), so both walk it
      directly with a small recursive tile-finder (`plugins/youtube/tvTiles.ts`)
      instead of needing typed parser classes — cheaper than it looked at
      first. A PO token (BotGuard attestation, via `bgutils-js`) was tried
      and ruled out along the way as unrelated to the WEB-client 400s.
      An earlier version of this plugin used a self-hosted Invidious
      sidecar for generic/signed-out trending and search; dropped since
      this app has no anonymous/public-content use case, and search turned
      out to work through the same raw-TV-client approach as the home feed.
      - Sign-in itself (`plugins/youtube/auth.ts`) goes through `youtubei.js`
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
2. Plugin SDK contracts + host process/RPC skeleton (`src/lib/plugins/`,
   see above) — build once, before the first real plugin depends on it
3. Jellyfin plugin (best-documented API, immediately useful)
4. PWA remote + QR pairing + WebSocket gesture protocol
5. Spotify Connect plugin, then Immich
6. Cast receiver
7. Twitch, then YouTube (both plugin variants)
8. Moonlight/Sunshine game-streaming plugin (exclusive/passthrough session
   tier, reusing moonlight-embedded)

## Open questions for later

- Multi-room/multi-Pi sync architecture, if pursued
- Whether/how to build a real hosted plugin store and registry
- Native remote app (iOS/Android) vs staying PWA long-term
- Final OS base image decision (NixOS vs Raspberry Pi OS Lite)
- Exact design-token set exposed for plugin theming, and whether a
  sanitized-CSS escape hatch is ever worth adding once Tier 2 proves
  insufficient for some real plugin
- How exclusive-session capability grants (display/input passthrough) get
  surfaced to and audited by the user at plugin-install time, given they're
  a materially bigger trust decision than a plain network capability
