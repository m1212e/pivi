import type { InitOptions } from './options';

const SKILL = 'node_modules/@pivi/sdk/skills/pivi-app/SKILL.md';

function agents(o: InitOptions) {
	return `# ${o.name}, a pivi app

This is an app for pivi, a TV box. It is a small program that the pivi host runs in a sandbox and
talks to over JSON-RPC on stdin/stdout. It sends data (home cards, screens as a tree of nodes)
and answers requests (resolve a stream). The host renders everything.

**Read \`${SKILL}\` first.** It is the guide to building a pivi app,
and \`node_modules/@pivi/sdk/skills/pivi-app/references/protocol.md\` is the exact protocol.
The comments in \`node_modules/@pivi/sdk/src/*.ts\` are the specification of every field.

## Files

- \`manifest.json\`: what the app is, which features it implements, and which hosts it may reach
  (\`network.domains\`). Every host the app contacts must be listed, or it fails silently in pivi.
- \`main.ts\`: connects the app to pivi with \`defineApp\`. Keep it thin.
- \`service.ts\`: everything that talks to ${o.name}, with no protocol code, so it can be tested.

## Commands

- \`bun install\`
- \`bun run dev\`: run the app against a fake pivi host. Try \`status\`, \`dashboard\`, \`screen main\`,
  \`stream <id>\`, \`domains\`, \`problems\`. \`bun run dev -- --exec "stream abc" --exec domains\`
  runs commands once and exits non-zero when the host would reject something.
- \`bun run validate\`: static checks. \`bun test\`, \`bun run typecheck\`.
- \`bun run image\`: build the container image.

## Rules

- Never write to stdout: it is the protocol channel. Use \`app.log\` or \`console.error\`.
- Declare a feature for every handler you add, and add every contacted host to \`network.domains\`.
- Run \`bun run dev\` and check \`problems\` and \`domains\` after every change that touches the network
  or what the app publishes.
`;
}

const claudeMd = '@AGENTS.md\n';

const claudeSettings = `{
	"extraKnownMarketplaces": {
		"pivi": { "source": { "source": "github", "repo": "m1212e/pivi" } }
	},
	"enabledPlugins": { "pivi@pivi": true }
}
`;

function readme(o: InitOptions) {
	return `# ${o.name}

${o.description}. An app for [pivi](https://github.com/m1212e/pivi).

\`\`\`sh
bun install
bun run dev        # run against a fake pivi host, type "help" for commands
bun run validate   # static checks
bun test
bun run image      # build the container image
\`\`\`

Edit \`manifest.json\` to declare what the app is and which hosts it may contact, \`service.ts\` for
the code that talks to ${o.name}, and \`main.ts\` to connect it to pivi.

To install the app, push its image to a registry and enter the image reference on pivi's Apps page.
`;
}

function githubWorkflow() {
	return `name: Publish

# Checks the app on every push and pull request, and publishes the image to ghcr.io when a
# version tag (v*) is pushed. Install it in pivi with the reference ghcr.io/<owner>/<repo>:<version>.
on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:

permissions:
  contents: read
  packages: write

jobs:
  image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run validate
      - run: bun run typecheck
      - run: bun test

      # The host reads the manifest from this label before it pulls or runs anything.
      - id: manifest
        run: |
          echo "label=dev.pivi.manifest=$(bunx pivi-app manifest)" >> "$GITHUB_OUTPUT"
          echo "version=$(jq -r .version manifest.json)" >> "$GITHUB_OUTPUT"

      # Raspberry Pis are arm64 and the host picks its own platform out of the image index.
      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3
      - if: github.event_name != 'pull_request'
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/\${{ github.repository }}
          tags: |
            type=raw,value=\${{ steps.manifest.outputs.version }},enable=\${{ github.ref_type == 'tag' }}
            type=raw,value=latest,enable=\${{ github.ref_type == 'tag' }}
            type=ref,event=branch
      - uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: \${{ github.event_name != 'pull_request' }}
          tags: \${{ steps.meta.outputs.tags }}
          labels: |
            \${{ steps.meta.outputs.labels }}
            \${{ steps.manifest.outputs.label }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
`;
}

export function extraFiles(o: InitOptions): Record<string, string> {
	const files: Record<string, string> = { 'README.md': readme(o) };
	if (o.agent !== 'none') files['AGENTS.md'] = agents(o);
	if (o.agent === 'claude') {
		files['CLAUDE.md'] = claudeMd;
		files['.claude/settings.json'] = claudeSettings;
	}
	if (o.ci === 'github') files['.github/workflows/publish.yml'] = githubWorkflow();
	return files;
}
