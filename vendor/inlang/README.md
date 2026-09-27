# Vendored inlang plugin modules

`project.inlang/settings.json` used to load these two modules straight from
jsdelivr. That made every cold build (and any build inside a sandbox — the
Nix package in `nix/`, CI without a warm `project.inlang/cache/`) depend on
network access to a CDN, and pinned only a major version, so the bytes could
change under us without anything in the repo moving.

They're committed here instead and referenced by relative path. Both are
prebuilt single-file bundles published by inlang; nothing here is modified.

| File                           | Source                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| `plugin-message-format.js`     | `https://cdn.jsdelivr.net/npm/@inlang/plugin-message-format@4.4.4/dist/index.js`     |
| `plugin-m-function-matcher.js` | `https://cdn.jsdelivr.net/npm/@inlang/plugin-m-function-matcher@2.2.0/dist/index.js` |

To update, re-download the same paths at the new version, bump the table, and
re-run `bun run build` with `project.inlang/cache/` deleted to confirm the
build still resolves them from disk.
