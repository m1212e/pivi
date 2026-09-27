{
  description = "pivi — a self-hosted Chromecast/Apple-TV alternative built on the Raspberry Pi";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    # Board support: each Pi generation needs its own kernel and device tree, so
    # there is no single "Raspberry Pi" image — see the two targets below.
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
      # aarch64 is the deployment target (Pi 4/5); x86_64 is for building and
      # testing the package on a dev machine.
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems =
        f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      # The appliance, per board. Pi 4 and Pi 5 differ by more than a flag —
      # different kernel, different device tree filter — so they are separate
      # configurations producing separate images, not one image with a runtime
      # switch.
      piModules = board: [
        self.nixosModules.default
        ./nix/image.nix
        nixos-hardware.nixosModules."raspberry-pi-${board}"
      ];

      piSystem =
        board:
        nixpkgs.lib.nixosSystem {
          system = "aarch64-linux";
          modules = piModules board;
        };

      sdImage =
        board:
        nixos-generators.nixosGenerate {
          system = "aarch64-linux";
          format = "sd-aarch64";
          modules = piModules board;
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
        # Flashable SD-card images, built by .github/workflows/image.yml on
        # release. aarch64 only: cross-building them from x86_64 needs a
        # binfmt/QEMU setup, which the workflow sidesteps by running on an
        # arm64 runner instead.
        // nixpkgs.lib.optionalAttrs (system == "aarch64-linux") {
          sd-image-pi4 = sdImage "4";
          sd-image-pi5 = sdImage "5";
        }
      );

      # For updating a Pi in place (`nixos-rebuild switch --flake .#pi4
      # --target-host …`) rather than reflashing it.
      nixosConfigurations = {
        pi4 = piSystem "4";
        pi5 = piSystem "5";
      };

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
