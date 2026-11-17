{
  config,
  lib,
  ...
}:

# The appliance itself: what a flashed image boots into. Shared by both images
# (see flake.nix) — anything architecture- or board-specific lives in
# nix/aarch64.nix and nix/x86_64.nix, not here.
#
# Deliberately minimal. This is a television, not a server: no desktop, no
# display manager, no user to log in as. The only thing on the screen is the
# kiosk browser the pivi module starts.
{
  imports = [
    ./updates.nix
    ./config-import.nix
  ];

  services.pivi = {
    enable = true;
    # Both are the module's own defaults; stated here because they are the two
    # decisions that define this image. The kiosk is the screen; provisioning
    # is how a device with no keyboard gets onto a network.
    kiosk.enable = true;
    wifi.provisioning = true;

    # Where CI pushes each release's system (see .github/workflows/image.yml).
    # Setting the key is what turns updates on (nix/updates.nix).
    updates.cache = {
      url = "https://pivi.cachix.org";
      publicKey = "pivi.cachix.org-1:5J+I/bJb4kFakhG6VWSv5ORvIpDsuIjW4R0yaSPJ9NU=";
    };
  };

  networking.hostName = "pivi";

  # The wireless regulatory database. Without it the kernel is stuck on the
  # restrictive worldwide rules even once it learns the country (from the
  # networks around it, or `cfg80211.ieee80211_regdom`) and logs a failure to
  # load it on every boot. The setup AP stays on 2.4 GHz either way, which the
  # worldwide rules allow.
  hardware.wirelessRegulatoryDatabase = true;

  # Chromium on a 2GB Pi 4 with a 1080p video decoded into it is genuinely
  # tight. Compressed swap in RAM costs a little CPU and avoids the OOM killer
  # taking the shell down mid-playback; swapping to the SD card instead would
  # wear it out.
  zramSwap.enable = true;

  # SSH is the only way into this image that isn't the television, and the only
  # way to read a journal when the screen shows nothing useful.
  #
  # Passwords are off and no account has one, so an image built without a key
  # below is reachable *only* through its screen. Put your own public key here
  # before building if you want to be able to get in.
  services.openssh = {
    enable = true;
    settings = {
      PasswordAuthentication = false;
      KbdInteractiveAuthentication = false;
    };
  };

  users.users.root.openssh.authorizedKeys.keys = [
    # "ssh-ed25519 AAAA… you@your-machine"
  ];

  # Port 22 is not opened by the pivi module — it opens only the phone
  # remote's own ports.
  networking.firewall.allowedTCPPorts = [ 22 ];

  # Nothing reads man pages on a device with no shell in front of it, and
  # dropping them takes a sizeable bite out of the image.
  documentation.enable = false;
  documentation.nixos.enable = false;
  documentation.man.enable = false;

  # Booting from a USB SSD (USB Attached SCSI), on either architecture.
  boot.initrd.availableKernelModules = [ "uas" ];

  # Not part of the job: a modem, LVM volumes, sudo (there is no user to
  # elevate, SSH logs in as root), and the perl/rsync/strace NixOS installs by
  # default.
  networking.modemmanager.enable = false;
  services.lvm.enable = false;
  security.sudo.enable = false;
  environment.defaultPackages = [ ];
  # nixos-install, nixos-rebuild and friends. Updates call the new system's
  # switch-to-configuration directly (nix/updates.nix), and a rebuild pushed
  # from a dev machine (`nixos-rebuild --target-host`) runs there, not here.
  system.disableInstallerTools = true;

  # Wired networking should just work if a cable is present, so that a device
  # whose wifi provisioning goes wrong still comes up reachable.
  networking.useDHCP = lib.mkDefault true;

  # Keeps the image buildable without a matching nixos-rebuild history. Not a
  # version to bump casually — it is the marker NixOS uses to decide which
  # stateful defaults apply, and moving it can silently change them.
  system.stateVersion = "25.11";

  assertions = [
    {
      assertion = config.services.pivi.enable;
      message = "nix/image.nix is the pivi appliance image; it makes no sense with services.pivi disabled.";
    }
  ];
}
