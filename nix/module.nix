{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.pivi;

  # Hardcoded in src/lib/wsConfig.ts, which both the relay server and the
  # phone-side client import — it is not configurable at runtime, so this is a
  # mirror of that constant rather than an option. The phone connects to it
  # directly, so unlike the HTTP port it has to be reachable from the LAN.
  pairingWsPort = 5175;

  databaseUrl =
    if cfg.database.url != null then
      cfg.database.url
    else
      "postgres:///${cfg.database.name}?host=/run/postgresql";
in
{
  options.services.pivi = {
    enable = lib.mkEnableOption "the pivi TV shell and phone-remote server";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.pivi;
      defaultText = lib.literalExpression "pkgs.pivi";
      description = ''
        The pivi package. Defaults to `pkgs.pivi`, which this flake's
        `overlays.default` provides — `nixosModules.default` applies that
        overlay for you.
      '';
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 3000;
      description = ''
        Port for the full app, served on loopback only for the local kiosk
        browser.

        The phone remote is served on this same port number, bound to the LAN
        address instead (see {option}`services.pivi.remote.port`). Keeping the
        two equal is what makes the pairing QR code correct, since the app
        derives the URL it shows from the port the kiosk connected on.
      '';
    };

    remote = {
      address = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        example = "192.168.1.20";
        description = ''
          Address to serve the phone remote on. `null` detects the first
          non-loopback IPv4 address at startup, matching how the app picks the
          address it puts in the pairing QR code (src/api/lan.ts).

          Detection happens once, at startup — if this machine's address is
          handed out by DHCP and changes, the service needs a restart. Set
          this (and a DHCP reservation, or a static address) to avoid that.
        '';
      };

      port = lib.mkOption {
        type = lib.types.port;
        default = cfg.port;
        defaultText = lib.literalExpression "config.services.pivi.port";
        description = ''
          Port the phone remote is served on. Only change this if something
          else forwards the port the QR code advertises — see
          {option}`services.pivi.port`.
        '';
      };
    };

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Open the phone remote's HTTP port and the pairing WebSocket port
        (${toString pairingWsPort}) to the network.

        The app's own port is not opened: it is bound to loopback, so the TV
        shell and the GraphQL endpoint are unreachable from the LAN either way.
      '';
    };

    stateDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/lib/pivi";
      description = "Writable directory for the service's own state.";
    };

    database = {
      createLocally = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Run PostgreSQL on this machine and create pivi's database and role,
          authenticated over the local unix socket (no password to manage).
        '';
      };

      name = lib.mkOption {
        type = lib.types.str;
        default = "pivi";
        description = "Database name.";
      };

      url = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        example = "postgres://pivi:secret@db.lan:5432/pivi";
        description = ''
          Connection string, overriding the locally-created database. Note
          that this ends up in the unit's environment and therefore in the
          world-readable store — use a socket-authenticated local database, or
          a credential file, rather than embedding a real password.
        '';
      };

      autoPush = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Push the Drizzle schema to the database before each start
          (`drizzle-kit push --force`).

          On by default because the repo ships no migration files — the schema
          is push-based — so without this a fresh install has no tables at
          all. `--force` means a schema change that Drizzle considers
          destructive is applied without asking, which is tolerable for an
          appliance holding pairing tokens and resume positions, and is not
          what you want once there is data worth keeping. Turn it off and push
          by hand (`pivi-db-push`) at that point.
        '';
      };
    };

    wifi = {
      provisioning = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Let a paired phone put this device onto a wifi network.

          With no known network, the device serves its own WPA2 access point,
          the TV shows how to join it, and the phone's remote gains a wifi
          screen (the device has no keyboard of its own — the phone is the only
          keyboard in the room). Turn this off for a device that is wired, or
          whose network is declared in this configuration.

          Requires NetworkManager, which this enables.
        '';
      };

      interface = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = "wlan0";
        description = ''
          Wireless interface to provision and to serve the setup access point on
          — the Pi's built-in radio, under both Raspberry Pi OS and NixOS.

          Named by default rather than left to NetworkManager because the
          firewall rules the setup access point needs (its DHCP server and DNS
          forwarder, see below) have to be attached to a specific interface.
          Setting this to `null` lets NetworkManager pick the radio, but then
          those ports are *not* opened, and a phone will associate with the
          access point and never receive an address unless you open them
          yourself.
        '';
      };

      hotspot = {
        ssid = lib.mkOption {
          type = lib.types.str;
          default = "pivi-setup";
          description = "SSID of the setup access point.";
        };

        password = lib.mkOption {
          type = lib.types.str;
          default = "pivi-setup";
          description = ''
            Passphrase for the setup access point (WPA2, so at least 8
            characters).

            Not a secret, and deliberately not read from a file: it is printed
            on the television and encoded into the QR code next to it. Its only
            job is keeping the access point closed to casual joins — anyone who
            can read it is already in the room. It ends up world-readable in
            the Nix store, which is fine for exactly that reason and would not
            be for anything else.
          '';
        };
      };
    };

    kiosk = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Run the TV shell fullscreen on this machine's display: a Wayland
          kiosk compositor (cage) with nothing in it but Chromium in kiosk
          mode, started at boot, no desktop or login manager.
        '';
      };

      user = lib.mkOption {
        type = lib.types.str;
        default = "pivi-kiosk";
        description = "User the kiosk session runs as.";
      };

      url = lib.mkOption {
        type = lib.types.str;
        default = "http://127.0.0.1:${toString cfg.port}";
        defaultText = lib.literalExpression ''"http://127.0.0.1:''${toString config.services.pivi.port}"'';
        description = "What the kiosk browser opens.";
      };

      extraChromiumFlags = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [ ];
        example = [ "--force-device-scale-factor=1.25" ];
        description = "Extra flags appended to the Chromium command line.";
      };
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.database.createLocally -> cfg.database.url == null;
        message = "services.pivi: database.url and database.createLocally are mutually exclusive.";
      }
      {
        # The service connects over the local socket as the `pivi` system user,
        # so peer authentication requires a role of that name — and NixOS's
        # `ensureDBOwnership` only grants ownership of the database with the
        # same name as the role.
        assertion = cfg.database.createLocally -> cfg.database.name == "pivi";
        message = "services.pivi: database.name must be \"pivi\" when database.createLocally is set; point database.url at an externally managed database to use a different name.";
      }
    ];

    users.users.pivi = {
      isSystemUser = true;
      group = "pivi";
      home = cfg.stateDir;
    };
    users.groups.pivi = { };

    services.postgresql = lib.mkIf cfg.database.createLocally {
      enable = true;
      ensureDatabases = [ cfg.database.name ];
      ensureUsers = [
        {
          name = "pivi";
          ensureDBOwnership = true;
        }
      ];
    };

    networking.firewall = lib.mkIf cfg.openFirewall {
      allowedTCPPorts = [
        cfg.remote.port
        pairingWsPort
      ];

      # While serving the setup access point, NetworkManager's shared mode runs
      # its own DHCP server and DNS forwarder for whatever phone joins. Without
      # these the phone associates with the AP and then never gets an address,
      # which looks exactly like a broken access point.
      interfaces = lib.optionalAttrs (cfg.wifi.provisioning && cfg.wifi.interface != null) {
        ${cfg.wifi.interface} = {
          allowedUDPPorts = [
            53
            67
          ];
          allowedTCPPorts = [ 53 ];
        };
      };
    };

    networking.networkmanager.enable = lib.mkIf cfg.wifi.provisioning true;

    # The service runs unprivileged, so NetworkManager would refuse it by
    # default. These are the three actions provisioning actually performs —
    # scanning, saving a connection profile, and bringing one up or down — and
    # nothing wider: no general `org.freedesktop.NetworkManager.*` grant, and
    # no ability to change the system's own settings.
    security.polkit.extraConfig = lib.mkIf cfg.wifi.provisioning ''
      polkit.addRule(function(action, subject) {
        if (subject.user !== "pivi") return undefined;
        if (action.id === "org.freedesktop.NetworkManager.wifi.scan" ||
            action.id === "org.freedesktop.NetworkManager.settings.modify.own" ||
            action.id === "org.freedesktop.NetworkManager.settings.modify.system" ||
            action.id === "org.freedesktop.NetworkManager.network-control" ||
            action.id === "org.freedesktop.NetworkManager.enable-disable-wifi" ||
            action.id === "org.freedesktop.NetworkManager.wifi.share.protected") {
          return polkit.Result.YES;
        }
        return undefined;
      });
    '';

    systemd.services.pivi = {
      description = "pivi TV shell and phone-remote server";
      wantedBy = [ "multi-user.target" ];

      # network-online, not just network: the phone-remote listener binds the
      # LAN address, which has to exist before the process starts.
      wants = [ "network-online.target" ];
      after = [
        "network-online.target"
      ] ++ lib.optional cfg.database.createLocally "postgresql.service";
      requires = lib.optional cfg.database.createLocally "postgresql.service";

      environment = {
        DATABASE_URL = databaseUrl;
        NODE_ENV = "production";
        # bun wants a home directory — the plugin host spawns it per plugin
        # (src/api/plugins/manager.ts) and pivi-db-push runs under it. ProtectHome
        # makes the real one unreachable, so point it at the state dir.
        HOME = cfg.stateDir;
        PIVI_HOST = "127.0.0.1";
        PIVI_PORT = toString cfg.port;
        PIVI_REMOTE_PORT = toString cfg.remote.port;
      }
      // lib.optionalAttrs cfg.wifi.provisioning {
        # Pinned rather than found on PATH: the unit's PATH is minimal, and a
        # provisioning flow that silently does nothing because nmcli wasn't
        # found would be a miserable thing to debug on a television.
        PIVI_NMCLI = "${lib.getExe' pkgs.networkmanager "nmcli"}";
        PIVI_HOTSPOT_SSID = cfg.wifi.hotspot.ssid;
        PIVI_HOTSPOT_PASSWORD = cfg.wifi.hotspot.password;
      }
      // lib.optionalAttrs (cfg.wifi.provisioning && cfg.wifi.interface != null) {
        PIVI_WIFI_INTERFACE = cfg.wifi.interface;
      }
      // {
        # src/env.ts validates ORIGIN as present-but-may-be-empty, and
        # adapter-node treats empty as "derive the origin from the request".
        # That is exactly what's needed here: the TV arrives on
        # 127.0.0.1:<port> and the phone on <lan ip>:<port>, two origins for
        # one server, so pinning a single one would break the other's CSRF
        # check and the port in the pairing URL.
        ORIGIN = "";
      } // lib.optionalAttrs (cfg.remote.address != null) { PIVI_REMOTE_HOST = cfg.remote.address; };

      serviceConfig = {
        ExecStartPre = lib.optional cfg.database.autoPush "${cfg.package}/bin/pivi-db-push";
        ExecStart = "${cfg.package}/bin/pivi-server";
        User = "pivi";
        Group = "pivi";
        WorkingDirectory = cfg.stateDir;
        Restart = "on-failure";
        RestartSec = 2;
        # The entry point exits on its own a few seconds after SIGTERM (see
        # deploy/pivi-server.mjs) — no need to sit on systemd's 90s default
        # before concluding something is wrong.
        TimeoutStopSec = 20;

        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectControlGroups = true;
        RestrictSUIDSGID = true;
        ReadWritePaths = [ cfg.stateDir ];
      };
    };

    # Chromium is the video decoder here: playback is MSE/shaka inside the
    # page (src/lib/mse/dualTrackPlayer.ts), not a separate player process. So
    # the kiosk browser is what needs GPU access, and these flags are the
    # difference between hardware-decoded 1080p and a slideshow on a Pi.
    services.cage = lib.mkIf cfg.kiosk.enable {
      enable = true;
      user = cfg.kiosk.user;
      program =
        let
          flags = [
            "--kiosk"
            "--ozone-platform=wayland"
            "--enable-features=VaapiVideoDecoder,VaapiVideoDecodeLinuxGL"
            "--ignore-gpu-blocklist"
            "--enable-gpu-rasterization"
            # No user gesture ever happens on a TV — input arrives over the
            # pairing WebSocket, which the autoplay heuristics don't count.
            "--autoplay-policy=no-user-gesture-required"
            "--noerrdialogs"
            "--disable-infobars"
            "--disable-session-crashed-bubble"
            "--user-data-dir=/var/lib/pivi-kiosk"
          ] ++ cfg.kiosk.extraChromiumFlags;
        in
        pkgs.writeShellScript "pivi-kiosk" ''
          exec ${lib.getExe pkgs.chromium} ${lib.escapeShellArgs flags} ${lib.escapeShellArg cfg.kiosk.url}
        '';
    };

    systemd.services."cage-tty1" = lib.mkIf cfg.kiosk.enable {
      # Without this the kiosk races the server and lands on a connection
      # error page that nothing will ever navigate away from.
      after = [ "pivi.service" ];
      wants = [ "pivi.service" ];
    };

    # `StateDirectory=` would hardcode a name under /var/lib and silently
    # disagree with a customised stateDir, so create it here instead.
    systemd.tmpfiles.rules = [
      "d ${cfg.stateDir} 0750 pivi pivi - -"
    ] ++ lib.optional cfg.kiosk.enable "d /var/lib/pivi-kiosk 0700 ${cfg.kiosk.user} ${cfg.kiosk.user} - -";

    users.users.${cfg.kiosk.user} = lib.mkIf cfg.kiosk.enable {
      isNormalUser = true;
      group = cfg.kiosk.user;
      # video/render for GPU access, audio for HDMI sound.
      extraGroups = [
        "video"
        "render"
        "audio"
      ];
    };
    users.groups.${cfg.kiosk.user} = lib.mkIf cfg.kiosk.enable { };

    hardware.graphics.enable = lib.mkIf cfg.kiosk.enable true;
  };
}
