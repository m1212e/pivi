# @pivi/cli

Build, test and ship [pivi](https://github.com/m1212e/pivi) apps.

```sh
npx @pivi/cli init my-app     # scaffold (prompts, or flags with --yes)
cd my-app
bun run dev                   # run against a fake pivi host
```

Apps are bundled with tsdown into one file and run on Node: `node:26-alpine` in the image, and
your local `node` under `pivi-app dev`, so what you test is what pivi runs. The CLI runs on Node 20
or newer (Node 24 or newer for `dev`, whose network check relies on `NODE_USE_ENV_PROXY`).

## Commands

### `pivi-app init [dir]`

Scaffolds an app: `manifest.json`, `main.ts` (built on `defineApp` from `@pivi/sdk`),
`service.ts`, a test, `tsconfig.json`, and optionally a CI workflow and files for AI coding agents (`AGENTS.md`, `CLAUDE.md` with the pivi plugin enabled).

Anything not passed as a flag is asked for, unless `--yes` (or no terminal) takes the defaults:

```sh
pivi-app init demo --yes \
  --features dashboard,screen,playback \
  --domains "api.example.com,*.cdn.example.com" \
  --storage --ci github --agent claude
```

Features: `dashboard`, `screen`, `playback`, `skipSegments`, `chat`. CI: `github` (publishes to
ghcr.io), `gitlab` (to the project's registry), `gitea` (Gitea and Forgejo, to the instance's
registry) or `none`. Each CI checks the app and runs `pivi-app publish` on a version tag. Agent
files: `claude`, `agents` or `none`.

### `pivi-app validate [dir]`

Static checks without running the app: the manifest against the schema the host uses, features
declared without code and code without a declared feature, hosts in the source that
`network.domains` does not allow, hand-written `/storage` paths, writes to stdout. Exits non-zero on
errors (`--strict`: on warnings too, `--json` for machines).

### `pivi-app dev [dir]`

Starts the app as the host does and gives you a prompt. It validates every message in both
directions against the SDK schemas, remembers what the app published, and routes the app's network
traffic through a local proxy that allows only the manifest's domains, over https, like the
sandbox.

```text
pivi> status                 what is declared and published
pivi> dashboard              the home cards
pivi> screen main            a screen as a tree
pivi> event main reload      press something
pivi> stream <sessionId>     resolveStream, validated and probed
pivi> domains                hosts contacted, and which were blocked
pivi> problems               what the host would reject or drop
```

`--exec "<command>"` (repeatable) runs commands and exits, non-zero when anything is wrong: use it
in scripts, CI and from AI agents. `--watch` restarts on file changes, `--no-enforce` turns the
network rule off, `--entry`, `--locale`.

`/storage` and `/cache` do not exist on your machine, so `PIVI_STORAGE_DIR` and `PIVI_CACHE_DIR`
point into `.pivi-dev/`, for the permissions the manifest requests. `storagePath()` and
`cachePath()` from `@pivi/sdk/storage` follow them.

### `pivi-app publish [dir] <registry/repository[:tag]>`

Builds the image and pushes it to any OCI registry, with no Docker involved: the app and the SDK
are bundled into one file (`/app/main.mjs`) with tsdown and added as one layer on top of
`node:26-alpine`, for
linux/amd64 and linux/arm64. The manifest becomes the `dev.pivi.manifest` label the host reads.

```sh
pivi-app publish ghcr.io/me/my-app          # tags <manifest version> and latest
pivi-app publish localhost:5000/my-app:dev --tag latest
```

- Credentials: `PIVI_REGISTRY_USERNAME` and `PIVI_REGISTRY_PASSWORD` (for the registry published
  to only), or the `auths` of the docker config (`docker login`). Credential helpers are not
  supported. Registries on localhost are spoken to over http.
- Base layers are mounted when the target registry already has the base, copied otherwise, and
  cached in `~/.cache/pivi/blobs`. Blobs the registry already holds are not uploaded again.
- The build is reproducible: the same app gives the same digest.
- The app is validated first, so an image the host would refuse is never pushed.
- `--base <ref>`, `--platform linux/amd64,linux/arm64`, `--conditions <name>` (for bundling inside
  a monorepo), `--tag <tag>` (repeatable).

### `pivi-app build [dir]`

The same image, written as an OCI image layout to `.pivi-dev/image` (or `--out <dir>`) instead of
pushed, for inspecting it or handing it to tools like skopeo or oras.

### `pivi-app manifest [dir]`

Prints the validated manifest on one line: the value of the `dev.pivi.manifest` image label.

```sh
docker build --label "dev.pivi.manifest=$(pivi-app manifest)" -t my-app .
```

## Programmatic use

The harness behind `dev` is a plain class, so tests can drive an app directly:

```ts
import { Harness } from '@pivi/cli';
```

## License

Apache-2.0, see [LICENSE](./LICENSE).
