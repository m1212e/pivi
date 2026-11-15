# @pivi/cli

Build, test and ship [pivi](https://github.com/m1212e/pivi) apps.

```sh
npx @pivi/cli init my-app     # scaffold (prompts, or flags with --yes)
cd my-app
bun run dev                   # run against a fake pivi host
bun run publish -- ghcr.io/me/my-app
```

The CLI runs on Node 20 or newer (24 or newer for `dev`). Apps are bundled with tsdown into one
file and run on Node (`node:26-alpine`, the project's `Containerfile`); `pivi-app dev` runs that
same bundle on Node, so what you test is what pivi runs. Images are built with **buildah** (or podman), so one of them
has to be installed to build or publish.

## Commands

### `pivi-app init [dir]`

Scaffolds an app: `manifest.json`, `main.ts` (built on `defineApp` from `@pivi/sdk`), `service.ts`,
a test, `Containerfile` and `.containerignore`, `tsconfig.json`, and optionally a CI workflow and
files for AI coding agents (`AGENTS.md`, and for Claude Code `CLAUDE.md`, the pivi plugin and an
`.mcp.json` for `pivi-app mcp`).

Anything not passed as a flag is asked for, unless `--yes` (or no terminal) takes the defaults:

```sh
pivi-app init demo --yes \
  --features dashboard,screen,playback \
  --domains "api.example.com,*.cdn.example.com" \
  --storage --ci github --agent claude
```

- Features: `dashboard`, `screen`, `playback`, `skipSegments`, `chat`.
- CI: `github` (publishes to ghcr.io), `gitlab` (to the project's registry), `gitea` (Gitea and
  Forgejo, to the instance's registry) or `none`. Each checks the app and runs `pivi-app publish`
  on a version tag. On GitLab and Gitea/Forgejo buildah runs in the job's container, which the
  runner has to allow: privileged, or seccomp unconfined plus `/dev/fuse` (the files say how).
- Agent files: `claude`, `agents` or `none`.

### `pivi-app validate [dir]`

Static checks without running the app: the manifest against the schema the host uses, features
declared without code and code without a declared feature, hosts in the source that
`network.domains` does not allow, runtime-only APIs (`Bun.*`, `Deno.*`, `bun:`/`jsr:`/`npm:`
imports), hand-written `/storage` paths, writes to stdout, a Containerfile without an ignore file.
Exits non-zero on errors (`--strict`: on warnings too, `--json` for machines).

### `pivi-app dev [dir]`

Bundles the app, starts it as the host does and gives you a prompt. It validates every message in
both directions against the SDK schemas, remembers what the app published, and routes the app's
network traffic through a local proxy that allows only the manifest's domains, over https, like
the sandbox.

```text
pivi> status                 what is declared and published
pivi> dashboard              the home cards
pivi> screen main            a screen as a tree
pivi> event main reload      press something
pivi> stream <sessionId>     resolveStream, validated and probed
pivi> domains                hosts contacted, and which were blocked
pivi> problems               what the host would reject or drop
```

- `--preview[=port]` serves a page on 127.0.0.1 that renders the screens and home cards and sends
  clicks, toggles and text input back to the app as UI events.
- `--exec "<command>"` (repeatable) runs commands and exits, non-zero when anything is wrong: use
  it in scripts and CI.
- `--watch` restarts on file changes, `--no-enforce` turns the network rule off, `--entry`,
  `--locale`, `--conditions`.
- `/storage` and `/cache` do not exist on your machine, so `PIVI_STORAGE_DIR` and `PIVI_CACHE_DIR`
  point into `.pivi-dev/`, for the permissions the manifest requests. `storagePath()` and
  `cachePath()` from `@pivi/sdk/storage` follow them.

### `pivi-app mcp [dir]`

The dev harness as an MCP server on stdio, for AI agents: `validate`, `start`, `stop`, `status`,
`dashboard`, `screen`, `event`, `stream`, `domains`, `problems`, `logs`, `command` and `build`.
Every answer also carries what the app did since the previous call. Publishing is deliberately not
a tool.

### `pivi-app build [dir]` and `pivi-app publish [dir] <registry/repository[:tag]>`

`build` validates the app, bundles it with tsdown into `.pivi-dev/bundle/main.mjs` and builds the
image from the project's `Containerfile` (or a default one) with buildah, for
linux/amd64 and linux/arm64, into a local manifest list. The manifest becomes the
`dev.pivi.manifest` label the host reads. `--out <dir>` also writes an OCI layout.

`publish` builds and pushes to any OCI registry:

```sh
pivi-app publish ghcr.io/me/my-app          # tags <manifest version> and latest
pivi-app publish localhost:5000/my-app:dev --tag latest
```

- Credentials: `PIVI_REGISTRY_USERNAME` and `PIVI_REGISTRY_PASSWORD`, or buildah's own login
  (`buildah login`, the docker config, credential helpers). Registries on localhost are spoken to
  without TLS.
- Builds are reproducible (`--timestamp 0`): the same input gives the same digest.
- Another runtime than Node: edit the Containerfile's `FROM` and `ENTRYPOINT` by hand (`dev` still
  runs Node).
- A `Containerfile` with only `COPY` needs no emulation for the other platform; `RUN` steps need
  QEMU (`qemu-user-static`).
- `PIVI_BUILDER=buildah|podman` picks the tool, `--platform linux/amd64,linux/arm64` the platforms,
  `--tag <tag>` adds tags (repeatable).

### Signing: `pivi-app keygen [prefix]` and `publish --sign <key>`

`keygen` creates `<prefix>.private` and `<prefix>.pub` (default `pivi-signing`) with skopeo.
`publish --sign <key>` (or `PIVI_SIGNING_KEY`, a path or the key itself, with
`PIVI_SIGNING_PASSPHRASE`) signs the published image in cosign's key-based format, which is what the
pivi host verifies. Give users the `.pub` file: pivi asks for it at install and accepts updates
only signed by the same key. Keys from `cosign generate-key-pair` work too.

### `pivi-app manifest [dir]`

Prints the validated manifest on one line: the value of the `dev.pivi.manifest` image label.

## Settings

Optional, in the app's package.json, so builds need no flags. Flags win over them.

```json
"pivi": {
	"platforms": ["linux/amd64", "linux/arm64"],
	"entry": "main.ts",
	"conditions": []
}
```

## Programmatic use

The harness behind `dev` is a plain class, so tests can drive an app directly:

```ts
import { Harness } from '@pivi/cli';
```

## License

Apache-2.0, see [LICENSE](./LICENSE).
