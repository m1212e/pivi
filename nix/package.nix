{
  lib,
  stdenvNoCC,
  bun,
  nodejs,
  makeWrapper,
  yt-dlp,
  cacert,
}:

let
  # Read from package.json rather than restated here, so `npm version` (which is
  # what tags a release, and therefore what triggers the image build) can't leave
  # the two disagreeing.
  version = (lib.importJSON ../package.json).version;

  # `bun install` needs the network, which a normal derivation doesn't get. So
  # it runs as a fixed-output derivation instead: network in exchange for the
  # output being pinned by hash.
  #
  # That hash has to be updated whenever bun.lock changes. `nix build` prints
  # the correct value in the mismatch error — paste it in below.
  nodeModules = stdenvNoCC.mkDerivation {
    pname = "pivi-node-modules";
    inherit version;

    # Only the files that can affect resolution, so editing app code doesn't
    # invalidate a ~1GB dependency tree.
    src = lib.fileset.toSource {
      root = ../.;
      fileset = lib.fileset.unions [
        ../package.json
        ../bun.lock
        ../.npmrc
      ];
    };

    nativeBuildInputs = [ bun ];

    dontConfigure = true;
    # Fixup would rewrite shebangs and strip binaries inside node_modules,
    # which changes the output bytes and therefore the hash.
    dontFixup = true;

    buildPhase = ''
      runHook preBuild

      export HOME=$TMPDIR
      export SSL_CERT_FILE=${cacert}/etc/ssl/certs/ca-bundle.crt

      # --ignore-scripts: postinstall scripts are the main source of
      # non-reproducibility here (and of surprise network access). Nothing in
      # this tree needs one — the platform-specific native binaries
      # (@esbuild/*, @rolldown/*, lightningcss) come from the lockfile as
      # their own packages, not from a postinstall download.
      bun install \
        --frozen-lockfile \
        --no-progress \
        --ignore-scripts

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      # bun's own cache records absolute paths — it would make the hash
      # depend on the build directory.
      rm -rf node_modules/.cache
      cp -R node_modules $out
      runHook postInstall
    '';

    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash = lib.fakeHash;
  };
in
stdenvNoCC.mkDerivation {
  pname = "pivi";
  inherit version;

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../bun.lock
      ../tsconfig.json
      ../vite.config.ts
      ../drizzle.config.ts
      ../src
      ../plugins
      ../static
      ../messages
      # Referenced by relative path from project.inlang/settings.json — see
      # vendor/inlang/README.md for why it isn't a CDN URL any more. Without
      # it the paraglide build step would need network access.
      ../vendor
      ../project.inlang
      ../deploy
    ];
  };

  nativeBuildInputs = [
    bun
    nodejs
    makeWrapper
  ];

  dontConfigure = true;

  buildPhase = ''
    runHook preBuild

    export HOME=$TMPDIR

    cp -R ${nodeModules} node_modules
    chmod -R u+w node_modules
    export PATH=$PWD/node_modules/.bin:$PATH

    # The build writes generated code back into the source tree — paraglide
    # into src/lib/paraglide, and rumble's client generator into
    # src/lib/api/rumbleClient (see src/api/handlers/register.ts).
    chmod -R u+w src

    # Both are validated at startup by src/env.ts's defineEnvVars, which also
    # runs during the build. Neither value is read while building; the real
    # ones come from the systemd unit. ORIGIN is deliberately empty — see the
    # module for why.
    export DATABASE_URL=postgres://pivi@localhost/pivi
    export ORIGIN=

    bun run prepare
    bun run build

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/share/pivi

    # Layout is load-bearing, not cosmetic:
    #   - build/ and plugins/ must stay siblings: the plugin host resolves
    #     entry points as `../../../plugins/<id>/main.ts` relative to its own
    #     bundled chunk (src/api/plugins/manager.ts).
    #   - node_modules must sit at share/pivi/: the adapter-node output is not
    #     a self-contained bundle, and the plugin child processes resolve
    #     their imports by walking up from plugins/<id>/.
    #   - src/ + drizzle.config.ts + tsconfig.json are what `pivi-db-push`
    #     needs (the schema is pushed from src/api/db/schema.ts; the repo has
    #     no migration files).
    cp -R build deploy plugins src node_modules $out/share/pivi/
    cp package.json drizzle.config.ts tsconfig.json $out/share/pivi/

    # Deliberately no --chdir: nothing the server reads is resolved relative
    # to the working directory (the static-asset root included — adapter-node
    # resolves that from its own module URL), so the unit is free to point the
    # working directory at a writable state dir instead of the store.
    makeWrapper ${nodejs}/bin/node $out/bin/pivi-server \
      --add-flags $out/share/pivi/deploy/pivi-server.mjs \
      --prefix PATH : ${lib.makeBinPath [ bun ]} \
      --set-default PIVI_YTDLP_BINARY ${yt-dlp}/bin/yt-dlp

    # The drizzle-kit binary is addressed by path, not via `bun x`: `bun x`
    # would fall back to fetching the package from the network when resolution
    # misses, which a packaged install must never do. Run under bun rather than
    # node because drizzle.config.ts is TypeScript.
    makeWrapper ${bun}/bin/bun $out/bin/pivi-db-push \
      --add-flags "$out/share/pivi/node_modules/drizzle-kit/bin.cjs push --force" \
      --chdir $out/share/pivi

    runHook postInstall
  '';

  passthru = {
    inherit nodeModules;
  };

  meta = {
    description = "Self-hosted Chromecast/Apple-TV alternative for the Raspberry Pi";
    longDescription = ''
      The pivi server: the SvelteKit TV shell, the plugin host, and the phone
      remote's pairing relay. `pivi-server` opens two HTTP listeners — the
      full app on loopback for the local kiosk browser, and only the phone
      remote's paths on the LAN. See deploy/pivi-server.mjs.
    '';
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
    ];
    mainProgram = "pivi-server";
  };
}
