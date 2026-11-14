# Third-party notices

This repository holds source code only. It ships no binaries, no fonts, no
images and no audio. The notices below cover the third-party code in the
repository and the code a build pulls in.

## Code in this repository

### Spotifast audio output

`desktop/spotifast-local/vendor/spotifast/sink.rs` and `resample.rs` come from
[crmne/spotifast](https://github.com/crmne/spotifast), revision
`d0c2f052030b2f53158f7deb5df8fbba37eb68dc`, under the MIT licence, copyright
(c) 2026 Carmine Paolino. The licence text is in
[`desktop/spotifast-local/vendor/spotifast/LICENSE`](desktop/spotifast-local/vendor/spotifast/LICENSE)
and the local changes are listed in
[`PROVENANCE.md`](desktop/spotifast-local/vendor/spotifast/PROVENANCE.md).
The build copies that licence into a package as `SPOTIFAST-LICENSE.txt`.

## Rust crates built into the native host

Cargo downloads these when the native host is built; none of their source is
in this repository. Versions are the ones locked in
`desktop/spotifast-local/Cargo.lock`. Licences are the ones each crate declares.

| Crate | Version | Licence | Use |
| --- | --- | --- | --- |
| [wry](https://crates.io/crates/wry) | 0.57.1 | Apache-2.0 OR MIT | WebView2 window content |
| [tao](https://crates.io/crates/tao) | 0.37.2 | Apache-2.0 | Window and event loop |
| [rfd](https://crates.io/crates/rfd) | 0.15.4 | MIT | File picker and message box |
| [serde_json](https://crates.io/crates/serde_json) | 1.0.154 | MIT OR Apache-2.0 | Messages between host, engine and sidecar |
| [log](https://crates.io/crates/log) | 0.4.35 | MIT OR Apache-2.0 | Logging facade |
| [thiserror](https://crates.io/crates/thiserror) | 2.0.21 | MIT OR Apache-2.0 | Error types |
| [librespot-core](https://crates.io/crates/librespot-core), [librespot-playback](https://crates.io/crates/librespot-playback) | 0.8.0 | MIT | Spotify session and audio decoding |
| [librespot-metadata](https://crates.io/crates/librespot-metadata) | 0.8.0 | MIT | Tests only |
| [rodio](https://crates.io/crates/rodio) | 0.21.1 | MIT OR Apache-2.0 | Audio output |
| [symphonia](https://crates.io/crates/symphonia) | 0.5.5 | MPL-2.0 | Local-file decoding |
| [tokio](https://crates.io/crates/tokio) | 1.54.1 | MIT | Async runtime for the Spotify session |
| [open](https://crates.io/crates/open) | 5.4.5 | MIT | Opens Spotify pages in the system browser |
| [fastframe-audio](https://github.com/crmne/fastframe) | 0.16.1 (git tag `v0.16.1`) | MIT | Used by the Spotifast output engine |
| [cpal](https://github.com/crmne/cpal) | 0.18.2 (git revision `fcd8b6eb`) | Apache-2.0 | Audio device access, a fork used by fastframe-audio |

These crates bring in further crates. `Cargo.lock` names all 605 third-party
packages with their versions and sources; it covers every platform, so a
Windows build links only part of them. The licences they declare on crates.io,
read on 2026-11-14:

- 578 are under permissive licences, alone or as a choice: MIT, Apache-2.0
  (some with the LLVM exception), ISC, Zlib, BSD-2-Clause, BSD-3-Clause, 0BSD,
  BSL-1.0, Unlicense, CC0-1.0, MIT-0 and Unicode-3.0. This count includes the
  two git dependencies above.
- 21 are under MPL-2.0 only: the 16 Symphonia crates, and `cssparser`,
  `cssparser-macros`, `selectors`, `dtoa-short` and `option-ext`.
- 3 offer a copyleft licence as one choice beside a permissive or MPL one:
  `r-efi` 5.3.0 and 6.0.0 (MIT OR Apache-2.0 OR LGPL-2.1-or-later) and
  `priority-queue` 2.7.0 (LGPL-3.0-or-later OR MPL-2.0).
- `ring` 0.17.14 is Apache-2.0 AND ISC, `webpki-roots` 1.0.11 is
  CDLA-Permissive-2.0, and `webpki` 0.22.4 declares a non-standard licence;
  read the `LICENSE` file that crate ships.

No crate is offered under the GPL or AGPL only.

Anyone who distributes a built executable must ship the licence texts of the
crates linked into it. `cargo about` and `cargo license` produce that list
from `Cargo.lock`. The Mozilla Public License 2.0 asks that the source of the
files under it stay available under that licence.

## Tools and code borrowed from AAAVS

This project installs no npm packages. Builds and checks use these from the
[AAAVS](https://github.com/LevonFrench/aaavs) checkout beside it:

| Package | Licence | Use |
| --- | --- | --- |
| esbuild | MIT | Bundles the page |
| TypeScript | Apache-2.0 | Type check |
| playwright-core | Apache-2.0 | Browser checks |
| @webgpu/types | BSD-3-Clause | Type declarations |

The page a build produces bundles AAAVS itself (MIT) and the libraries AAAVS
bundles. Their notices are in AAAVS's `THIRD-PARTY-NOTICES.md`.

A built package also contains a copy of `node.exe` from the installed
[Node.js](https://nodejs.org), under the Node.js licence, and needs the
Microsoft WebView2 runtime, which is installed separately and is not
redistributed.

## Spotify

No Spotify SDK, code, artwork or logo is included in this repository. The
sidecar calls the Spotify Web API with a Client ID that each user registers
for their own Spotify developer app, under Spotify's Developer Terms. Audio is
decoded by librespot, an independent open-source library that is not made by
Spotify. Album covers are fetched from Spotify at run time; the sidecar does
not save them.

Spotify is a trademark of Spotify AB. This project is not affiliated with,
sponsored by or endorsed by Spotify.
