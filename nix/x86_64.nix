{
  lib,
  pkgs,
  modulesPath,
  ...
}:

# The x86_64 image: one disk image for any 64-bit PC that boots UEFI — the
# Intel N100/N150 class of mini PCs, the Radxa X4 and ODROID-H4, used thin
# clients like the Dell Wyse 5070. Flashed to a USB stick or straight onto the
# machine's own SSD; the root partition grows to fill whichever it lands on.
#
# These are the better playback devices: Intel's and AMD's video blocks decode
# H.264, HEVC and VP9 (and AV1 on newer parts) through VA-API, which Chromium
# uses, where a Pi on the mainline kernel decodes in software.
let
  # Graphics and network firmware for the hardware this class of machine
  # actually has, rather than `hardware.enableRedistributableFirmware`: the
  # whole linux-firmware set is close to 2 GB uncompressed, and the image has
  # to stay under GitHub's 2 GiB release-asset limit (.github/workflows/image.yml).
  firmware =
    let
      src = "${pkgs.linux-firmware}/lib/firmware";
      paths = [
        # GPUs: Intel (i915 for up to Meteor Lake, xe after), AMD (amdgpu, and
        # radeon for the older APUs in thin clients like the HP t630).
        "i915"
        "xe"
        "amdgpu"
        "radeon"
        # Intel wifi and Bluetooth, in nearly every mini PC.
        "intel/iwlwifi"
        "intel/ibt-*"
        # Realtek wifi, Bluetooth and Ethernet (the r8169's RTL8125/8168).
        "rtw88"
        "rtw89"
        "rtlwifi"
        "rtl_bt"
        "rtl_nic"
        # MediaTek wifi and Bluetooth (MT7921/7922/7925).
        "mediatek/WIFI_*"
        "mediatek/BT_RAM_CODE_*"
        "mediatek/mt7925"
      ];
    in
    pkgs.runCommand "pivi-x86_64-firmware" { } ''
      mkdir -p $out/lib/firmware
      cd ${src}
      # Links kept as links; modes not kept, or nothing could be added to a
      # directory once copied out of the read-only store.
      cp -R --parents --no-preserve=mode ${lib.concatStringsSep " " paths} $out/lib/firmware/
      # The old iwlwifi-*.ucode names at the top level are links into
      # intel/iwlwifi, which the driver still asks for.
      cp -P iwlwifi-* $out/lib/firmware/
      # A link pointing outside what was copied (a shared blob, say) would be
      # left dangling: replace those with the file itself.
      cd $out/lib/firmware
      find . -xtype l | while read -r link; do
        cp --remove-destination -L "${src}/$link" "$link"
      done
    '';
in
{
  imports = [ "${modulesPath}/virtualisation/disk-image.nix" ];

  # A raw disk image (GPT, an EFI system partition, systemd-boot, an ext4 root
  # labelled "nixos"), written as is by `dd`, Etcher or GNOME Disks. UEFI only:
  # every machine this targets has it, and the ones that also offer legacy
  # BIOS boot do so as a compatibility mode.
  image.format = "raw";

  # Without this the root partition stays the size of the image, and the first
  # few updates fill it.
  boot.growPartition = true;

  # systemd-boot also installs itself as the removable-media fallback
  # (EFI/BOOT/BOOTX64.EFI), which is what a machine with no boot entry for this
  # disk starts. It must not try to write one either: the image is built in a
  # VM, not on the machine it boots.
  boot.loader.efi.canTouchEfiVariables = false;

  hardware.firmware = [ firmware ];
  hardware.cpu.intel.updateMicrocode = true;
  hardware.cpu.amd.updateMicrocode = true;

  # VA-API for Chromium (module.nix turns on its VA-API decoder). Mesa brings
  # the AMD driver; Intel's comes separately, and this one covers Broadwell
  # and newer, which includes every N-series and Gemini Lake part.
  hardware.graphics.extraPackages = [ pkgs.intel-media-driver ];

  # Storage to find the root on, beyond the NVMe and SATA in NixOS's default
  # initrd set: a USB stick, which is how the image is first tried out, and
  # eMMC, which is what the Radxa X4, Wyse 5070 and most cheap mini PCs boot
  # from.
  boot.initrd.availableKernelModules = [
    "usb_storage"
    "sdhci_pci"
    "sdhci_acpi"
  ];

  # The setup access point is served on `wlan0` (services.pivi.wifi.interface),
  # which is the radio's name on a Pi but not on a PC: there it'd be
  # `wlp2s0` or similar, depending on the slot. The kernel's own names make
  # the one radio `wlan0` again.
  networking.usePredictableInterfaceNames = false;
}
