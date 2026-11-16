{
  config,
  lib,
  pkgs,
  ...
}:

# The appliance itself: what a flashed SD card boots into. Shared by both Pi
# targets (see flake.nix) — anything model-specific lives in the
# nixos-hardware module each of those imports, not here.
#
# Deliberately minimal. This is a television, not a server: no desktop, no
# display manager, no user to log in as. The only thing on the screen is the
# kiosk browser the pivi module starts.
{
  imports = [ ./updates.nix ];

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

  # nixos-hardware's Pi modules default to the downstream Raspberry Pi kernel
  # (`linux-rpi`), which no binary cache carries — a CI run spent 90 minutes
  # compiling it and was still on driver modules when it was cancelled. The
  # mainline kernel is prebuilt for aarch64, which takes the image build from
  # hours to minutes.
  #
  # This is an anticipated configuration rather than a workaround: nixos-hardware's
  # own Pi 5 module inspects `boot.kernelPackages.kernel.pname` and picks its
  # initrd modules accordingly (`rp1_pci`/`pinctrl-rp1` for mainline,
  # `rp1` for the downstream fork), so both variants are supported by the board
  # support we import.
  #
  # The trade-off is media-related and worth knowing before the first playback
  # test: the downstream kernel carries Raspberry Pi's own V4L2 codec drivers,
  # where mainline ships the upstream stateless decoder (HEVC via `rpivid` on Pi
  # 4) and not the downstream H.264 M2M one. Since playback here is Chromium
  # decoding in-page, hardware decode is the thing to verify on real hardware
  # (see DEPLOYMENT.md) — and if it needs the downstream kernel, that means
  # arranging a binary cache for it rather than compiling it per release.
  boot.kernelPackages = pkgs.linuxPackages;

  networking.hostName = "pivi";

  # The Pi's wifi and Bluetooth need Broadcom firmware blobs, without which there
  # is no radio to provision. `hardware.enableRedistributableFirmware` would pull
  # the whole linux-firmware set — well over a gigabyte of blobs for hardware a
  # Raspberry Pi does not have — so name the Pi's own instead. The GPU boot code
  # is separate again and comes from nixos-hardware's firmware module
  # (`raspberrypifw`).
  hardware.firmware = [ pkgs.raspberrypiWirelessFirmware ];

  # nixos-hardware stages the firmware partition itself (its
  # raspberry-pi/common/firmware.nix replaces the sd-image module's version),
  # and copies U-Boot only when asked. Without it the partition has no
  # `kernel=` target and the Pi stops at the firmware: seven green blinks,
  # "kernel image not found". U-Boot is what reads extlinux.conf on the root
  # partition, where NixOS puts its kernels and generations.
  hardware.raspberry-pi.firmware.uboot.enable = true;

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

  # The SD image module (via nixos-generators' sd-aarch64 format) is written for
  # NixOS's generic installer image, and brings two things along that a
  # television has no use for: profiles/base.nix (a rescue toolkit, plus zfs,
  # btrfs, xfs, ntfs and cifs support) and hardware.enableAllHardware (the
  # whole linux-firmware set and initrd drivers for SATA controllers,
  # hypervisors and other boards). sd-image.nix sets the latter itself, hence
  # mkForce, as nixos-hardware's own Pi 1 image does. What the Pi does need is
  # named elsewhere: its initrd drivers come from nixos-hardware, mmc_block from
  # NixOS's default initrd modules, its radio firmware from hardware.firmware
  # above.
  disabledModules = [ "profiles/base.nix" ];
  hardware.enableAllHardware = lib.mkForce false;
  # Booting from a USB SSD, which enableAllHardware used to cover.
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
