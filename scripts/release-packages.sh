#!/usr/bin/env bash
# Publishes every package under packages/ whose version is not on npm yet, in
# dependency order (the SDK before the CLI, which has it as a peer). Run by
# .github/workflows/packages.yml on every push to main, so a release is just a
# version bump in the package's package.json.
#
# Packages are packed with `bun pm pack`, which turns `workspace:*` into the real
# version, and the tarball is published with npm, which authenticates through
# trusted publishing (OIDC) and signs it with provenance in CI. Each release is
# tagged `<name>-v<version>` (sdk-v0.1.0) with a GitHub release.
#
#   DRY_RUN=1 scripts/release-packages.sh   show what would happen, publish nothing
set -euo pipefail

PACKAGES=(sdk cli)
root=$(cd "$(dirname "$0")/.." && pwd)
out=$(mktemp -d)
dry_run=${DRY_RUN:-}

for pkg in "${PACKAGES[@]}"; do
	dir="$root/packages/$pkg"
	name=$(jq -r .name "$dir/package.json")
	version=$(jq -r .version "$dir/package.json")
	tag="$pkg-v$version"

	if [ "$(jq -r '.private // false' "$dir/package.json")" = "true" ]; then
		echo "::notice::$name is private, not published"
		continue
	fi

	# 404 means not published. Anything else that fails (network, auth) stops the
	# release, instead of being mistaken for "not published yet".
	if published=$(npm view "$name@$version" version 2>"$out/view.err"); then
		if [ "$published" = "$version" ]; then
			echo "$name@$version is already on npm"
			continue
		fi
	elif ! grep -q E404 "$out/view.err"; then
		cat "$out/view.err" >&2
		echo "::error::could not ask npm whether $name@$version exists"
		exit 1
	fi

	echo "::group::Publishing $name@$version"
	(cd "$dir" && bun run build)
	# The packed manifest drops what only matters inside this repo: tsdown's
	# publishConfig.exports (npm does not use it and warns it will stop accepting it) and the
	# `pivi-source` export condition, whose src/ targets are not all published.
	cp "$dir/package.json" "$out/package.json.orig"
	trap 'cp "$out/package.json.orig" "$dir/package.json"' EXIT
	jq --tab 'del(.publishConfig)
		| if .exports then .exports |= with_entries(.value |= (
			if type == "object" then del(."pivi-source") | (if (keys == ["default"]) then .default else . end) else . end
		)) else . end' "$out/package.json.orig" >"$dir/package.json"
	tarball=$(cd "$dir" && bun pm pack --destination "$out" --quiet | tail -n 1)
	cp "$out/package.json.orig" "$dir/package.json"
	trap - EXIT
	# npm provenance refuses a package whose repository does not match the building repo.
	if [ -n "${CI:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ] &&
		! jq -r '.repository.url // ""' "$dir/package.json" | grep -qi "github.com/$GITHUB_REPOSITORY"; then
		echo "::error::$name: repository.url in package.json must point at github.com/$GITHUB_REPOSITORY for provenance"
		exit 1
	fi
	# Fails before anything is uploaded if a workspace reference survived packing.
	if ! tar -xOzf "$tarball" package/package.json | jq -e '
		([(.dependencies, .devDependencies, .peerDependencies, .optionalDependencies) // {} | .[]
			| select(startswith("workspace:"))] | length == 0)
		and ((.exports // {}) | tostring | contains("pivi-source") | not)' >/dev/null; then
		echo "::error::$name still references workspace: or pivi-source after packing"
		exit 1
	fi

	# Prereleases (1.0.0-beta.1) go to the `next` dist-tag, so `latest` stays stable.
	dist_tag=latest
	case "$version" in *-*) dist_tag=next ;; esac
	flags=(--access public --tag "$dist_tag")
	[ -n "${CI:-}" ] && flags+=(--provenance)

	if [ -n "$dry_run" ]; then
		echo "would publish $tarball ${flags[*]} and tag $tag"
		npm publish "$tarball" "${flags[@]}" --dry-run
	else
		npm publish "$tarball" "${flags[@]}"
		if ! git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
			git tag "$tag"
			git push origin "$tag"
			release_flags=()
			[ "$dist_tag" = next ] && release_flags+=(--prerelease)
			# Never "latest": devices update from the latest release (nix/updates.nix).
			gh release create "$tag" "${release_flags[@]}" --latest=false --title "$name $version" \
				--notes "Published to npm: https://www.npmjs.com/package/$name/v/$version"
		fi
	fi
	echo "::endgroup::"
done
