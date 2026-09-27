{
  config,
  lib,
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
  services.pivi = {
    enable = true;
    # Both are the module's own defaults; stated here because they are the two
    # decisions that define this image. The kiosk is the screen; provisioning
    # is how a device with no keyboard gets onto a network.
    kiosk.enable = true;
    wifi.provisioning = true;
  };

  networking.hostName = "pivi";

  # The Pi's wifi and Bluetooth need the Broadcom firmware blobs, which are
  # redistributable but not free, and are therefore off unless asked for. Wifi
  # provisioning cannot work without this: there is no radio to provision.
  hardware.enableRedistributableFirmware = true;

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

  # Wired networking should just work if a cable is present, so that a device
  # whose wifi provisioning goes wrong still comes up reachable.
  networking.useDHCP = lib.mkDefault true;

  # Keeps the image buildable without a matching nixos-rebuild history. Not a
  # version to bump casually — it is the marker NixOS uses to decide which
  # stateful defaults apply, and moving it can silently change them.
  system.stateVersion = "25.11";

  # The image's own compression. On by default in the sd-image module; stated
  # because the release workflow uploads the `.img.zst` it produces and names
  # the asset after it.
  sdImage.compressImage = lib.mkDefault true;

  assertions = [
    {
      assertion = config.services.pivi.enable;
      message = "nix/image.nix is the pivi appliance image; it makes no sense with services.pivi disabled.";
    }
  ];
}
