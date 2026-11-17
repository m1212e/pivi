{
  config,
  lib,
  pkgs,
  ...
}:

# Keeps a flashed appliance current without anyone touching it. CI builds each
# image's whole system on release, pushes it to a binary cache and attaches its
# store path to the release as `pivi-<variant>.toplevel`. The device only ever
# downloads that exact, signed build: nothing is evaluated or compiled on the Pi,
# which has neither the memory nor the patience for it.
#
# Shortly after boot the device looks for a new release and downloads it, and
# the TV offers it after the next login (src/api/systemUpdate.ts): installing
# then only takes a reboot. Left alone, it is installed at night, when nobody
# is watching (the server's /api/system/busy). After the reboot pivi has to
# answer within a few minutes, or the device rolls back to the previous system
# and never tries that build again.
#
# Not covered: a build so broken it never reaches userspace. The boot menu (a
# Pi's extlinux menu on the serial console, systemd-boot's on a PC) still
# offers the previous generations by hand.
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
      # check: download a new release and offer it on the TV (at boot).
      # nightly: the same, then install it if nobody is watching.
      # apply: install what check downloaded (the TV's "update now").
      mode=''${1:-nightly}
      running=$(readlink -f /run/current-system)

      install() {
        rm -f ${stateDir}/available ${stateDir}/deferred
        nix-env --profile ${systemProfile} --set "$1"
        "$1/bin/switch-to-configuration" boot
        echo "$1" > ${stateDir}/pending
        echo "rebooting into $1"
        systemctl reboot
      }

      valid() {
        [[ "$1" =~ ^/nix/store/[a-z0-9]{32}-nixos-system-[A-Za-z0-9._+-]+$ ]]
      }

      if [ "$mode" = apply ]; then
        target=$(jq -r .target ${stateDir}/available 2>/dev/null || true)
        if ! valid "$target" || [ "$target" = "$running" ]; then
          echo "no downloaded update to install"
          exit 0
        fi
        nix-store --realise "$target"
        install "$target"
        exit 0
      fi

      # The tag first, then that tag's file, so a release published in between
      # can't pair one version's name with another's build.
      if ! release=$(curl -fsSL -o /dev/null -w '%{url_effective}' --max-time 60 \
        "https://github.com/${cfg.repository}/releases/latest"); then
        echo "could not reach GitHub"
        exit 0
      fi
      version=''${release##*/}
      url="https://github.com/${cfg.repository}/releases/download/$version/pivi-${cfg.variant}.toplevel"
      if ! target=$(curl -fsSL --max-time 60 "$url"); then
        echo "$version has no build for ${cfg.variant}"
        exit 0
      fi
      if ! valid "$target"; then
        echo "refusing a malformed store path: $target" >&2
        exit 1
      fi

      if [ "$target" = "$running" ]; then
        rm -f ${stateDir}/available
        echo "already on $version"
        exit 0
      fi
      if grep -qxF "$target" ${stateDir}/rejected 2>/dev/null; then
        rm -f ${stateDir}/available
        echo "$target failed its health check before, skipping it"
        exit 0
      fi

      # Substituted only: the path has no derivation here, and nix accepts it
      # only signed by a key in trusted-public-keys.
      nix-store --realise "$target"
      jq -n --arg target "$target" --arg version "$version" '{$target, $version}' \
        > ${stateDir}/available.tmp
      mv ${stateDir}/available.tmp ${stateDir}/available
      echo "$version is downloaded and ready to install"
      [ "$mode" = check ] && exit 0

      # Deferred while someone is watching, but not forever: a TV left on an
      # app screen every night would otherwise never update.
      deferred=$(cat ${stateDir}/deferred 2>/dev/null || echo 0)
      busy=$(curl -fsS --max-time 10 http://127.0.0.1:${port}/api/system/busy | jq -r .busy || echo false)
      if [ "$busy" = true ] && [ "$deferred" -lt ${toString cfg.maxDeferrals} ]; then
        echo $((deferred + 1)) > ${stateDir}/deferred
        echo "the TV is in use, deferring the update to $version"
        exit 0
      fi
      install "$target"
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

    variant = lib.mkOption {
      type = lib.types.enum [
        "aarch64"
        "x86_64"
      ];
      description = "Which image's build to follow, as named in the release assets.";
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
    boot.loader.systemd-boot.configurationLimit = 5;
    nix.gc = {
      automatic = true;
      dates = "weekly";
      options = "--delete-older-than 30d";
    };

    # Readable by pivi, which offers what's in `available` on the TV.
    systemd.tmpfiles.rules = [ "d ${stateDir} 0755 root root - -" ];

    systemd.services.pivi-update = {
      description = "Install the latest pivi release";
      wants = [ "network-online.target" ];
      after = [ "network-online.target" ];
      serviceConfig = {
        Type = "oneshot";
        ExecStart = "${lib.getExe update} nightly";
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

    systemd.services.pivi-update-check = {
      description = "Download the latest pivi release";
      wants = [ "network-online.target" ];
      after = [ "network-online.target" ];
      serviceConfig = {
        Type = "oneshot";
        ExecStart = "${lib.getExe update} check";
      };
    };

    # A device that's switched off with the TV at night still hears about
    # releases. Not right at boot: the network may still be coming up, and
    # pivi and the kiosk have the CPU to themselves for a moment.
    systemd.timers.pivi-update-check = {
      wantedBy = [ "timers.target" ];
      timerConfig.OnBootSec = "2min";
    };

    systemd.services.pivi-update-apply = {
      description = "Install the downloaded pivi release now";
      serviceConfig = {
        Type = "oneshot";
        ExecStart = "${lib.getExe update} apply";
      };
    };

    # The TV's "check for updates" and "update now" (src/api/systemUpdate.ts):
    # pivi may start exactly these two units, nothing else systemd offers.
    security.polkit.extraConfig = ''
      polkit.addRule(function(action, subject) {
        if (subject.user === "pivi" &&
            action.id === "org.freedesktop.systemd1.manage-units" &&
            (action.lookup("unit") === "pivi-update-check.service" ||
             action.lookup("unit") === "pivi-update-apply.service") &&
            action.lookup("verb") === "start") {
          return polkit.Result.YES;
        }
        return undefined;
      });
    '';

    systemd.services.pivi.environment = {
      PIVI_UPDATE_STATE = "${stateDir}/available";
      PIVI_SYSTEMCTL = "${config.systemd.package}/bin/systemctl";
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
