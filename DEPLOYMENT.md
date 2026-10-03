# Deploying pivi

How the app gets built, started fullscreen on a TV, and exposed to the phone —
the packaging half of SKETCH.md's "OS/deployment" decision, which this file
resolves in favour of Nix.

A package, a NixOS module, and the flashable SD images built from them.

## The two-listener split

Pivi serves two audiences from one SvelteKit app:

- the **TV shell** — `/`, `/home`, `/apps/*`, `/play/*`, `/api/graphql`, the
  streaming proxy routes. For the kiosk browser on the Pi itself and nobody
  else.
- the **phone remote** — `/remote/<pairing token>`, which every phone on the
  wifi has to be able to load.

One listener would mean putting the whole TV shell and the GraphQL endpoint on
the LAN alongside the remote. So `deploy/pivi-server.mjs` opens two listeners
over the same adapter-node request handler:

| Listener     | Bound to           | Serves                                                           |
| ------------ | ------------------ | ---------------------------------------------------------------- |
| TV shell     | `127.0.0.1:<port>` | everything                                                       |
| Phone remote | `<lan ip>:<port>`  | `/remote/*`, `/_app/immutable/*`, `/_app/version.json`, GET/HEAD |

Everything else 404s on the LAN listener. Notably absent from the allowlist:
`/_app/remote/*` (SvelteKit's remote-function endpoint) and `/api/*`. The
remote page needs neither — it's a client-side page that talks to the TV over
the pairing WebSocket — so the whole server-side API surface stays off the
network.

Two details worth knowing before changing any of this:

- **Same port number, different addresses.** The LAN listener binds the LAN
  address specifically rather than `0.0.0.0`, which is what lets it reuse the
  port the loopback listener is on. That matters because `src/hooks.server.ts`
  builds the pairing QR code's URL from `event.url.port` — the port the _TV_
  connected on. Equal ports means the URL it prints is already right for the
  phone. Setting `services.pivi.remote.port` to something else makes the QR
  code advertise an unreachable port, and the server logs a warning saying so.
- **The pairing WebSocket is separate and has to be open.** The relay listens
  on port 5175 on all interfaces, deliberately outside SvelteKit
  (`src/lib/wsConfig.ts`), so the path allowlist above doesn't apply to it.
  The module's `openFirewall` opens it alongside the remote's HTTP port.

Verified against a production build by probing both listeners: `/home`,
`/login`, `/api/graphql` and `/_app/remote/x` all 404 on the LAN address while
returning normally on loopback; `/remote/<token>` and every asset its HTML
references load over the LAN; a `POST` to an allowed path 404s.

## Building

```sh
nix build .#pivi
```

Two things about the first build:

1. **The dependency hashes must match `bun.lock` — one per system.**
   `nix/package.nix` installs dependencies in a fixed-output derivation (`bun
install` needs network access, which a normal derivation doesn't get), so its
   `outputHash` pins the result. There is one per architecture, because the
   lockfile carries platform-specific optional packages (`@esbuild/linux-x64` vs
   `linux-arm64`, rolldown bindings), so the two systems legitimately produce
   different bytes. Whenever `bun.lock` changes, each system's build fails with
   the hash it actually got — paste both in.
2. **Flakes only see tracked files.** `vendor/`, `deploy/`, `nix/` and
   `flake.nix` have to be `git add`ed, or the build will fail on missing
   sources even though they're right there on disk.

The package installs to `share/pivi/`, where the layout is load-bearing:
`build/` and `node_modules` must sit beside each other, because the
adapter-node output is _not_ a self-contained bundle and resolves its imports by
walking up from `build/`. Plugins are not part of the package at all: each is an
OCI image installed at runtime from the phone (see `docs/plugins.md`).

The sandbox runtime inside `node_modules` (the `microsandbox` package: `msb`,
`libkrunfw` and the Node addon) is prebuilt for a conventional Linux, so
`autoPatchelfHook` in `nix/package.nix` rewrites its interpreter and library
paths. Running plugins also needs `/dev/kvm` — the module puts the `pivi` user in
the `kvm` group and points `PIVI_SANDBOX_HOME` at a short directory under the
state dir. Both are untested on a real Pi 4/5 image.

Two binaries come out: `pivi-server` and `pivi-db-push`.

## Running it

```nix
{
  inputs.pivi.url = "github:m1212e/pivi";

  # …
  imports = [ inputs.pivi.nixosModules.default ];

  services.pivi = {
    enable = true;
    # Everything below is the default — shown to say what you're getting.
    port = 3000;              # loopback for the kiosk; the remote reuses the number on the LAN
    openFirewall = true;      # the remote's port + 5175, never the app's
    database.createLocally = true;
    kiosk.enable = true;
  };
}
```

That gives you: PostgreSQL with pivi's database created and socket-authenticated
(no password anywhere), the schema pushed at every start, the server as a
hardened systemd unit, the firewall opened for exactly the remote's two ports,
and Chromium fullscreen on tty1 under `cage` with nothing else on the display.

`services.pivi.database.autoPush` deserves a second look eventually: it runs
`drizzle-kit push --force` before each start. The repo has no migration files —
the schema is push-based — so a fresh install has no tables without it, but
`--force` applies destructive schema changes without asking. Fine for pairing
tokens and resume positions; turn it off and run `pivi-db-push` by hand once
there's data worth keeping.

## Flashable images

`.github/workflows/image.yml` builds them when a GitHub release is published,
and attaches one asset per board:

| Asset                    | Target         |
| ------------------------ | -------------- |
| `pivi-<tag>-pi4.img.zst` | Raspberry Pi 4 |
| `pivi-<tag>-pi5.img.zst` | Raspberry Pi 5 |

Two images rather than one because Pi 4 and Pi 5 need different kernels and
device trees — `nixos-hardware` ships a separate module per generation, and
neither image boots the other's hardware. Flash with `zstd -d` piped into `dd`,
or any imager that reads zstd.

### Image size and the 2 GiB ceiling

GitHub refuses release assets over 2 GiB. The first successful build came out at
2.4 GiB compressed, so the workflow attaches the image to the release only when
it fits, and otherwise leaves it as a workflow artifact (which has no such limit)
with a warning naming the size. A release with no `.img.zst` attached but a green
build means exactly that — check the run's artifacts.

What makes it large, in order: the app's `node_modules` (1.5 GB on disk, shipped
whole because the adapter-node output is not self-contained), Chromium, and the
firmware. The firmware part is already narrowed — `nix/image.nix` installs the
Pi's own wireless blobs rather than `hardware.enableRedistributableFirmware`'s
entire `linux-firmware` set, which is over a gigabyte of blobs for hardware a Pi
does not have.

The remaining lever is shipping production-only dependencies. It isn't a one-liner:
`drizzle-orm`, `svelte` and `@sveltejs/kit` are all declared as devDependencies
while genuinely being needed at runtime (the built server imports them), so a
`bun install --production` tree would be missing them. Fixing that means moving
those declarations first, which changes `bun.lock` and therefore every dependency
hash.

Locally, the same thing:

```sh
nix build .#sd-image-pi4     # aarch64 only; from x86_64 you need binfmt/QEMU
```

Packaging breakage is caught earlier than this, by
`.github/workflows/nix.yml` on every PR: it evaluates the whole flake
(`nix flake check --no-build`, which type-checks every option both Pi
configurations set) and builds `.#pivi` natively on x86_64, then asserts the
installed layout the systemd unit depends on. It deliberately doesn't build the
images — that's this workflow's job, on release.

`nix/image.nix` is what a flashed card boots into: the pivi module with the
kiosk and wifi provisioning on, redistributable firmware (without which the
Pi has no radio to provision), zram swap, and nothing else — no desktop, no
display manager, no account to log in as.

`workflow_dispatch` rebuilds an image without cutting a release, optionally
attaching it to an existing tag. It runs on GitHub's native arm64 runners, free
for public repositories; the workflow comments carry the QEMU fallback for a
private one, which is dramatically slower.

### Before the first release

- **Put your SSH key in `nix/image.nix`.** `users.users.root.openssh.authorizedKeys.keys`
  is an empty list with a commented example. Passwords are off and no account
  has one, so an image built as-is is reachable _only_ through its screen —
  which is a defensible default for an appliance and an awkward one for a Pi
  you are still debugging.
- **Commit a `flake.lock`.** Without it every build resolves nixpkgs afresh, so
  rebuilding the same tag later can produce a different system. The workflow
  warns about this rather than failing, so a first release isn't blocked on it.
- **Keep the dependency hash current** (see Building above). A `bun.lock` change
  without the matching `outputHash` fails both `.github/workflows/nix.yml` and
  the image build here.

### Not yet booted

The images build in CI, but no flashed card has been booted from one. In
particular, combining `nixos-hardware`'s per-board module (which pins the
Raspberry Pi kernel) with `nixos-generators`' `sd-aarch64` format (which assumes
mainline u-boot and `generic-extlinux-compatible`) is the usual community recipe
on Pi 4 but is known to be fiddly on Pi 5. If the Pi 5 image won't boot,
`nixos-raspberrypi` is the flake to reach for instead.

## Wifi provisioning

A Pi plugged into a television has no keyboard, so the phone is the only thing
in the room that can type a wifi password. The bootstrap is the device's own
access point:

1. No known network on boot → the server raises a WPA2 access point through
   NetworkManager's shared mode (`services.pivi.wifi.hotspot.ssid`, default
   `pivi-setup`), which brings its own DHCP server and DNS forwarder with it.
2. The TV shows two QR codes: a `WIFI:` code that phone cameras read as "join
   this network", and — once the AP is up and the remote listener has bound to
   its address — the ordinary pairing URL.
3. The phone pairs over the AP exactly as it would over the house wifi, and its
   remote gains a wifi screen: scan, pick a network, type the password.
4. The device tears the AP down, joins, and the TV's setup screen disappears on
   its own within a few seconds. A failed join puts the AP back up so the
   password can be corrected.

Three things about this are load-bearing:

- **The remote listener rebinds.** The phone reaches the remote at the AP's
  address (`10.42.0.1`), then at a completely different address once the device
  joins the real network. `deploy/pivi-server.mjs` polls for that and moves the
  listener, rather than detecting an address once at startup. Without it the
  flow cannot bootstrap at all.
- **Provisioning is sequential, not concurrent.** The Pi has one radio on one
  channel, and `brcmfmac` cannot reliably be an access point and a station at
  the same time, so joining a network means dropping the AP first. That is why a
  failed join has to restore it explicitly.
- **The phone's wifi commands are answered by the server, not the TV.** They
  arrive over the paired, encrypted relay connection
  (`src/api/wifiCommands.ts`), which is already the trust boundary for "this
  phone may drive this device". Routing them through the TV page would mean
  giving an unauthenticated local browser page a privileged endpoint, and would
  break whenever the TV was showing something else. The TV's own
  `network` GraphQL query is read-only for the same reason.

The service runs unprivileged, so the module grants the `pivi` user exactly six
NetworkManager polkit actions (scan, modify own/system settings,
network-control, enable-disable-wifi, share.protected) — not a blanket
`org.freedesktop.NetworkManager.*`.

Credentials are NetworkManager's to keep: joined networks live in
`/etc/NetworkManager/system-connections`, outside the Nix store, and survive
rebuilds. That makes them imperative state on an otherwise declarative system —
deliberate, since the whole point is that someone configures this from a phone
rather than by editing a config file. Declare the network in NixOS instead
(`networking.networkmanager.ensureProfiles`) and set
`services.pivi.wifi.provisioning = false` if you would rather it stayed
declarative.

### Limitations

- **A network that disappears later doesn't bring the AP back.** The access
  point is raised at startup when there's nothing to join. If the router goes
  away afterwards, NetworkManager retries on its own but nothing re-opens the
  setup AP, so recovery means a restart (or a reboot). A watchdog would fix it;
  there isn't one yet.
- **Enterprise (802.1X) networks are listed but can't be joined.** The list
  reports them as `enterprise`; the phone only collects a passphrase, which
  isn't what they need.
- **Hidden networks aren't reachable from the phone.** The protocol carries a
  `hidden` flag, but nothing in the UI collects a name by hand yet.

### Kernel choice, and why the build is fast

`nix/image.nix` pins the **mainline** kernel rather than the downstream
`linux-rpi` one that `nixos-hardware`'s Pi modules default to. That is a build-time
decision with a runtime consequence, so it is worth stating plainly.

No binary cache carries `linux-rpi`: a release build spent 90 minutes compiling
it and was still working through driver modules when it was cancelled. Mainline
is prebuilt for aarch64, which is the difference between an image in minutes and
an image in hours. (Chromium, by contrast, _is_ cached — it was fetched, not
built, so it costs nothing here.)

`nixos-hardware` supports both: its Pi 5 module reads
`boot.kernelPackages.kernel.pname` and selects initrd modules accordingly.

The consequence is media support. Raspberry Pi's downstream kernel ships their own
V4L2 codec drivers; mainline ships the upstream stateless decoder (HEVC via
`rpivid` on Pi 4) and not the downstream H.264 M2M one. Since playback here is
Chromium decoding in-page, this is exactly what the check below is for. If
hardware decode turns out to need the downstream kernel, the answer is to arrange
a binary cache for it (Cachix, or a remote builder) rather than compiling a kernel
on every release — drop the `boot.kernelPackages` line and expect a long first
build otherwise.

## Hardware video decode is the thing to check first

Playback is MSE/shaka **inside the page** (`src/lib/mse/dualTrackPlayer.ts`) —
there is no separate player process any more. So the kiosk Chromium is the
video decoder, and whether it gets hardware decode on a Pi is the single
biggest risk in this setup. Before tuning anything else, open `chrome://gpu` in
the kiosk and confirm video decode is hardware-accelerated. The module passes
the VA-API flags and puts the kiosk user in `video`/`render`, which is the
starting point, not a guarantee.

This is also why the kiosk runs on the host rather than in a container, and why
the browser is not something the server process launches.

## Known rough edges

- **The LAN address is detected once, at startup.** Both the listener binding
  and the QR code (`src/api/lan.ts`) take the first non-loopback IPv4 address.
  A DHCP lease change needs a service restart. A static address or a DHCP
  reservation avoids it; `services.pivi.remote.address` pins the listener side.
- **The pairing relay starts lazily.** `startPairingRelay()` runs when
  `src/api/handlers/register.ts` is first imported, i.e. on the first request
  that touches GraphQL — in practice when the kiosk loads the shell. A phone
  that connects before the TV has ever rendered gets a refused WebSocket.
- **A relay startup failure kills the server.** It binds its port at module
  load with no error handler, so e.g. a stale process holding 5175 takes the
  whole app down. `Restart=on-failure` is the current backstop.
- **`ORIGIN` is set but empty, on purpose.** `src/env.ts` validates that it
  exists; adapter-node reads empty as "derive the origin from the request".
  That's required here — the TV arrives on `127.0.0.1:<port>` and the phone on
  `<lan ip>:<port>`, two origins for one server, so pinning one would break the
  other.
