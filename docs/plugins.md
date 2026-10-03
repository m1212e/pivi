# Plugins

A pivi plugin is an **OCI image**. It can be written in any language; it talks
to the host over its own stdin/stdout, and it runs inside a microVM that can
only do what the user has switched on. Plugins are installed at runtime, from a
registry, from the paired phone — nothing about a plugin is part of the pivi
build.

- [How it fits together](#how-it-fits-together)
- [Writing a plugin](#writing-a-plugin)
  - [The manifest](#the-manifest)
  - [The protocol](#the-protocol)
  - [The environment it runs in](#the-environment-it-runs-in)
- [Building, signing and publishing](#building-signing-and-publishing)
- [Installing and updating](#installing-and-updating)
- [Security model](#security-model)
- [Hosting requirements](#hosting-requirements)
- [Developing and testing](#developing-and-testing)

## How it fits together

```
phone ──(paired, encrypted relay)──▶ pluginCommands ──▶ installer / updater
                                                          │  registry client (read label, verify digest)
                                                          │  signature check (cosign key)
                                                          ▼
                                        installed_plugin row (pinned digest,
                                        approved manifest, granted permissions)
                                                          │
TV browser ──GraphQL──▶ manager ──▶ sandbox (microVM) ◀──stdio JSON-RPC──▶ plugin process
```

| Piece                                                        | Where                                               |
| ------------------------------------------------------------ | --------------------------------------------------- |
| Manifest schema, permissions, domain rules                   | `src/lib/plugins/manifest.ts`                       |
| Image reference parsing (compose-style)                      | `src/lib/plugins/imageRef.ts`                       |
| Protocol methods, framing                                    | `src/lib/plugins/host.ts`, `ndjson.ts`              |
| Protocol as JSON Schema                                      | `docs/plugin-protocol.schema.json`                  |
| Registry client, signature verification                      | `src/api/plugins/registry.ts`, `signature.ts`       |
| Install / configure / uninstall, updates                     | `src/api/plugins/installer.ts`, `updater.ts`        |
| Running plugins, per-profile binding                         | `src/api/plugins/manager.ts`, `runtime.ts`          |
| Sandbox spec (permissions → enforcement) and microVM backend | `src/api/plugins/sandbox/`                          |
| What the phone can ask for                                   | `src/api/pluginCommands.ts`, `PluginManager.svelte` |
| The installed set                                            | `installed_plugin` table (`src/api/db/schema.ts`)   |

## Writing a plugin

A plugin image has three requirements:

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
	"features": ["dashboard", "screen", "playback", "skipSegments", "auth"],
	"permissions": ["network", "storage", "cache"],
	"network": { "domains": ["www.youtube.com", "*.googlevideo.com"] },
	"entryScreenId": "browse"
}
```

| Field           | Meaning                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------- |
| `id`            | Lowercase letters, digits and dashes. Unique on a device.                                     |
| `protocol`      | The protocol version the plugin speaks. The host refuses a version it doesn't support.        |
| `features`      | What the plugin implements. The host only calls (and only accepts) what's listed. Any subset. |
| `permissions`   | What it asks to be allowed. The user switches each on or off; the host enforces it.           |
| `network`       | The domains the `network` permission covers. Required with `network`, invalid without it.     |
| `entryScreenId` | The screen the app page opens on (for the `screen` feature). Defaults to `main`.              |

**Features** — `dashboard` (cards on the home page), `screen` (a declarative
screen, rendered by the shell), `playback` (resolves session ids to streams),
`skipSegments` (reports skippable stretches), `auth` (publishes a sign-in).

**Permissions** — a fixed set, each enforced by the sandbox:

| Key       | Effect when granted                                                                                                                                |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `network` | Outbound HTTP/HTTPS to exactly the manifest's domains, all together. Nothing else is reachable: not other domains, the LAN, localhost or the host. |
| `storage` | A persistent volume at `/storage`, one per plugin and profile, size-limited, **not encrypted**. Removed when the plugin is uninstalled.            |
| `cache`   | A disposable volume at `/cache`, size-limited. The host may clear it at any time (updates, the user asking).                                       |

A permission that isn't granted simply doesn't exist for the plugin: no
`/storage` directory, no network interface. It has to cope.

**Domains** are an exact host (`api.example.com`) or `*.suffix`, which covers the
suffix itself and everything beneath it. IP addresses, ports, paths, a bare `*`
and over-broad wildcards like `*.com` are rejected. The user is shown this list
verbatim, so list what the plugin really talks to — including hosts it only
hands back to the host (stream URLs, thumbnails): the host refuses to fetch or
display a URL on any other domain.

### The protocol

JSON-RPC 2.0 over the entrypoint's **stdin/stdout, one UTF-8 JSON message per
line**. stderr is the log (the host captures it line by line). Nothing else may
be written to stdout.

The methods, their parameters and results are in
[`plugin-protocol.schema.json`](./plugin-protocol.schema.json), generated from
the schemas the host itself validates with (`bun run plugins:protocol`; a test
fails if the committed file drifts). The sequence:

1. Plugin → host: `plugin/ready` `{ "protocol": 1 }` once it can receive requests.
2. Host → plugin: `host/activate`. The plugin may start publishing.
3. Plugin publishes what its features say (`plugin/publishDashboard`,
   `plugin/publishScreen`, `plugin/publishAuth`); the host answers
   `host/uiEvent`, `host/oauthCode`, `plugin/resolveStream`,
   `plugin/resolveSkipSegments` as the user uses it.
4. Host → plugin: `host/shutdown`; the plugin should exit. It is stopped shortly
   after regardless.

A complete plugin needs no library — this one is a shell script:

```sh
#!/bin/sh
echo '{"jsonrpc":"2.0","method":"plugin/ready","params":{"protocol":1}}'
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  [ -n "$id" ] && printf '{"jsonrpc":"2.0","id":%s,"result":null}\n' "$id"
done
```

TypeScript plugins can use `createStdioConnection()` from
`src/lib/plugins/stdioConnection.ts` with the contract types in
`src/lib/plugins/host.ts` (see `plugins/youtube`). A message larger than 64 MiB is
treated as the plugin misbehaving. What a plugin publishes is validated: a
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
- Everything the plugin should know arrives over the protocol: there are no
  environment secrets.

## Building, signing and publishing

```sh
# 1. Build — attaches the manifest as the label, validated with the host's schema.
#    Run from the repository root; <dir>/Dockerfile is built with the repo as context.
bun run plugin:build plugins/youtube ghcr.io/you/pivi-youtube:0.1.0
# (for other images: docker build --label dev.pivi.manifest="$(jq -c . manifest.json)" ...)

# 2. Push (multi-arch: use buildx so both linux/arm64 and linux/amd64 exist).
docker push ghcr.io/you/pivi-youtube:0.1.0

# 3. Sign with a key pair you keep (generate once: `cosign generate-key-pair`).
cosign sign --key cosign.key --new-bundle-format=false --use-signing-config=false \
  --tlog-upload=false ghcr.io/you/pivi-youtube@sha256:<digest>
```

Publish `cosign.pub` wherever you publish the plugin: **it is what users
install against**. Sign the digest the tag resolves to (for a multi-arch image,
the index digest — what `docker buildx imagetools inspect` prints).

> Only the legacy cosign signature layout (a `sha256-<digest>.sig` tag) signed
> with a **key** is verified. Keyless signatures (Sigstore/Fulcio identities) are
> not accepted: verifying them properly needs certificate-chain and
> transparency-log checks that aren't implemented, and half-checking one would be
> worse than refusing it.

Images are referenced the way a compose file does: a bare `name` or
`owner/name` is on Docker Hub, anything else names its registry
(`ghcr.io/owner/name:1.0`, `registry.example.com:5000/name`). A plugin has to be
installed by tag (it's what updates follow), but runs pinned to the digest that
was verified.

## Installing and updating

From the paired phone: the plugins button in the remote's header.

1. Enter the image and the publisher's public key and press **Review**. The host
   resolves the image, verifies the signature and shows what the plugin asks for —
   permissions, and exactly which domains the network toggle opens — before
   anything is stored or run.
2. Switch off what you don't want to give; **Install** pulls the image and records
   it (pinned by digest, with the key it was verified against).
3. Each installed plugin can be enabled/disabled, set to update automatically, and
   have every permission toggled. A change takes effect by restarting the plugin.

Updates are checked every six hours (and shortly after boot). A new digest is
only trusted if it is signed by the **same key** the plugin was installed with.

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
| A plugin runs only if signed by a key the user supplied            | `signature.ts` (checked at install and at every update)                                     |
| The image that runs is the one that was verified                   | Pinned by digest; registry responses are hashed against their digests                       |
| Network reaches the declared domains only, with no LAN/host access | The microVM's network policy plus TLS interception (`sandbox/microsandbox.ts`)              |
| A plugin can't touch another plugin's or profile's data            | Separate volumes per (plugin, profile)                                                      |
| The host never fetches a URL a plugin returns outside its domains  | `runtime.ts` (`allowsUrl`) and `streamCache.ts`; also public-address check in `urlGuard.ts` |
| What a plugin publishes is bounded                                 | Schema checks, feature gating, image sanitising (`sanitize.ts`)                             |
| Only the paired phone can install or reconfigure plugins           | Handled over the encrypted relay, never as a TV-reachable endpoint                          |

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
bun run plugins:protocol     # regenerate docs/plugin-protocol.schema.json
bun run plugin:build plugins/youtube localhost:5055/pivi-youtube:0.1.0
npx vitest run --project server   # unit tests (a fake in-memory registry, no KVM needed)
```

The end-to-end test (`src/api/plugins/sandbox.e2e.spec.ts`) runs a real signed
image through a real registry and microVM, so it needs KVM and is skipped unless
pointed at one:

```sh
docker run -d -p 127.0.0.1:5055:5000 registry:2          # a local registry (plain HTTP is fine for localhost)
bun run plugin:build plugins/youtube localhost:5055/pivi-youtube:0.1.0
docker push localhost:5055/pivi-youtube:0.1.0
cosign generate-key-pair
cosign sign --key cosign.key --allow-insecure-registry --tlog-upload=false \
  --new-bundle-format=false --use-signing-config=false localhost:5055/pivi-youtube@<digest>

PIVI_E2E_IMAGE=localhost:5055/pivi-youtube:0.1.0 PIVI_E2E_PUBLIC_KEY=cosign.pub \
PIVI_SANDBOX_HOME=/tmp/msbh npx vitest run --project server sandbox.e2e
```
