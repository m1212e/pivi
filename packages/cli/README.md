# @pivi/cli

Build, test and ship [pivi](https://github.com/m1212e/pivi) apps.

```sh
npx @pivi/cli init my-app     # scaffold (prompts, or flags with --yes)
cd my-app
bun run dev                   # run against a fake pivi host
```

Apps run on Bun (that is what the images use), so `dev` needs `bun` on your PATH. The CLI itself
runs on Node 20 or newer.

## Commands

### `pivi-app init [dir]`

Scaffolds an app: `manifest.json`, `main.ts` (built on `defineApp` from `@pivi/sdk`),
`service.ts`, a test, `Dockerfile`, `.dockerignore`, `tsconfig.json`, and optionally a CI workflow
and files for AI coding agents (`AGENTS.md`, `CLAUDE.md` with the pivi plugin enabled).

Anything not passed as a flag is asked for, unless `--yes` (or no terminal) takes the defaults:

```sh
pivi-app init demo --yes \
  --features dashboard,screen,playback \
  --domains "api.example.com,*.cdn.example.com" \
  --storage --ci github --agent claude
```

Features: `dashboard`, `screen`, `playback`, `skipSegments`, `chat`. CI: `github` (builds multi-arch
and pushes to ghcr.io) or `none`. Agent files: `claude`, `agents` or `none`.

### `pivi-app validate [dir]`

Static checks without running the app: the manifest against the schema the host uses, features
declared without code and code without a declared feature, hosts in the source that
`network.domains` does not allow, hand-written `/storage` paths, writes to stdout, a missing Dockerfile. Exits non-zero on
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
