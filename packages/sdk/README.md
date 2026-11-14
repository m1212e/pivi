# @pivi/sdk

The contract between pivi and its apps. An app is a small
program in an OCI image that talks to the host over JSON-RPC on stdin/stdout.
This package holds everything both sides agree on, as [zod](https://zod.dev)
schemas and TypeScript types, plus the runtime that makes writing an app
a matter of filling in handlers.

```sh
bun add @pivi/sdk zod vscode-jsonrpc
```

`zod` (v4) and `vscode-jsonrpc` (9 or newer) are peer dependencies, so the host
and the SDK never end up with two copies of a schema.

## A minimal app

```ts
// main.ts
import { defineApp } from '@pivi/sdk/app';

defineApp((app) => ({
	// The host allows publishing from now on.
	onActivate() {
		app.publishDashboard({
			cards: [
				{
					kind: 'suggestion',
					id: 'demo',
					title: 'Big Buck Bunny',
					meta: 'Blender Foundation',
					image: 'https://example.com/bunny.jpg',
					action: { type: 'session', sessionId: 'bunny' }
				}
			]
		});
	},

	// The player asks what to play for the session id above.
	resolveStream: ({ sessionId }) => ({
		videoUrl: `https://example.com/${sessionId}.mp4`,
		vcodec: 'h264',
		videoContainer: 'mp4',
		title: 'Big Buck Bunny',
		duration: 596
	})
}));
```

```json
// manifest.json
{
	"id": "demo",
	"name": "Demo",
	"version": "0.1.0",
	"description": "A minimal pivi app",
	"protocol": 2,
	"features": ["dashboard", "playback"],
	"permissions": ["network"],
	"network": { "domains": ["example.com"] }
}
```

The manifest ships as the image label `dev.pivi.manifest`, the user approves its
permissions before the app ever runs, and the sandbox enforces exactly the
domains it lists. Declare a feature for every handler you add, the host only
sends what the manifest declares. `apps/twitch` in the pivi repository is a
complete, real example.

## Entry points

| Import                | What it is                                                                  | Runs in    |
| --------------------- | --------------------------------------------------------------------------- | ---------- |
| `@pivi/sdk`           | Everything below that is browser-safe, re-exported                          | anywhere   |
| `@pivi/sdk/manifest`  | `appManifestSchema`, permissions, features, `MANIFEST_LABEL`                | anywhere   |
| `@pivi/sdk/protocol`  | Every host/app message, `PROTOCOL_VERSION`, `ResolvedStream`                | anywhere   |
| `@pivi/sdk/dashboard` | Home cards and actions (tier 1)                                             | anywhere   |
| `@pivi/sdk/ui`        | Declarative screens (tier 2)                                                | anywhere   |
| `@pivi/sdk/icons`     | The host's icon names                                                       | anywhere   |
| `@pivi/sdk/limits`    | Size caps applied to everything an app sends                                | anywhere   |
| `@pivi/sdk/app`       | `defineApp`, `createStdioConnection`                                        | Node / Bun |
| `@pivi/sdk/schema`    | `buildProtocolDocument()`, the protocol as JSON Schema                      | tooling    |
| `@pivi/sdk/rpc`       | NDJSON framing and the JSON-RPC reader/writer, for hosts and test harnesses | anywhere   |

The protocol as a JSON Schema document is also shipped as
`schema/protocol.schema.json`, for apps in other languages and for tools that
want the whole contract in one file.

## Building apps with an AI assistant

The package ships a skill that teaches coding agents the whole contract: the workflow, the
manifest rules, playback, screens, sign-in patterns, testing and packaging, plus a generated
protocol reference. In Claude Code:

```sh
/plugin marketplace add m1212e/pivi
/plugin install pivi@pivi
```

Other agents can read `node_modules/@pivi/sdk/skills/pivi-app/SKILL.md` directly, and the
TypeScript sources (`node_modules/@pivi/sdk/src`) ship too, because their comments are the
specification.

## Things worth knowing

- **stdout is the protocol channel.** `defineApp` moves `console.log` to
  stderr, which is the log stream the host captures. Never write to stdout
  yourself.
- **Apps are untrusted.** The host validates everything you send against these
  schemas and drops what doesn't fit, so respect the caps in `limits`.
- **Network is deny-by-default.** Only the manifest's `network.domains` are
  reachable. HLS playlists and segments count too: every host they reference
  must be listed.
- **State.** `/storage` is persistent per app and profile (permission
  `storage`), `/cache` may be wiped at any time (permission `cache`).
- **Don't publish before `onActivate`.** Anything sent earlier is dropped.

## Developing in the pivi repository

The package resolves to its TypeScript sources through the `pivi-source`
export condition, so the host, the apps and the tests need no build step.
`bun run sdk:check` builds `dist/` with [tsdown](https://tsdown.dev) and runs
`publint` and `attw` over it, which is what gets published.

## License

Apache-2.0, see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
