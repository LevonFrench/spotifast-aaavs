# Spotifast + AAAVS: local playback

How the Windows app plays local audio files and shares the AAAVS preset
library. Spotify browsing and playback are described in
[the Spotify notes](SPOTIFAST-SPOTIFY.md).

## Run

Build the app with `npm run build` (see the [README](../README.md)), then open
`.local\spotifast-prototype\app\SpotifastAAAVS.exe`.

Choose **Open audio…** to select local tracks. **Queue** lists them. The
Preset Manager, Setup Builder, folders, star buttons, F6/F7 ratings, F8
not-working flag, minimum-rating filter, Auto, transitions and Multiview are
the AAAVS Player's own: the app shows the same shared host.

The app uses the audio output engine and resampler from
[Spotifast](https://github.com/crmne/spotifast) inside a WebView2 shell. It is
not Spotifast's GUI, and it does not include Soloist.

## Shared library

The app reads the preset collection of the AAAVS checkout it was built
against: the `avs presets` folder there. The catalogue
(`avs presets\catalog\presets.json`), star ratings, rated filenames and
not-working flags go through AAAVS's library service. Settings, setups and
folders use that collection's private settings folder and its file locks.
Nothing is imported, migrated or cloned into a second preset collection.

A change made here is visible to the AAAVS Player after it reloads its
catalogue or settings, and the other way round. Pages that are already open do
not receive updates from another process.

`aaavs-root.txt` in the package folder names the AAAVS checkout. The renderer
is frozen per build in a `renderer-<time>` folder beside the executable, so a
later AAAVS build cannot remove chunks from an app that is open. A package is a
local development build: it depends on that AAAVS checkout and on the installed
WebView2 runtime, and it does not run on another computer as it is.

## Audio and host boundary

- The [native engine](../desktop/spotifast-local/src/engine.rs) decodes local
  audio with Symphonia. Mono or stereo audio at 8–192 kHz is converted to
  stereo 44.1 kHz with Spotifast's resampler and played through its Windows
  output implementation. Files decode incrementally, so a long mix starts
  without loading the whole track. WAV has runtime coverage; other codecs
  have not been checked on representative files.
- A bounded native pipe supplies 576-frame stereo hops, taken before volume,
  and a media clock adjusted for output queueing. Hardware latency uses a
  100 ms estimate; exact audio and display alignment is not measured.
- The [loopback sidecar](../tools/spotifast-server.mjs) uses AAAVS's library
  service and serves a bounded sample history. Player commands need a
  launch-specific session value and a matching origin.
- The [Player adapter](../src/spotifast-player.ts) uses AAAVS's PCM queue,
  bridge, renderer and preset management. Seeks and track changes advance the
  native epoch so stale audio is rejected.
- Closing the window closes the sidecar and the audio process. No show packs
  and no music files are copied into the package.

The full-file song-map scan and the local tag and lyric reading of the AAAVS
browser Player are not connected to native playback.

## Build and checks

- `npm run build` builds and packages the app with the project-local Rust
  toolchain and the installed Visual Studio C++ tools. Cargo dependencies are
  locked. The first dependency fetch needs network access; builds run offline.
- `npm run test:native` runs the native decoder and packet tests and the
  upstream output and resampler tests.
- `npm run check` includes a native check: WAV output at zero volume,
  non-silent PCM, pause, seek, track replacement, and star and filter
  persistence through two hosts against a temporary collection. It needs
  loopback access and a built native engine.
- The [browser check](../tools/check-spotifast-browser.mjs) attaches to the
  app's WebView2 debug port, which is only open when you enable it yourself.
  It checks real frame changes and the preset manager. Do not enable that port
  for normal use.

## Not verified

Audible quality, measured latency and installation on a clean PC have not been
checked.
