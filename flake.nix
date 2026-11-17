{
  description = "pivi — a self-hosted Chromecast/Apple-TV alternative built on the Raspberry Pi";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    # Raspberry Pi board support, for the aarch64 image.
    nixos-hardware.url = "github:NixOS/nixos-hardware";

    nixos-generators = {
      url = "github:nix-community/nixos-generators";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      nixos-hardware,
      nixos-generators,
    }:
    let
      # Both are deployment targets (see the images below), and x86_64 is also
      # what the package is developed and tested on.
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems =
        f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      # The appliance, one per architecture: an SD card for the Raspberry Pi 3,
      # 4 and 5 (nix/aarch64.nix) and a disk image for UEFI PCs (nix/x86_64.nix).
      # No single image can cover both — they differ in kernel, bootloader and
      # every binary — but within each, one image boots every supported device.
      applianceSystem =
        arch: modules:
        nixpkgs.lib.nixosSystem {
          system = "${arch}-linux";
          modules = [
            self.nixosModules.default
            ./nix/image.nix
            # Which release asset the device follows (nix/updates.nix).
            { services.pivi.updates.variant = arch; }
          ]
          ++ modules;
        };

      # The image format module is part of the system, not a wrapper around it:
      # it supplies the root filesystem (by label, as the flashed disk presents
      # it), which NixOS requires of any bootable configuration. So the image and
      # the system updates install are built from one configuration rather than
      # the image being generated from a second, subtly different one — which
      # also means `nix flake check` validates exactly what gets flashed.
      appliances = {
        aarch64 = applianceSystem "aarch64" [
          # Every board's support: their initrd modules add up, and
          # nix/aarch64.nix settles the one option they disagree on.
          nixos-hardware.nixosModules.raspberry-pi-3
          nixos-hardware.nixosModules.raspberry-pi-4
          nixos-hardware.nixosModules.raspberry-pi-5
          ./nix/aarch64.nix
          nixos-generators.nixosModules.sd-aarch64
          # Left raw: CI compresses it with xz (image.yml), which GNOME Disks,
          # Raspberry Pi Imager and Etcher all flash directly, unlike zstd.
          { sdImage.compressImage = false; }
        ];
        x86_64 = applianceSystem "x86_64" [ ./nix/x86_64.nix ];
      };
    in
    {
      packages = nixpkgs.lib.genAttrs systems (
        system:
        let
          pivi = nixpkgs.legacyPackages.${system}.callPackage ./nix/package.nix { };
        in
        {
          inherit pivi;
          default = pivi;
        }
        # The flashable image for this system's architecture, built by
        # .github/workflows/image.yml on release, natively on each: building
        # the aarch64 one from x86_64 needs a binfmt/QEMU setup and hours.
        // {
          image =
            {
              aarch64-linux = appliances.aarch64.config.system.build.sdImage;
              x86_64-linux = appliances.x86_64.config.system.build.image;
            }
            .${system};
        }
      );

      # For updating a device in place (`nixos-rebuild switch --flake
      # .#aarch64 --target-host …`) rather than reflashing it.
      nixosConfigurations = appliances;

      overlays.default = final: _prev: {
        pivi = final.callPackage ./nix/package.nix { };
      };

      nixosModules.pivi = ./nix/module.nix;

      # The module defaults `services.pivi.package` to `pkgs.pivi`, so the
      # convenient entry point brings the overlay along with it.
      nixosModules.default = {
        imports = [ self.nixosModules.pivi ];
        nixpkgs.overlays = [ self.overlays.default ];
      };

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.bun
            pkgs.nodejs
            pkgs.yt-dlp
          ];
        };
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt-rfc-style);
    };
}
