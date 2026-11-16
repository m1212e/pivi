{
  config,
  lib,
  pkgs,
  ...
}:

# Keeps a flashed appliance current without anyone touching it. CI builds each
# board's whole system on release, pushes it to a binary cache and attaches its
# store path to the release as `pivi-<board>.toplevel`. The device only ever
# downloads that exact, signed build: nothing is evaluated or compiled on the Pi,
# which has neither the memory nor the patience for it.
#
# The switch happens at night, and only when nobody is watching (the server's
# /api/system/busy). After the reboot pivi has to answer within a few minutes,
# or the device rolls back to the previous system and never tries that build
# again.
#
# Not covered: a build so broken it never reaches userspace. The extlinux menu
# on the serial console still offers the previous generations by hand.
let
  cfg = config.services.pivi.updates;
  port = toString config.services.pivi.port;

  stateDir = "/var/lib/pivi-update";
  systemProfile = "/nix/var/nix/profiles/system";

  update = pkgs.writeShellApplication {
    name = "pivi-update";
    runtimeInputs = [
      pkgs.coreutils
      pkgs.curl
      pkgs.jq
      config.nix.package
      config.systemd.package
    ];
    text = ''
      mkdir -p ${stateDir}

      url="https://github.com/${cfg.repository}/releases/latest/download/pivi-${cfg.board}.toplevel"
      if ! target=$(curl -fsSL --max-time 60 "$url"); then
        echo "no release to update to at $url"
        exit 0
      fi
      if [[ ! "$target" =~ ^/nix/store/[a-z0-9]{32}-nixos-system-[A-Za-z0-9._+-]+$ ]]; then
        echo "refusing a malformed store path: $target" >&2
        exit 1
      fi

      if [ "$target" = "$(readlink -f ${systemProfile})" ]; then
        echo "already on $target"
        exit 0
      fi
      if grep -qxF "$target" ${stateDir}/rejected 2>/dev/null; then
        echo "$target failed its health check before, skipping it"
        exit 0
      fi

      # Substituted only: the path has no derivation here, and nix accepts it
      # only signed by a key in trusted-public-keys.
      nix-store --realise "$target"

      # Deferred while someone is watching, but not forever: a TV left on an
      # app screen every night would otherwise never update.
      deferred=$(cat ${stateDir}/deferred 2>/dev/null || echo 0)
      busy=$(curl -fsS --max-time 10 http://127.0.0.1:${port}/api/system/busy | jq -r .busy || echo false)
      if [ "$busy" = true ] && [ "$deferred" -lt ${toString cfg.maxDeferrals} ]; then
        echo $((deferred + 1)) > ${stateDir}/deferred
        echo "the TV is in use, deferring the update to $target"
        exit 0
      fi
      rm -f ${stateDir}/deferred

      nix-env --profile ${systemProfile} --set "$target"
      "$target/bin/switch-to-configuration" boot
      echo "$target" > ${stateDir}/pending
      echo "rebooting into $target"
      systemctl reboot
    '';
  };

  verify = pkgs.writeShellApplication {
    name = "pivi-update-verify";
    runtimeInputs = [
      pkgs.coreutils
      pkgs.curl
      config.nix.package
      config.systemd.package
    ];
    text = ''
      [ -f ${stateDir}/pending ] || exit 0
      pending=$(cat ${stateDir}/pending)

      # Booted something other than the update (picked by hand, or rolled
      # back already): nothing of ours to judge.
      if [ "$(readlink -f /run/current-system)" != "$pending" ]; then
        rm -f ${stateDir}/pending
        exit 0
      fi

      for _ in $(seq 60); do
        if curl -fsS -o /dev/null --max-time 5 http://127.0.0.1:${port}/; then
          rm -f ${stateDir}/pending
          echo "$pending is healthy"
          exit 0
        fi
        sleep 5
      done

      echo "pivi did not come up on $pending, rolling back" >&2
      echo "$pending" >> ${stateDir}/rejected
      rm -f ${stateDir}/pending
      nix-env --profile ${systemProfile} --rollback
      ${systemProfile}/bin/switch-to-configuration boot
      systemctl reboot
    '';
  };
in
{
  options.services.pivi.updates = {
    enable = lib.mkOption {
      type = lib.types.bool;
      default = cfg.cache.publicKey != null;
      defaultText = lib.literalExpression "cache.publicKey != null";
      description = ''
        Install new pivi releases on their own: nightly, when the TV is idle,
        with a rollback if pivi doesn't come up afterwards. On by default once
        a binary cache is configured, since without one there is nothing
        prebuilt to download.
      '';
    };

    board = lib.mkOption {
      type = lib.types.enum [
        "pi3"
        "pi4"
        "pi5"
      ];
      description = "Which board's build to follow, as named in the release assets.";
    };

    repository = lib.mkOption {
      type = lib.types.str;
      default = "m1212e/pivi";
      description = "GitHub repository whose latest release is followed.";
    };

    cache = {
      url = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        example = "https://pivi.cachix.org";
        description = "Binary cache CI pushes each release's system to.";
      };

      publicKey = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        example = "pivi.cachix.org-1:…";
        description = "The cache's signing key. Builds signed by anything else are refused.";
      };
    };

    time = lib.mkOption {
      type = lib.types.str;
      default = "04:00";
      description = "When to look for an update, as a systemd calendar time.";
    };

    maxDeferrals = lib.mkOption {
      type = lib.types.ints.unsigned;
      default = 3;
      description = "Nights an update may wait for an idle TV before it is applied anyway.";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.cache.url != null && cfg.cache.publicKey != null;
        message = "services.pivi.updates needs cache.url and cache.publicKey.";
      }
    ];

    nix.settings = {
      substituters = [ cfg.cache.url ];
      trusted-public-keys = [ cfg.cache.publicKey ];
    };

    # Every update adds a full system to a small SD card. Old generations are
    # the rollback path, so a few stay; the rest are collected.
    boot.loader.generic-extlinux-compatible.configurationLimit = 5;
    nix.gc = {
      automatic = true;
      dates = "weekly";
      options = "--delete-older-than 30d";
    };

    systemd.services.pivi-update = {
      description = "Install the latest pivi release";
      wants = [ "network-online.target" ];
      after = [ "network-online.target" ];
      serviceConfig = {
        Type = "oneshot";
        ExecStart = lib.getExe update;
      };
    };

    systemd.timers.pivi-update = {
      wantedBy = [ "timers.target" ];
      timerConfig = {
        OnCalendar = cfg.time;
        # Spreads a fleet's downloads; one device doesn't mind either way.
        RandomizedDelaySec = "1h";
      };
    };

    systemd.services.pivi-update-verify = {
      description = "Roll back a pivi update that doesn't come up";
      wantedBy = [ "multi-user.target" ];
      after = [ "pivi.service" ];
      serviceConfig = {
        # Not oneshot: its wait for pivi must not hold up multi-user.target.
        Type = "simple";
        ExecStart = lib.getExe verify;
      };
    };
  };
}
