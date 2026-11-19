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

  # The setup AP's captive portal (deploy/pivi-server.mjs): port 80 on the AP's
  # interface is redirected to it. Not an option, since nothing outside this
  # module ever addresses it. The address is NetworkManager's shared-mode
  # default, pinned by the AP profile in src/api/wifi.ts.
  captivePort = 3080;
  hotspotAddress = "10.42.0.1";
  captivePortal = cfg.wifi.provisioning && cfg.wifi.interface != null;

  # A cursor theme whose every cursor is a single transparent pixel. cage draws
  # its own cursor wherever there's a pointer device (a plugged-in mouse, or a
  # TV's HDMI-CEC/USB receiver that presents itself as one), and the page's
  # `cursor: none` (src/routes/layout.css) reaches only what Chromium draws.
  hiddenCursorTheme =
    pkgs.runCommand "pivi-hidden-cursor"
      {
        nativeBuildInputs = [
          pkgs.python3
          pkgs.xcursorgen
        ];
      }
      ''
        # A 1x1 fully transparent PNG, written by hand to keep an image tool out
        # of the build.
        python3 - <<'PNG'
        import struct, zlib
        def chunk(kind, data):
            body = kind + data
            return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))
        png = b"\x89PNG\r\n\x1a\n"
        png += chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
        png += chunk(b"IDAT", zlib.compress(b"\x00\x00\x00\x00\x00"))
        png += chunk(b"IEND", b"")
        open("blank.png", "wb").write(png)
        PNG
        echo "1 0 0 blank.png" > blank.cfg

        dir=$out/share/icons/pivi-hidden
        mkdir -p $dir/cursors
        printf '[Icon Theme]\nName=pivi-hidden\n' > $dir/index.theme
        xcursorgen blank.cfg $dir/cursors/default
        # The names wlroots and Chromium ask for, old X11 ones included.
        for name in left_ptr arrow pointer hand1 hand2 text xterm wait watch \
          progress left_ptr_watch crosshair cross grab grabbing fleur move \
          all-scroll not-allowed help question_arrow col-resize row-resize; do
          ln -s default $dir/cursors/$name
        done
      '';

  databaseUrl =
    if cfg.database.url != null then
      cfg.database.url
    else
      "postgres:///${cfg.database.name}?host=/run/postgresql";

  # The repository's pivi.toml is the source of the defaults; the service gets
  # its own file, written from the options (src/api/config.ts reads it).
  defaults = lib.importTOML ../pivi.toml;
  configFile = (pkgs.formats.toml { }).generate "pivi.toml" {
    apps.suggested = cfg.suggestedApps;
  };

  # What the kiosk opens first, handing over to kiosk.url once it answers (see
  # the file itself).
  kioskSplash = pkgs.replaceVars ./kiosk-splash.html {
    url = builtins.toJSON cfg.kiosk.url;
    logo = builtins.readFile ../static/favicon.svg;
  };

  # Widevine, for DRM protected streams. Its license doesn't allow shipping it
  # in published images, so each device fetches it from Google itself (see
  # pivi-widevine below), at the version and hash nixpkgs pins.
  widevineDir = "/var/lib/pivi-widevine";
  widevineSrc = pkgs.widevine-cdm.src;
  # Chromium looks for the CDM next to its own binary, this points it at
  # where the device installs it.
  widevineOnDevice = pkgs.runCommand "widevine-cdm-on-device" { } ''
    mkdir -p $out/share/google/chrome
    ln -s ${widevineDir}/WidevineCdm $out/share/google/chrome/WidevineCdm
  '';
  kioskChromium = pkgs.chromium.override {
    enableWideVine = true;
    widevine-cdm = widevineOnDevice;
  };
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

    suggestedApps = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = defaults.apps.suggested;
      defaultText = lib.literalExpression "apps.suggested from the repository's pivi.toml";
      example = [ "ghcr.io/example/pivi-app:1.2.0" ];
      description = ''
        App images offered for one-tap install on the TV's apps screen. Only
        image references: each app's name, icon and description are read from
        its own manifest in the registry.
      '';
    };

    stateDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/lib/pivi";
      description = "Writable directory for the service's own state.";
    };

    sandbox = {
      home = lib.mkOption {
        type = lib.types.path;
        default = "${cfg.stateDir}/sandbox";
        defaultText = lib.literalExpression ''"''${config.services.pivi.stateDir}/sandbox"'';
        description = ''
          Where the plugin sandbox keeps its downloaded images, volumes (each
          plugin's storage and cache) and per-sandbox sockets.

          Keep this path short: the sandbox runtime derives unix socket paths
          from it, and the kernel limits those to 107 bytes.
        '';
      };
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
          Apply the generated Drizzle migrations (`drizzle-kit migrate`)
          before each start. On by default so a fresh install gets its tables
          and an upgrade gets its schema changes. Already applied migrations
          are skipped, and nothing is dropped unless a migration says so. Turn
          it off to run `pivi-db-migrate` by hand.
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
          type = lib.types.nullOr lib.types.str;
          default = null;
          description = ''
            Passphrase for the setup access point (WPA2, so at least 8
            characters). Left unset, a random one is generated on every boot,
            so there is no well-known default; it is shown on the television
            either way.

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
        description = ''
          What the kiosk browser shows. It opens a local splash screen first,
          which hands over to this URL as soon as it answers.
        '';
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
      {
        # The sandbox runtime builds unix socket paths under this directory, and
        # the kernel rejects any over 107 bytes; the runtime adds roughly 50.
        assertion = builtins.stringLength (toString cfg.sandbox.home) <= 55;
        message = "services.pivi: sandbox.home is too long (the sandbox runtime's socket paths would exceed the 107-byte unix socket limit); use a shorter path.";
      }
    ];

    users.users.pivi = {
      isSystemUser = true;
      # The sandbox runs plugins as KVM guests, which needs /dev/kvm.
      extraGroups = [ "kvm" ];
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
      interfaces = lib.optionalAttrs captivePortal {
        ${cfg.wifi.interface} = {
          allowedUDPPorts = [
            53
            67
          ];
          allowedTCPPorts = [
            53
            captivePort
          ];
        };
      };

      # Port 80 is where a joining phone sends its captive-portal probe. In a
      # chain of its own, so a firewall reload replaces the rule rather than
      # adding a second one.
      extraCommands = lib.mkIf captivePortal ''
        iptables -t nat -N pivi-captive 2>/dev/null || iptables -t nat -F pivi-captive
        iptables -t nat -C PREROUTING -j pivi-captive 2>/dev/null || iptables -t nat -A PREROUTING -j pivi-captive
        iptables -t nat -A pivi-captive -i ${cfg.wifi.interface} -p tcp --dport 80 -j REDIRECT --to-ports ${toString captivePort}
      '';
      extraStopCommands = lib.mkIf captivePortal ''
        iptables -t nat -D PREROUTING -j pivi-captive 2>/dev/null || true
        iptables -t nat -F pivi-captive 2>/dev/null || true
        iptables -t nat -X pivi-captive 2>/dev/null || true
      '';
    };

    # The other half of the captive portal: the dnsmasq NetworkManager runs for
    # the setup AP answers every name with the device itself, so the probe's
    # host (captive.apple.com and the like) resolves here. There's no internet
    # behind the AP to resolve anything else to.
    environment.etc."NetworkManager/dnsmasq-shared.d/pivi-captive.conf" = lib.mkIf captivePortal {
      text = "address=/#/${hotspotAddress}\n";
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
            action.id === "org.freedesktop.NetworkManager.wifi.share.protected" ||
            action.id === "org.freedesktop.NetworkManager.wifi.share.open") {
          return polkit.Result.YES;
        }
        return undefined;
      });
    '';

    systemd.services.pivi = {
      description = "pivi TV shell and phone-remote server";
      wantedBy = [ "multi-user.target" ];

      # The stream route remuxes with `ffmpeg` from PATH (src/routes/api/stream).
      # Headless: no X11, SDL or other playback outputs, only codecs and network
      # inputs, which is all a remux needs.
      path = [ pkgs.ffmpeg-headless ];

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
        # bun wants a home directory (pivi-db-migrate runs under it). ProtectHome
        # makes the real one unreachable, so point it at the state dir.
        HOME = cfg.stateDir;
        # Apps run as OCI images in microVMs (src/api/apps/sandbox); this is
        # where the runtime keeps its state.
        PIVI_SANDBOX_HOME = toString cfg.sandbox.home;
        PIVI_HOST = "127.0.0.1";
        PIVI_PORT = toString cfg.port;
        PIVI_REMOTE_PORT = toString cfg.remote.port;
        PIVI_CONFIG = toString configFile;
      }
      # For the TV's graphics diagnostics page (src/api/graphicsReport.ts).
      // lib.optionalAttrs cfg.kiosk.enable {
        PIVI_JOURNALCTL = "${config.systemd.package}/bin/journalctl";
        PIVI_EGLINFO = "${pkgs.mesa-demos}/bin/eglinfo";
        PIVI_KIOSK_USER = cfg.kiosk.user;
      }
      // lib.optionalAttrs cfg.wifi.provisioning {
        # Pinned rather than found on PATH: the unit's PATH is minimal, and a
        # provisioning flow that silently does nothing because nmcli wasn't
        # found would be a miserable thing to debug on a television.
        PIVI_NMCLI = "${lib.getExe' pkgs.networkmanager "nmcli"}";
        PIVI_HOTSPOT_SSID = cfg.wifi.hotspot.ssid;
      }
      // lib.optionalAttrs (cfg.wifi.provisioning && cfg.wifi.hotspot.password != null) {
        PIVI_HOTSPOT_PASSWORD = cfg.wifi.hotspot.password;
      }
      // lib.optionalAttrs (cfg.wifi.provisioning && cfg.wifi.interface != null) {
        PIVI_WIFI_INTERFACE = cfg.wifi.interface;
        PIVI_CAPTIVE_PORT = toString captivePort;
      }
      # ORIGIN is deliberately left unset: adapter-node then derives the
      # origin from each request, which is what's needed here since the TV
      # arrives on 127.0.0.1:<port> and the phone on <lan ip>:<port>. An
      # empty string is NOT equivalent: adapter-node 6 throws on it.
      // lib.optionalAttrs (cfg.remote.address != null) { PIVI_REMOTE_HOST = cfg.remote.address; };

      serviceConfig = {
        ExecStartPre = lib.optional cfg.database.autoPush "${cfg.package}/bin/pivi-db-migrate";
        ExecStart = "${cfg.package}/bin/pivi-server";
        User = "pivi";
        Group = "pivi";
        # The graphics diagnostics read the kiosk's journal and ask Mesa what
        # the GPU offers. Mesa's GBM opens the display node too, not just the
        # render node.
        SupplementaryGroups = lib.optionals cfg.kiosk.enable [
          "systemd-journal"
          "render"
          "video"
        ];
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
      # Inherited by Chromium, which reads the same variables for the cursors
      # it draws itself.
      environment = {
        XCURSOR_THEME = "pivi-hidden";
        XCURSOR_PATH = "${hiddenCursorTheme}/share/icons";
      };
      program =
        let
          flags = [
            "--kiosk"
            "--ozone-platform=wayland"
            "--enable-features=VaapiVideoDecoder,VaapiVideoDecodeLinuxGL"
            "--ignore-gpu-blocklist"
            "--enable-gpu-rasterization"
            # After a few GPU process crashes Chromium gives up on the GPU
            # until it restarts, which on a kiosk means until the next reboot.
            "--disable-gpu-process-crash-limit"
            # Why the GPU process failed ends up in the journal, where the TV's
            # graphics diagnostics page shows it.
            "--enable-logging=stderr"
            # No user gesture ever happens on a TV — input arrives over the
            # pairing WebSocket, which the autoplay heuristics don't count.
            "--autoplay-policy=no-user-gesture-required"
            "--noerrdialogs"
            "--disable-infobars"
            "--disable-session-crashed-bubble"
            # The successor of the flag above, which newer Chromium ignores.
            "--hide-crash-restore-bubble"
            "--no-first-run"
            "--no-default-browser-check"
            # The image pins its own Chromium; no "Chromium is out of date"
            # nag between pivi updates.
            "--check-for-update-interval=31536000"
            # No keyring on the kiosk; skip the unlock prompt.
            "--password-store=basic"
            "--user-data-dir=/var/lib/pivi-kiosk"
          ] ++ cfg.kiosk.extraChromiumFlags;
        in
        pkgs.writeShellScript "pivi-kiosk" ''
          board_flags=()
          # Chromium needs OpenGL ES 3.0 since 152 and these GPUs only do 2.0,
          # with no Vulkan to fall back to. Left to try, the GPU process fails
          # and restarts forever, eating the CPU software rendering needs.
          case "$(${pkgs.coreutils}/bin/tr -d '\0' < /proc/device-tree/model 2>/dev/null)" in
            "Raspberry Pi 3"* | "Raspberry Pi Zero 2"*) board_flags+=(--disable-gpu) ;;
          esac
          exec ${lib.getExe kioskChromium} ${lib.escapeShellArgs flags} "''${board_flags[@]}" file://${kioskSplash}
        '';
    };

    # Managed policy (/etc/chromium/policies/managed): every bubble, infobar
    # and permission prompt Chromium can raise switched off, since on a
    # television there's nobody with a mouse to dismiss it. The shell asks for
    # no permissions, so blocking them all costs nothing.
    programs.chromium = lib.mkIf cfg.kiosk.enable {
      enable = true;
      extraOpts = {
        # "Save password?", "Save address?", "Save card?"
        PasswordManagerEnabled = false;
        PasswordLeakDetectionEnabled = false;
        AutofillAddressEnabled = false;
        AutofillCreditCardEnabled = false;
        PaymentMethodQueryEnabled = false;
        # "Translate this page?" and spellcheck underlines in text fields
        TranslateEnabled = false;
        SpellcheckEnabled = false;
        # Sign-in, sync, first-run and promo surfaces
        BrowserSignin = 0;
        SyncDisabled = true;
        PromotionalTabsEnabled = false;
        DefaultBrowserSettingEnabled = false;
        PrivacySandboxPromptEnabled = false;
        UserFeedbackAllowed = false;
        FeedbackSurveysEnabled = false;
        ShoppingListEnabled = false;
        GenAiDefaultSettings = 2;
        # "You are using an unsupported command-line flag" (--ignore-gpu-blocklist)
        CommandLineFlagSecurityWarningsEnabled = false;
        SuppressUnsupportedOSWarning = true;
        # Cast, download, print and memory-saver UI
        EnableMediaRouter = false;
        DownloadRestrictions = 3;
        PrintingEnabled = false;
        HighEfficiencyModeEnabled = false;
        BackgroundModeEnabled = false;
        # Permission prompts: block rather than ask
        DefaultNotificationsSetting = 2;
        DefaultGeolocationSetting = 2;
        DefaultPopupsSetting = 2;
        DefaultSensorsSetting = 2;
        DefaultClipboardSetting = 2;
        DefaultWebBluetoothGuardSetting = 2;
        DefaultWebUsbGuardSetting = 2;
        DefaultSerialGuardSetting = 2;
        DefaultWebHidGuardSetting = 2;
        DefaultFileSystemReadGuardSetting = 2;
        DefaultFileSystemWriteGuardSetting = 2;
        DefaultLocalFontsSetting = 2;
        DefaultWindowManagementSetting = 2;
        AudioCaptureAllowed = false;
        VideoCaptureAllowed = false;
        AutoplayAllowed = true;
      };
    };

    # Installs the Widevine CDM once per pinned version (see widevineOnDevice).
    # Doesn't hold up the kiosk, since an offline TV still has to reach the
    # wifi setup. Being offline at boot is normal before that, hence the
    # endless retries.
    # enableWideVine marks Chromium unfree, though kioskChromium only holds a
    # symlink to the CDM.
    nixpkgs.config = lib.mkIf cfg.kiosk.enable {
      allowUnfreePredicate =
        pkg:
        lib.elem (lib.getName pkg) [
          "chromium"
          "chromium-unwrapped"
        ];
    };

    systemd.services.pivi-widevine = lib.mkIf cfg.kiosk.enable {
      description = "Install the Widevine CDM for DRM playback";
      wantedBy = [ "multi-user.target" ];
      wants = [ "network-online.target" ];
      after = [ "network-online.target" ];
      startLimitIntervalSec = 0;
      path = [
        pkgs.curl
        pkgs.binutils-unwrapped
        pkgs.gnutar
        pkgs.xz
        pkgs.patchelf
        config.nix.package
      ];
      serviceConfig = {
        Type = "oneshot";
        Restart = "on-failure";
        RestartSec = "5min";
      };
      script = ''
        want=${lib.escapeShellArg widevineSrc.outputHash}
        if [ "$(cat ${widevineDir}/hash 2>/dev/null)" = "$want" ]; then exit 0; fi

        mkdir -p ${widevineDir}
        work=$(mktemp -d -p ${widevineDir})
        trap 'rm -rf "$work"' EXIT
        cd "$work"
        curl --fail --silent --show-error --location --retry 3 -o chrome.deb \
          ${lib.escapeShellArg (lib.head widevineSrc.urls)}
        ar x chrome.deb
        tar xf data.tar.* --no-same-owner --no-same-permissions \
          --wildcards './opt/google/chrome/WidevineCdm*'
        # The same check nixpkgs' own fetch makes, before anything is installed.
        got=$(nix --extra-experimental-features nix-command hash path opt/google/chrome/WidevineCdm)
        if [ "$got" != "$want" ]; then
          echo "Widevine CDM hash mismatch: got $got, want $want" >&2
          exit 1
        fi
        # Google builds it for a regular FHS system.
        find opt/google/chrome/WidevineCdm -name '*.so' \
          -exec patchelf --set-rpath ${pkgs.glibc}/lib:${pkgs.stdenv.cc.cc.lib}/lib {} \;
        chmod -R a+rX opt/google/chrome/WidevineCdm
        rm -rf ${widevineDir}/WidevineCdm
        mv opt/google/chrome/WidevineCdm ${widevineDir}/WidevineCdm
        echo "$want" > ${widevineDir}/hash
        # Chromium only loads a CDM when it starts.
        systemctl try-restart cage-tty1.service
      '';
    };

    systemd.services."cage-tty1" = lib.mkIf cfg.kiosk.enable {
      # The splash screen waits for the server either way; ordering after it
      # still keeps the browser's startup off the CPU while the server boots.
      after = [ "pivi.service" ];
      wants = [ "pivi.service" ];
    };

    # The boot log stays on screen (it's the only sign of life on a television
    # until the kiosk is up, and the only diagnostics without SSH), but in the
    # shell's palette rather than the VGA one: slate-950 behind it like the
    # shell and the splash screen after it, so the hand-over is seamless, and
    # indigo/fuchsia for systemd's status markers. Applied as kernel
    # parameters, so it holds from the kernel's first line.
    console.colors = lib.mkIf cfg.kiosk.enable [
      "020617" # black: the background (slate-950)
      "fb7185" # red: FAILED (rose-400)
      "818cf8" # green: OK (indigo-400)
      "fbbf24" # yellow (amber-400)
      "6366f1" # blue (indigo-500)
      "d946ef" # magenta (fuchsia-500)
      "22d3ee" # cyan (cyan-400)
      "94a3b8" # white: regular text (slate-400)
      "475569" # bright black (slate-600)
      "fda4af" # bright red (rose-300)
      "a5b4fc" # bright green (indigo-300)
      "fcd34d" # bright yellow (amber-300)
      "818cf8" # bright blue (indigo-400)
      "e879f9" # bright magenta (fuchsia-400)
      "67e8f9" # bright cyan (cyan-300)
      "f1f5f9" # bright white: highlighted text (slate-100)
    ];
    # No blinking cursor under the log.
    boot.kernelParams = lib.mkIf cfg.kiosk.enable [ "vt.global_cursor_default=0" ];

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
