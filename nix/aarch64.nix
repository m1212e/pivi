{ lib, pkgs, ... }:

# The aarch64 image: one SD card for the Raspberry Pi 3, Pi 4, Pi 400, Pi 5
# and Pi 500. Imported alongside nixos-hardware's Pi 3, Pi 4 and Pi 5 modules
# and the sd-image format (see flake.nix).
#
# One image serves every board because, on the mainline kernel, almost nothing
# differs between them: the same kernel, the same U-Boot (rpi_arm64_defconfig
# covers every 64-bit Pi) and one config.txt whose `[pi4]`/`[pi5]` sections the
# firmware picks from. The firmware partition already carries every board's
# device trees. What's left is a handful of initrd modules, which the
# nixos-hardware modules contribute between them, and the device tree filter
# below.
#
# The Pi 3 runs everything but the apps: its interrupt controller is not a
# GIC, so there is no KVM for their microVMs.
{
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
  #
  # The latest rather than the LTS kernel: Pi 5 support is still landing
  # upstream, and its Ethernet (behind the RP1) is enabled only from 7.0.
  boot.kernelPackages = pkgs.linuxPackages_latest;

  # The Pi 4 and Pi 5 modules each narrow the device trees to their own SoC, at
  # the same priority, so they'd conflict; the image wants all of them anyway.
  hardware.deviceTree.filter = lib.mkForce null;

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
}
