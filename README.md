# Spotifast + AAAVS

A Windows desktop player for local audio files and Spotify that shows the
[AAAVS](https://github.com/LevonFrench/aaavs) music visualizer in a WebView2
window. The audio you hear is the audio the visualizer reacts to.

This is a development prototype, version 0.1.0. There is no installer and no
binary download: you build it from source. Local-file playback and Spotify
library browsing are covered by automated checks. Spotify playback goes through
[librespot](https://github.com/librespot-org/librespot) and has not been
confirmed with a real account; see [the Spotify notes](docs/SPOTIFAST-SPOTIFY.md).

AAAVS is a separate project and is not copied here. This project reads an AAAVS
checkout that sits next to it.

## Layout

| Path | What |
| --- | --- |
| `desktop\spotifast-local` | Native host and audio engine (Rust: wry/tao window, Symphonia, librespot). `vendor\spotifast` holds two MIT files from [crmne/spotifast](https://github.com/crmne/spotifast); see its `PROVENANCE.md`. |
| `src\spotifast-player.ts`, `src\spotifast-spotify.ts` | The page's entry. Imports written `aaavs/...` are the AAAVS source tree. |
| `tools\spotifast-server.mjs`, `tools\spotifast-spotify.mjs` | Loopback sidecar the host starts. It serves the page and uses AAAVS's library server. |
| `tools\project-paths.mjs` | Where AAAVS and the local build data are found. |
| `tools\build-spotifast.ps1`, `tools\build-renderer.mjs` | Builds. |
| `tools\check-*.mjs` | Checks. |
| `docs` | How [local playback](docs/SPOTIFAST-LOCAL-PROTOTYPE.md) and [Spotify](docs/SPOTIFAST-SPOTIFY.md) work, and their limits. |

## What it needs

- Windows 10 or 11, x64, with the Microsoft WebView2 runtime.
- Node.js 24. `node.exe` is copied into a built package.
- A checkout of AAAVS in a sibling folder named `aaavs`, with its packages and
  its preset collection installed:

  ```powershell
  git clone https://github.com/LevonFrench/aaavs
  git clone https://github.com/LevonFrench/spotifast-aaavs
  cd aaavs
  npm ci
  npm run setup
  ```

  This project installs no npm packages of its own. It borrows esbuild,
  TypeScript and playwright-core from the AAAVS checkout. To keep AAAVS
  somewhere else, set `AAAVS_ROOT` to that folder; the type check only supports
  the sibling layout.
- Visual Studio C++ build tools (the x64 MSVC toolset), for the native host.
- A project-local Rust toolchain, for the native host. The build script does
  not use a Rust installation from `PATH`. It expects rustup and cargo under
  `.local\spotifast-prototype\toolchain` and builds offline from the locked
  dependencies, so fetch them once:

  ```powershell
  $env:RUSTUP_HOME = "$PWD\.local\spotifast-prototype\toolchain\rustup"
  $env:CARGO_HOME = "$PWD\.local\spotifast-prototype\toolchain\cargo"
  # Run rustup-init.exe from https://rustup.rs with --no-modify-path, then:
  & "$env:CARGO_HOME\bin\cargo.exe" fetch --locked --manifest-path desktop\spotifast-local\Cargo.toml
  ```

  Use a current stable Rust for `x86_64-pc-windows-msvc`; the crate uses the
  2024 edition. Set `SPOTIFAST_LOCAL` to keep the toolchain, build cache and
  packages in another folder.

## Commands

Run these in the checkout of this repository.

| Command | Does |
| --- | --- |
| `npm run build` | Native host, sidecar and a frozen renderer into `.local\spotifast-prototype\app`. Runs AAAVS's `npm run build:player` first; add `-SkipPlayerBuild` to the script to reuse the existing one. |
| `npm run build:native` | Only the native host. |
| `npm run build:renderer` | Only the page, into `.local\spotifast-prototype\renderer-dev`. |
| `npm run test:native` | The native tests (`cargo test`). |
| `npm run check` | Types against the AAAVS source, the Spotify adapter (no account, no network) and the native engine with a synthetic tone. The last part needs `npm run build:native` first. |
| `npm run check:spotify:browser` | The assembled page in headless Edge with a fixture account. Needs `npm run build:renderer` first. It serves your AAAVS preset collection and checks that your ratings are unchanged afterwards. |
| `npm run check:output` | Plays a quiet synthetic tone and reads the Windows audio meter for the engine process. Needs a working, unmuted output device. |
| `node tools\check-package.mjs` | Starts a built package's sidecar as the host does and checks that it serves. Does not open the window. |

A built package is the executable, `node.exe`, `server\`, a `renderer-<time>`
folder, `renderer-path.txt` and `aaavs-root.txt`. Presets, ratings and settings
are not copied; they are read from the AAAVS folder named in `aaavs-root.txt`.

## Spotify

You connect with your own Spotify developer app: the player asks for its public
Client ID and opens Spotify's sign-in page in your browser. No client secret is
used. Tokens are held in memory while the player runs and are never written to
disk. Playback needs Spotify Premium. The steps are in
[the Spotify notes](docs/SPOTIFAST-SPOTIFY.md).

This project is not affiliated with, sponsored by or endorsed by Spotify.
Spotify is a trademark of Spotify AB. Use of the Spotify Web API and of
librespot is subject to Spotify's terms.

## Licence

The code in this repository is under the MIT licence; see [LICENSE](LICENSE).
The two vendored Spotifast files keep their own MIT notice. Dependencies are
listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
