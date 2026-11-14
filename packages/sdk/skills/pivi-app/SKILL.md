---
name: pivi-app
description: Build, extend or debug a pivi app, the sandboxed integration that connects a service (a video site, a streaming platform, a media server) to the pivi TV box. Use whenever the task is to hook a service up to pivi, write or change a pivi app's manifest, `defineApp` handlers, dashboard cards, declarative screens, stream resolving, sign-in or chat, or to package an app as an image.
---

# Building a pivi app

A pivi app teaches pivi about one service. It is a small program in an OCI image that the
host runs in a locked-down microVM and talks to with JSON-RPC over stdin/stdout. The app never
draws anything: it sends **data** (home cards, screens as a tree of nodes) and answers
**requests** ("give me a playable stream for this id"). The host renders the UI, owns focus and
remote control, and runs the player. This keeps every app looking and behaving like pivi.

## Where the truth is

Read these instead of guessing. Paths are relative to the SDK package: `node_modules/@pivi/sdk/`
in an app project, `packages/sdk/` in the pivi repository.

| Need                                                | Read                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| Every message, its feature gate and its exact shape | `skills/pivi-app/references/protocol.md`                                  |
| What each field means, constraints and caveats      | `src/protocol.ts`, `src/manifest.ts` (the comments are the specification) |
| Every UI node you can put on a screen               | `src/ui.ts`, the `UiNode` type                                            |
| Home cards and actions                              | `src/dashboard.ts`                                                        |
| Size caps applied to everything you send            | `src/limits.ts`                                                           |
| Host icon names                                     | `src/icons.ts`                                                            |
| A complete real app                                 | `apps/twitch` in the pivi repository (about 2,000 lines)                  |

## Workflow

1. **Understand the service first.** Before writing any pivi code, work out how to get from a
   video id to a playable URL, and how a person signs in (if they must). Prove it with plain
   `fetch` or `curl`. Most of the effort of an app is here, not in pivi.
2. **Pick the features** (table below), then write `manifest.json`.
3. **Write `main.ts`** with `defineApp`. Keep service logic in separate modules with no
   protocol code in them, so it can be unit tested.
4. **Test it** (see Testing) before packaging.
5. **Package** it as an image and install it in pivi.

## Features: declare what you implement

| Feature        | Declare it when the app                                            | Handlers and calls                                             |
| -------------- | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| `dashboard`    | puts cards on the home screen (continue watching, recommendations) | `app.publishDashboard`, `onRefreshDashboard`                   |
| `screen`       | has its own pages (browse, search, settings, sign-in)              | `app.publishScreen`, `onUiEvent`, `app.openOnPhone`            |
| `playback`     | plays video                                                        | `resolveStream`, optionally `resolveNext`, `resolveLiveStatus` |
| `skipSegments` | knows skippable stretches (sponsors, intros)                       | `resolveSkipSegments`                                          |
| `chat`         | shows live chat next to a stream                                   | `onOpenChat`, `onCloseChat`, `app.sendChat`                    |

The host only sends what the manifest declares and drops what an undeclared feature sends. A
handler without its feature is dead code, and a feature without its handler is a broken app.

## The manifest

```json
{
	"id": "demo",
	"name": "Demo",
	"version": "0.1.0",
	"description": "One line, at most 140 characters",
	"protocol": 2,
	"features": ["dashboard", "screen", "playback"],
	"permissions": ["network", "storage"],
	"network": { "domains": ["api.example.com", "*.cdn.example.com"] },
	"entryScreenId": "main",
	"icon": "<svg …></svg>",
	"primaryColor": "#4f46e5",
	"secondaryColor": "#18181b"
}
```

- `id`: lowercase letters, digits and dashes. `protocol` must equal the SDK's `PROTOCOL_VERSION`.
- **Permissions** are `network`, `storage` (persistent `/storage`, per profile) and `cache`
  (disposable `/cache`). The user approves them at install, and the sandbox enforces them.
- `network.domains` is required exactly when `network` is requested. Entries are hostnames or
  `*.suffix`, never IPs, ports, paths or overly broad wildcards like `*.com`.
- **List every host you touch**: the API, the CDN the video comes from, each host an HLS
  playlist references, and the image CDN. Anything else is unreachable from inside the app, and
  URLs the app hands back to the host (streams, images) are checked against the same list and
  must be `https`. A missing domain looks like a silent failure: a blank card, a stream that
  never starts.
- Validate the manifest in a test with `appManifestSchema.parse(...)`, the host refuses an
  image whose manifest doesn't validate.

## `main.ts`

```ts
import { defineApp } from '@pivi/sdk/app';

defineApp((app) => ({
	onActivate({ locale }) {
		// Start loading and publishing here. Earlier publishes are dropped.
	},
	resolveStream: async ({ sessionId, maxHeight }) => ({
		videoUrl: await findUrl(sessionId),
		vcodec: 'h264',
		videoContainer: 'mp4',
		title: 'Title',
		duration: 596
	})
}));
```

- `defineApp` sends `app/ready`, registers the handlers right away so an early `activate` is not
  missed, and moves `console.log` to stderr. **stdout is the protocol channel: never write to
  it.** Log with `app.log(level, message)` or `console.error`.
- Handlers may return promises. A thrown error becomes a JSON-RPC error for requests, and is
  logged for `onActivate`.
- `host/ping` is answered for you. Keep the event loop free: an app that stops answering after
  a request timeout is killed, so do not block it with long synchronous work.

## Playback

`resolveStream` maps a `sessionId` (an opaque string you chose in a card's
`action: { type: 'session', sessionId }`) to a stream. Return exactly one of:

- **A single file**: `videoUrl` (with audio inside), `videoContainer: 'mp4' | 'webm'`.
- **Separate tracks**: `videoUrl` plus `audioUrl`, played through MSE. Each file needs its
  segment index near the start: an mp4 a `sidx` box, a webm a `Cues` element, within the first
  2 MiB, as DASH-ready files have.
- **HLS**: `videoContainer: 'hls'`, `videoUrl` a master or media playlist. The host proxies the
  playlist and everything it references, so every variant playlist and segment must be on a
  declared domain. The player picks variants itself, so list their heights in `qualities` and
  ignore `maxHeight`.

Set `duration: 0` and `live: true` for a live stream, `chat: true` when `chat` is implemented
for it, and `subtitleTracks` (WebVTT) when you have captions. `controls` switches individual
player controls off. `resolveNext` answers what plays after this one, using the `context` the
card's action carried.

## Dashboard and screens

- **Dashboard** (`publishDashboard`): home cards, plain data. `resume` cards carry a 0..1
  progress, `suggestion` cards do not. Each has an `action`: open a screen, play a session, or
  `openOnPhone`. The host asks for fresh cards via `onRefreshDashboard` when the home screen
  opens (at most twice a minute), so keep live lists cheap to reload.
- **Screens** (`publishScreen`): a `{ screenId, root: UiNode }`. Publish again with the same id
  to update it. The first screen is `entryScreenId`. Build them from the shell's own nodes
  (`mediaCard`, `shelf`, `hero`, `button`, `textInput`, `container`…). Do not try to style
  things: there is no CSS, and that is what keeps every app consistent.
- **Events**: nodes carry event ids (`onSelect`, `onSubmit`, `onInput`, `onChange`,
  `onReachEnd`). The host sends them back as `onUiEvent({ screenId, eventId, value })`. An
  `action` on a node instead navigates, with no round trip.
- **It is a TV.** People sit across the room with a remote. Prefer `size: 'lg'` for primary
  buttons, short text, and `lines` to clamp titles. Infinite scroll: send `skeleton` children
  and an `onReachEnd` event only while more items exist.
- Keep screens small. A list is capped (`MAX_LIST_ITEMS`), send one page and append on
  `onReachEnd`.

## Signing in

There is no sign-in feature: a sign-in is just a screen. The reliable pattern, used by the
Twitch and YouTube apps, is the **device code flow**: show a code and a URL on a `center`ed
container, let the person enter it on their phone, and poll the service for the token.
`app.openOnPhone(url)` can push an `https` link straight to the paired phone (the phone asks
the user first; it is rate limited, so send it once).

- Never embed a client secret. Use the service's public device or TV client id where one exists.
- Store tokens in `/storage` (permission `storage`): they then persist per profile across
  restarts. Without that permission the session is gone after a restart.
- Refresh shortly before expiry and once on a 401. Share one in-flight refresh promise so
  concurrent callers don't reuse a rotated refresh token. Clear the session only on a definitive
  refusal (400, 401, `invalid_grant`), never on a network error.
  `apps/twitch/auth.ts` is a complete implementation.
- Show personal data only from live responses. Do not store more than the tokens.

## Testing

Until the pivi dev tooling exists, test in three layers:

1. **Pure logic** (parsing, URL building, playlist handling) with plain unit tests
   (`bun test` or vitest). Fixture real responses.
2. **The manifest**: `appManifestSchema.parse(manifestJson)`.
3. **The protocol**: run the app as the host does and speak newline-delimited JSON-RPC to it:

   ```sh
   printf '%s\n' \
     '{"jsonrpc":"2.0","method":"host/activate","params":{"locale":"en-US"}}' \
     '{"jsonrpc":"2.0","id":1,"method":"app/resolveStream","params":{"sessionId":"abc"}}' \
     | bun run main.ts
   ```

   Expect `app/ready` first, then publishes and the response. Validate what comes out with the
   exported schemas (`dashboardContributionSchema`, `appScreenSchema`, `resolvedStreamSchema`).
   `packages/sdk/test/demoApp.ts` and `src/app.spec.ts` show the pattern in a test.

Mind that locally nothing enforces your `network.domains`: a request to a host you forgot only
fails inside pivi. Check the list against the hosts your logs actually contact.

## Packaging

Bundle the app and the SDK into one file so nothing has to be installed where it runs:

(Add a `.dockerignore` with `node_modules`, so local installs do not leak into the image.)

```dockerfile
FROM oven/bun:1 AS build
WORKDIR /build
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY . .
RUN bun build ./main.ts --target=bun --outfile=/out/main.js

FROM oven/bun:1
WORKDIR /app
COPY --from=build /out/main.js ./main.js
ENTRYPOINT ["bun", "run", "/app/main.js"]
```

The manifest travels as an image **label**, `dev.pivi.manifest`, holding the manifest JSON on one
line, which pivi reads before pulling anything so the user can approve its permissions:

```sh
docker build \
  --label "dev.pivi.manifest=$(jq -c . manifest.json)" \
  -t registry.example.com/pivi-demo:0.1.0 .
docker push registry.example.com/pivi-demo:0.1.0
```

Build for `linux/amd64` and `linux/arm64` (pivi runs on Raspberry Pis) and push a manifest
list. Install it in pivi on the **Apps** page by entering the image reference. The app is then
pinned by digest. Updating means pushing a new version, and a signed app (cosign key-based
signatures) can only be updated by the same signer.

## Pitfalls

- Writing to stdout, or a library that does, corrupts the protocol. Check dependencies too.
- Publishing before `onActivate`, or a feature declared without its handler.
- A domain missing from the manifest (see above), or an `http` URL.
- Returning a stream URL that expires before the player uses it, or one that needs headers the
  host doesn't send. Resolve lazily, on `resolveStream`, not when building cards.
- Messages that fail validation, size caps included, are ignored. Send less.
- Heavy work on the event loop. The watchdog stops an app that stops answering, or one that
  burns CPU for too long.
- Assuming an unofficial API is stable. Isolate it in one module and add fixture tests so a
  change shows up in CI, not on the TV.
