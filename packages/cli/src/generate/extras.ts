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
- \`bun run image\`: bundle the app and build its image from \`Containerfile\` with buildah (or podman).
- \`bun run publish -- <registry>/<repository>\`: build and push to any OCI registry, tagged with the
  manifest version and \`latest\`. Credentials: \`PIVI_REGISTRY_USERNAME\` and
  \`PIVI_REGISTRY_PASSWORD\`, or \`docker login\`.

## Tools for agents

\`pivi-app mcp\` serves the dev harness as MCP tools (validate, start, status, screen, event, stream,
domains, problems, logs, build)${o.agent === 'claude' ? ', registered for Claude Code in `.mcp.json`' : ''}.
\`bun run dev -- --preview\` also shows the screens in a browser.

## Rules

- The app is bundled into one file with tsdown and runs on Node (\`Containerfile\`), and
  \`bun run dev\` runs that same bundle on Node. Use web standards and \`node:\` built-ins: no
  \`Bun.*\`, no \`Deno.*\`. Bun is the package manager and test runner, not an API.
- Never write to stdout: it is the protocol channel. Use \`app.log\` or \`console.error\`.
- Declare a feature for every handler you add, and add every contacted host to \`network.domains\`.
- Run \`bun run dev\` and check \`problems\` and \`domains\` after every change that touches the network
  or what the app publishes.
`;
}

const claudeMd = '@AGENTS.md\n';

// The dev harness as tools (pivi-app mcp): run the app, read its screens, fire events,
// probe streams, check domains, without parsing terminal output.
const mcpJson = `{
	"mcpServers": {
		"pivi": { "command": "bunx", "args": ["pivi-app", "mcp"] }
	}
}
`;

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

The image is described by \`Containerfile\`: your \`main.ts\`, bundled with tsdown into one file, on
Node, for linux/amd64 and linux/arm64. It is built with buildah (or podman), so one of them
has to be installed. Add RUN steps to the Containerfile for anything else the app needs in the
image; building those for the other architecture needs QEMU (\`qemu-user-static\`).
`;
}

// Every CI file checks the app, and on a version tag runs `pivi-app publish`, which bundles
// the app and builds the image with buildah. GitHub's runners have buildah; in a container
// (GitLab, Gitea/Forgejo) it runs rootless with vfs storage and chroot isolation.

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
      - run: bun run test
      # Only needed for RUN steps in the Containerfile, to run them for arm64.
      - uses: docker/setup-qemu-action@v4
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
stages: [check, publish]

check:
  stage: check
  image: oven/bun:1
  script:
    - bun install
    - bun run validate
    - bun run typecheck
    - bun run test

# buildah's own image, in the job's container. GitLab.com's shared runners allow that. A
# self-hosted runner needs, in its config.toml [runners.docker], either privileged = true or
# security_opt = ["seccomp:unconfined"] and devices = ["/dev/fuse"]. RUN steps in the
# Containerfile for the other architecture also need QEMU registered on the runner host.
publish:
  stage: publish
  image: quay.io/buildah/stable
  rules:
    - if: $CI_COMMIT_TAG
  variables:
    STORAGE_DRIVER: vfs
    BUILDAH_ISOLATION: chroot
    PIVI_REGISTRY_USERNAME: $CI_REGISTRY_USER
    PIVI_REGISTRY_PASSWORD: $CI_REGISTRY_PASSWORD
  before_script:
    - dnf install -y -q nodejs npm
    - npm install -g bun
  script:
    - bun install
    - bun run publish -- "$CI_REGISTRY_IMAGE"
`;

function giteaWorkflow() {
	return `name: Publish

# Gitea and Forgejo Actions. Checks the app on every push and pull request. A version tag (v*)
# publishes the image to this instance's container registry, tagged with the manifest version
# and latest. Needs a REGISTRY_TOKEN secret: an access token with package write access.
# runs-on must match a label of your runner. buildah runs in the job's container, so the runner
# has to allow it: in its config, container.privileged: true, or
# container.options: --security-opt seccomp=unconfined --device /dev/fuse
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
      - run: bun run test
      - name: Publish
        if: startsWith(github.ref, 'refs/tags/')
        env:
          PIVI_REGISTRY_USERNAME: \${{ github.actor }}
          PIVI_REGISTRY_PASSWORD: \${{ secrets.REGISTRY_TOKEN }}
          SERVER_URL: \${{ github.server_url }}
          # The job runs in a container: buildah runs rootless there with these.
          STORAGE_DRIVER: vfs
          BUILDAH_ISOLATION: chroot
        run: |
          command -v buildah >/dev/null || (apt-get update -qq && apt-get install -y -qq buildah)
          bun run publish -- "\${SERVER_URL#*://}/\${GITHUB_REPOSITORY,,}"
`;
}

export function extraFiles(o: InitOptions): Record<string, string> {
	const files: Record<string, string> = { 'README.md': readme(o) };
	if (o.agent !== 'none') files['AGENTS.md'] = agents(o);
	if (o.agent === 'claude') {
		files['CLAUDE.md'] = claudeMd;
		files['.mcp.json'] = mcpJson;
		files['.claude/settings.json'] = claudeSettings;
	}
	if (o.ci === 'github') files['.github/workflows/publish.yml'] = githubWorkflow();
	if (o.ci === 'gitlab') files['.gitlab-ci.yml'] = gitlabCi;
	if (o.ci === 'gitea') files['.gitea/workflows/publish.yml'] = giteaWorkflow();
	return files;
}
