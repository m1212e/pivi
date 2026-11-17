{
  lib,
  pkgs,
  ...
}:

# Settings dropped onto the device from outside, read once per boot before
# NetworkManager starts, as Home Assistant OS does: for a radio that can't serve
# the setup access point, a network the setup screen can't join, or getting a
# shell onto a device whose screen shows nothing useful.
#
# Looked for in, first match wins:
#   - a USB stick labelled CONFIG, at its top level
#   - a CONFIG folder on the SD card's FIRMWARE partition (the one a PC shows
#     after flashing a Pi image)
#   - a CONFIG folder on a PC image's EFI system partition (ESP)
#
# Recognised there:
#   - wifi.txt: `ssid=<name>` and `password=<passphrase>` lines (no password
#     line for an open network). Joined like a network picked on the TV.
#   - network/*: NetworkManager keyfiles, for anything wifi.txt can't say
#     (hidden networks, static addresses, enterprise wifi). Same layout as
#     Home Assistant OS's CONFIG stick.
#   - authorized_keys: SSH public keys for root. Physical access already
#     means control of the device (it can simply be reflashed), so this gives
#     nothing away that the SD card or disk doesn't.
let
  import = pkgs.writeShellApplication {
    name = "pivi-config-import";
    runtimeInputs = [
      pkgs.coreutils
      pkgs.gnused
      pkgs.util-linux
      pkgs.systemd
    ];
    text = ''
      connections=/etc/NetworkManager/system-connections

      # A USB stick may still be enumerating this early.
      udevadm settle --timeout=10 || true

      mnt=$(mktemp -d)
      trap 'umount "$mnt" 2>/dev/null || true; rmdir "$mnt"' EXIT

      found=
      for label in CONFIG FIRMWARE ESP; do
        dev=/dev/disk/by-label/$label
        [ -e "$dev" ] || continue
        mount -o ro "$dev" "$mnt" 2>/dev/null || continue
        dir=$mnt
        [ "$label" = CONFIG ] || dir=$mnt/CONFIG
        if [ -d "$dir" ]; then
          found=$dir
          echo "reading settings from $label"
          break
        fi
        umount "$mnt"
      done
      [ -n "$found" ] || exit 0

      install -d -m 700 "$connections"

      if [ -f "$found/wifi.txt" ]; then
        field() { sed -n "s/^$1=//p" "$found/wifi.txt" | tr -d '\r' | head -n 1; }
        ssid=$(field ssid)
        password=$(field password)
        if [ -n "$ssid" ]; then
          {
            printf '[connection]\nid=%s\ntype=wifi\n\n' "$ssid"
            printf '[wifi]\nmode=infrastructure\nssid=%s\n\n' "$ssid"
            if [ -n "$password" ]; then
              printf '[wifi-security]\nkey-mgmt=wpa-psk\npsk=%s\n\n' "$password"
            fi
            printf '[ipv4]\nmethod=auto\n\n[ipv6]\nmethod=auto\n'
          } > "$connections/pivi-config-wifi.nmconnection"
          chmod 600 "$connections/pivi-config-wifi.nmconnection"
          echo "imported wifi network $ssid"
        fi
      fi

      for file in "$found"/network/*; do
        [ -f "$file" ] || continue
        name=$(basename "$file" .nmconnection)
        install -m 600 "$file" "$connections/$name.nmconnection"
        echo "imported connection $name"
      done

      if [ -f "$found/authorized_keys" ]; then
        install -d -m 700 /root/.ssh
        install -m 600 "$found/authorized_keys" /root/.ssh/authorized_keys
        echo "imported SSH keys for root"
      fi
    '';
  };
in
{
  systemd.services.pivi-config-import = {
    description = "Import network settings and SSH keys from a CONFIG stick";
    wantedBy = [ "multi-user.target" ];
    before = [ "NetworkManager.service" ];
    after = [ "local-fs.target" ];
    serviceConfig = {
      Type = "oneshot";
      ExecStart = lib.getExe import;
    };
  };
}
