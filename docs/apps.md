# Apps

A pivi app is an **OCI image**. It can be written in any language; it talks
to the host over its own stdin/stdout, and it runs inside a microVM that can
only do what the user has switched on. Apps are installed at runtime, from a
registry, from the paired phone — nothing about an app is part of the pivi
build.

- [How it fits together](#how-it-fits-together)
- [Writing an app](#writing-a-app)
  - [The manifest](#the-manifest)
  - [Sign-in](#sign-in)
  - [The protocol](#the-protocol)
  - [The environment it runs in](#the-environment-it-runs-in)
- [Building, signing and publishing](#building-signing-and-publishing)
- [Installing and updating](#installing-and-updating)
- [Security model](#security-model)
- [Hosting requirements](#hosting-requirements)
- [Developing and testing](#developing-and-testing)

## How it fits together

```
phone ──(paired, encrypted relay)──▶ appCommands ──▶ installer / updater
                                                          │  registry client (read label, verify digest)
                                                          │  signature check (cosign key)
                                                          ▼
                                        installed_app row (pinned digest,
                                        approved manifest, granted permissions)
                                                          │
TV browser ──GraphQL──▶ manager ──▶ sandbox (microVM) ◀──stdio JSON-RPC──▶ app process
```

| Piece                                                        | Where                                          |
| ------------------------------------------------------------ | ---------------------------------------------- |
| Manifest schema, permissions, domain rules                   | `src/lib/apps/manifest.ts`                     |
| Image reference parsing (compose-style)                      | `src/lib/apps/imageRef.ts`                     |
| Protocol methods, framing                                    | `src/lib/apps/host.ts`, `ndjson.ts`            |
| Protocol as JSON Schema                                      | `docs/app-protocol.schema.json`                |
| Registry client, signature verification                      | `src/api/apps/registry.ts`, `signature.ts`     |
| Install / configure / uninstall, updates                     | `src/api/apps/installer.ts`, `updater.ts`      |
| Running apps, per-profile binding                            | `src/api/apps/manager.ts`, `runtime.ts`        |
| Sandbox spec (permissions → enforcement) and microVM backend | `src/api/apps/sandbox/`                        |
| What the phone can ask for                                   | `src/api/appCommands.ts`, `AppManager.svelte`  |
| The installed set                                            | `installed_app` table (`src/api/db/schema.ts`) |

## Writing an app

An app image has three requirements:

1. A `dev.pivi.manifest` **label** holding the manifest as JSON.
2. An `ENTRYPOINT`/`CMD` that speaks the [protocol](#the-protocol) on stdin/stdout.
3. A build for each platform it should run on (`linux/arm64` for the Pi,
   `linux/amd64` for development).

### The manifest

```json
{
	"id": "youtube",
	"name": "YouTube",
	"version": "0.1.0",
	"protocol": 1,
	"features": ["dashboard", "screen", "playback", "skipSegments"],
	"permissions": ["network", "storage", "cache"],
	"network": { "domains": ["www.youtube.com", "*.googlevideo.com"] },
	"entryScreenId": "browse",
	"icon": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 48 48\">...</svg>",
	"primaryColor": "#ff0000",
	"secondaryColor": "#282828"
}
```

| Field            | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | Lowercase letters, digits and dashes. Unique on a device.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `protocol`       | The protocol version the app speaks. The host refuses a version it doesn't support.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `features`       | What the app implements. The host only calls (and only accepts) what's listed. Any subset.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `permissions`    | What it asks to be allowed. The user switches each on or off; the host enforces it.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `network`        | The domains the `network` permission covers. Required with `network`, invalid without it.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `entryScreenId`  | The screen the app page opens on (for the `screen` feature). Defaults to `main`.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `icon`           | An inline SVG document, shown wherever the app itself is represented (install preview, the apps list, its home-screen tile, its own page header). Optional; falls back to a generic badge. Capped at 16 KiB and checked for `<script>`/event-handler/`javascript:` content, but the real safety mechanism is that it's always rendered through `<img src="data:image/svg+xml,...">` (see `appIconDataUrl` in `manifest.ts`), never inserted as markup — a browser won't execute script or fetch anything from an SVG loaded that way. |
| `primaryColor`   | A hex color (`#rgb` or `#rrggbb`) used as the app's accent wherever it's shown. Optional.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `secondaryColor` | A second hex color, paired with `primaryColor` for a gradient. Optional; ignored without `primaryColor`.                                                                                                                                                                                                                                                                                                                                                                                                                              |

**Features** — `dashboard` (cards on the home page), `screen` (a declarative
screen, rendered by the shell), `playback` (resolves session ids to streams),
`skipSegments` (reports skippable stretches). There's no dedicated sign-in
feature: an app that needs one builds the prompt out of its own `screen`
content and a button whose action is `openOnPhone` (see
[Sign-in](#sign-in) below).

**Permissions** — a fixed set, each enforced by the sandbox:

| Key       | Effect when granted                                                                                                                                |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `network` | Outbound HTTP/HTTPS to exactly the manifest's domains, all together. Nothing else is reachable: not other domains, the LAN, localhost or the host. |
| `storage` | A persistent volume at `/storage`, one per app and profile, size-limited, **not encrypted**. Removed when the app is uninstalled.                  |
| `cache`   | A disposable volume at `/cache`, size-limited. The host may clear it at any time (updates, the user asking).                                       |

A permission that isn't granted simply doesn't exist for the app: no
`/storage` directory, no network interface. It has to cope.

**Domains** are an exact host (`api.example.com`) or `*.suffix`, which covers the
suffix itself and everything beneath it. IP addresses, ports, paths, a bare `*`
and over-broad wildcards like `*.com` are rejected. The user is shown this list
verbatim, so list what the app really talks to — including hosts it only
hands back to the host (stream URLs, thumbnails): the host refuses to fetch or
display a URL on any other domain.

### Sign-in

There's no dedicated sign-in protocol. An app that needs one builds the
prompt itself out of ordinary `screen` content (`#lib/apps/ui`'s `UiNode`) —
a code to read out, a status line — and wires its one actionable button to
`openOnPhone`:

```ts
{ type: 'button', label: 'Open on your phone', action: { type: 'openOnPhone', url } }
```

That action is the host's entire contribution to login: it pushes `url` to
whatever phone is currently paired (the same mechanism as the "Open on your
phone" button elsewhere in the shell), and leaves everything else — polling
a device code, completing an OAuth redirect, deciding what "signed in" even
means — to the app. See `apps/youtube/auth.ts` and `main.ts`'s
`signInPrompt`/`beginSignIn` for a worked example (youtubei.js's own
device-code flow, reported through the app's regular screen republish).

### The protocol

JSON-RPC 2.0 over the entrypoint's **stdin/stdout, one UTF-8 JSON message per
line**. stderr is the log (the host captures it line by line). Nothing else may
be written to stdout.

The methods, their parameters and results are in
[`app-protocol.schema.json`](./app-protocol.schema.json), generated from
the schemas the host itself validates with (`bun run apps:protocol`; a test
fails if the committed file drifts). The sequence:

1. App → host: `plugin/ready` `{ "protocol": 1 }` once it can receive requests.
2. Host → app: `host/activate`. The app may start publishing.
3. App publishes what its features say (`plugin/publishDashboard`,
   `plugin/publishScreen`); the host answers `host/uiEvent`,
   `plugin/resolveStream`, `plugin/resolveSkipSegments` as the user uses it.
4. Host → app: `host/shutdown`; the app should exit. It is stopped shortly
   after regardless.

A complete app needs no library — this one is a shell script:

```sh
#!/bin/sh
echo '{"jsonrpc":"2.0","method":"app/ready","params":{"protocol":1}}'
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  [ -n "$id" ] && printf '{"jsonrpc":"2.0","id":%s,"result":null}\n' "$id"
done
```

TypeScript apps can use `createStdioConnection()` from
`src/lib/apps/stdioConnection.ts` with the contract types in
`src/lib/apps/host.ts` (see `apps/youtube`). A message larger than 64 MiB is
treated as the app misbehaving. What an app publishes is validated: a
screen or dashboard it didn't declare is dropped, and image URLs outside its
domains are blanked.

### The environment it runs in

- A microVM with its own Linux kernel, 1 vCPU, 256 MiB of memory.
- The image's root filesystem is writable but ephemeral.
- `/storage` and `/cache` as above, only if granted.
- Network only if granted — see above. HTTPS goes through an **inspecting
  proxy**: the sandbox's own CA is installed in the system trust store, and
  `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, `CURL_CA_BUNDLE` and `NODE_EXTRA_CA_CERTS`
  are set to it. Runtimes that ship **their own** CA list (certifi in Python
  packages, the PyInstaller build of yt-dlp, Java's keystore) won't trust it
  unless you make them use the system store — the YouTube image installs yt-dlp
  from PyPI _without_ certifi for exactly this reason (see its Dockerfile).
  Certificate pinning won't work.
- Everything the app should know arrives over the protocol: there are no
  environment secrets.

## Building, signing and publishing

```sh
# 1. Build — attaches the manifest as the label, validated with the host's schema.
#    Run from the repository root; <dir>/Dockerfile is built with the repo as context.
bun run app:build apps/youtube ghcr.io/you/pivi-youtube:0.1.0
# (for other images: docker build --label dev.pivi.manifest="$(jq -c . manifest.json)" ...)

# 2. Push (multi-arch: use buildx so both linux/arm64 and linux/amd64 exist).
docker push ghcr.io/you/pivi-youtube:0.1.0

# 3. Sign with a key pair you keep (generate once: `cosign generate-key-pair`).
cosign sign --key cosign.key --new-bundle-format=false --use-signing-config=false \
  --tlog-upload=false ghcr.io/you/pivi-youtube@sha256:<digest>
```

Publish `cosign.pub` wherever you publish the app: **it is what users
install against**. Sign the digest the tag resolves to (for a multi-arch image,
the index digest — what `docker buildx imagetools inspect` prints).

> Only the legacy cosign signature layout (a `sha256-<digest>.sig` tag) signed
> with a **key** is verified. Keyless signatures (Sigstore/Fulcio identities) are
> not accepted: verifying them properly needs certificate-chain and
> transparency-log checks that aren't implemented, and half-checking one would be
> worse than refusing it.

Images are referenced the way a compose file does: a bare `name` or
`owner/name` is on Docker Hub, anything else names its registry
(`ghcr.io/owner/name:1.0`, `registry.example.com:5000/name`). An app has to be
installed by tag (it's what updates follow), but runs pinned to the digest that
was verified.

### Suggesting an app to install

The install form offers known apps as a one-tap button instead of making
the user type out an image ref. The list lives in `SUGGESTED_APPS` in
`src/api/apps/suggested.ts` — edit it to point at wherever you published
the image (and, once it's signed, add its `publicKey`). Tapping an entry
previews and installs exactly like typing the same image and key by hand — a
pinned public key still goes through the normal signature check.

## Installing and updating

From the paired phone: the apps button in the remote's header.

1. Enter the image and the publisher's public key and press **Review**. The host
   resolves the image, verifies the signature and shows what the app asks for —
   permissions, and exactly which domains the network toggle opens — before
   anything is stored or run.
2. Switch off what you don't want to give; **Install** pulls the image and records
   it (pinned by digest, with the key it was verified against).
3. Each installed app can be enabled/disabled, set to update automatically, and
   have every permission toggled. A change takes effect by restarting the app.

Updates are checked every six hours (and shortly after boot). A new digest is
only trusted if it is signed by the **same key** the app was installed with.

- If it asks for nothing beyond what was approved (no new permission, no new
  domain, same protocol) and auto-update is on, it is applied — and rolled back,
  with the failure shown, if it won't start.
- Otherwise it is pulled and **parked**: the old version keeps running until the
  user approves, and **Not now** remembers the build so it isn't offered again.
  Approving grants what was newly asked for and keeps whatever the user had on.

## Security model

What is enforced, and by what:

| Property                                                           | Enforced by                                                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| An app runs only if signed by a key the user supplied              | `signature.ts` (checked at install and at every update)                                     |
| The image that runs is the one that was verified                   | Pinned by digest; registry responses are hashed against their digests                       |
| Network reaches the declared domains only, with no LAN/host access | The microVM's network policy plus TLS interception (`sandbox/microsandbox.ts`)              |
| An app can't touch another app's or profile's data                 | Separate volumes per (app, profile)                                                         |
| The host never fetches a URL an app returns outside its domains    | `runtime.ts` (`allowsUrl`) and `streamCache.ts`; also public-address check in `urlGuard.ts` |
| What an app publishes is bounded                                   | Schema checks, feature gating, image sanitising (`sanitize.ts`)                             |
| Only the paired phone can install or reconfigure apps              | Handled over the encrypted relay, never as a TV-reachable endpoint                          |

Known limits, stated plainly:

- **Keyless signatures aren't supported** (above).
- **`/storage` is not encrypted at rest.** Protect the device's disk if that
  matters.
- The public-address check resolves a hostname once, and the fetch that follows
  resolves it again; a name that changes its answer in between could slip through.
- Isolation is as strong as KVM and the microsandbox runtime, which describes
  itself as beta software.
- Resource limits are fixed (1 vCPU, 256 MiB) and not yet manifest-configurable.

## Hosting requirements

- **KVM**: `/dev/kvm` must exist and be usable by the service user (the NixOS
  module adds `pivi` to the `kvm` group). Whether KVM is available on a Pi 4/5
  image has not been verified; the stack is tested on x86_64 only.
- `PIVI_SANDBOX_HOME`: a **short** directory for the sandbox runtime's state
  (the NixOS module sets it to `<stateDir>/sandbox`). Unix socket paths are
  derived from it and the kernel limits them to 107 bytes.
- A glibc-based host. On NixOS the runtime's native binaries are patched by
  `autoPatchelfHook` in `nix/package.nix`.

## Developing and testing

```sh
bun run apps:protocol     # regenerate docs/app-protocol.schema.json
bun run app:build apps/youtube localhost:5055/pivi-youtube:0.1.0
npx vitest run --project server   # unit tests (a fake in-memory registry, no KVM needed)
```

The end-to-end test (`src/api/apps/sandbox.e2e.spec.ts`) runs a real signed
image through a real registry and microVM, so it needs KVM and is skipped unless
pointed at one:

```sh
docker run -d -p 127.0.0.1:5055:5000 registry:2          # a local registry (plain HTTP is fine for localhost)
bun run app:build apps/youtube localhost:5055/pivi-youtube:0.1.0
docker push localhost:5055/pivi-youtube:0.1.0
cosign generate-key-pair
cosign sign --key cosign.key --allow-insecure-registry --tlog-upload=false \
  --new-bundle-format=false --use-signing-config=false localhost:5055/pivi-youtube@<digest>

PIVI_E2E_IMAGE=localhost:5055/pivi-youtube:0.1.0 PIVI_E2E_PUBLIC_KEY=cosign.pub \
PIVI_SANDBOX_HOME=/tmp/msbh npx vitest run --project server sandbox.e2e
```
