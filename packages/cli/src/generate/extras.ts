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
- \`bun run image\`: build the container image as an OCI layout in \`.pivi-dev/image\` (no Docker).
- \`bun run publish -- <registry>/<repository>\`: build and push to any OCI registry, tagged with the
  manifest version and \`latest\`. Credentials: \`PIVI_REGISTRY_USERNAME\` and
  \`PIVI_REGISTRY_PASSWORD\`, or \`docker login\`.

## Rules

- The app runs on Node 26 in pivi (bundled into one file with tsdown), and \`bun run dev\` runs that
  same bundle on Node. Use Node APIs, not Bun's. Bun is only the package manager and test runner.
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
bun run image      # build the image (an OCI layout in .pivi-dev/image), no Docker needed
\`\`\`

Edit \`manifest.json\` to declare what the app is and which hosts it may contact, \`service.ts\` for
the code that talks to ${o.name}, and \`main.ts\` to connect it to pivi.

To install the app, publish it to any OCI registry and enter the printed reference on pivi's Apps
page:

\`\`\`sh
bun run publish -- ghcr.io/<you>/${o.id}
\`\`\`

The image is your \`main.ts\`, bundled with tsdown into one file, on \`node:26-alpine\`, for
linux/amd64 and linux/arm64. The app runs on Node there (and in \`bun run dev\`): don't use Bun APIs.
`;
}

// Every CI file only checks the app and calls `pivi-app publish` on a version tag: the
// build needs no Docker, so the same step runs on every platform's default runner.

function githubWorkflow() {
	return `name: Publish

# Checks the app on every push and pull request. A version tag (v*) publishes the image to
# ghcr.io, tagged with the manifest version and latest. Install it in pivi with the printed
# reference, ghcr.io/<owner>/<repo>:<version>.
on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:

permissions:
  contents: read
  packages: write

jobs:
  app:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run validate
      - run: bun run typecheck
      - run: bun test
      - name: Publish
        if: github.ref_type == 'tag'
        env:
          PIVI_REGISTRY_USERNAME: \${{ github.actor }}
          PIVI_REGISTRY_PASSWORD: \${{ secrets.GITHUB_TOKEN }}
        # Registry paths are lowercase, GitHub owner names need not be.
        run: bun run publish -- "ghcr.io/\${GITHUB_REPOSITORY,,}"
`;
}

const gitlabCi = `# Checks the app on every pipeline. A tag publishes the image to this project's container
# registry, tagged with the manifest version and latest. Install it in pivi with the printed
# reference, $CI_REGISTRY_IMAGE:<version>.
default:
  image: oven/bun:1

stages: [check, publish]

check:
  stage: check
  script:
    - bun install
    - bun run validate
    - bun run typecheck
    - bun test

publish:
  stage: publish
  rules:
    - if: $CI_COMMIT_TAG
  variables:
    PIVI_REGISTRY_USERNAME: $CI_REGISTRY_USER
    PIVI_REGISTRY_PASSWORD: $CI_REGISTRY_PASSWORD
  script:
    - bun install
    - bun run publish -- "$CI_REGISTRY_IMAGE"
`;

function giteaWorkflow() {
	return `name: Publish

# Gitea and Forgejo Actions. Checks the app on every push and pull request. A version tag (v*)
# publishes the image to this instance's container registry, tagged with the manifest version
# and latest. Needs a REGISTRY_TOKEN secret: an access token with package write access.
# runs-on must match a label of your runner.
on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:

jobs:
  app:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run validate
      - run: bun run typecheck
      - run: bun test
      - name: Publish
        if: startsWith(github.ref, 'refs/tags/')
        env:
          PIVI_REGISTRY_USERNAME: \${{ github.actor }}
          PIVI_REGISTRY_PASSWORD: \${{ secrets.REGISTRY_TOKEN }}
          SERVER_URL: \${{ github.server_url }}
        run: bun run publish -- "\${SERVER_URL#*://}/\${GITHUB_REPOSITORY,,}"
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
	if (o.ci === 'gitlab') files['.gitlab-ci.yml'] = gitlabCi;
	if (o.ci === 'gitea') files['.gitea/workflows/publish.yml'] = giteaWorkflow();
	return files;
}
