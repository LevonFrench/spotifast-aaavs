# Spotifast + AAAVS: Spotify library and playback

Windows development prototype.

## Open and connect

Open `SpotifastAAAVS.exe` and choose **Spotify** in the top bar.

1. Open **First-time setup**, then **Open Spotify dashboard**. In your browser,
   create your own app, enable Web API, and register this exact redirect URI:
   `http://127.0.0.1:43817/spotify-callback`.
2. Paste its public Client ID into the player. Choose **Connect Spotify** and
   complete Spotify's sign-in and consent in your system browser yourself.
3. Return to the player. **Liked Songs** and your playlists appear in the left
   column. Select a playlist and click a song to play it on this computer.

Spotify Premium and access to the registered developer app are required for
playback. No client secret is needed. Development Mode eligibility, user limits
and quotas remain Spotify's rules, not capabilities supplied by this build.
Connection tokens live in memory for this running player and are cleared on
disconnect and on close. Nothing is written to disk, so you connect again after
restarting.

The return port is fixed so the registered URI remains stable. If another
instance of the player owns it, close that instance before connecting.
Opening the tab alone does not start a sign-in or an account request.

## Player and presets

The transport controls pause and resume, stop and restart, seek and change
tracks. The Spotify queue continues through the selected collection, loading
later pages as needed. Unavailable and local-only Spotify entries cannot be
streamed by this route. The **Queue** button keeps the local-file queue;
**Open audio…** switches back to local playback.

All preset behaviour uses the shared AAAVS host and the preset collection of
the AAAVS checkout the app was built against. Stars, rated filenames,
not-working flags, folders, setups and rating filters go through AAAVS's
library service and its file locks. No preset migration and no second
catalogue is created.

## Implementation and limits

- [Spotify API adapter](../tools/spotifast-spotify.mjs): the official Web API,
  Authorization Code with PKCE (S256), one-use callback state, bounded
  pagination, in-memory token refresh and rate-limit handling. Playlists
  support the current `item` schema and the older `track` schema.
- [Spotify panel](../src/spotifast-spotify.ts): playlists, Liked Songs, paged
  tracks, and a connection and disconnect that you operate in your browser.
- [Native playback](../desktop/spotifast-local/src/spotify.rs): librespot 0.8
  decodes Spotify audio through the same Windows output used by local files.
  One shared output and source epochs isolate tracks, seeks and source
  switches. The stereo PCM taken before volume drives AAAVS.
- [Host adapter](../src/spotifast-player.ts): metadata, transport and queues.
  The renderer, presets and stars remain AAAVS's.

There is no Soloist path and no lossless claim. librespot reports that some
Spotify accounts cannot obtain audio keys. The app tells an audio-key refusal
from a timeout and from an otherwise unknown decoder failure, without keeping
provider logs or credentials. It reports the failure; it does not substitute
another catalogue or attempt a protection workaround.

Playback with a real Spotify account has not been verified: the checks below
use a fixture account and never contact Spotify. Audible quality and exact
latency are also unverified.

This project is not affiliated with, sponsored by or endorsed by Spotify. Use
of the Spotify Web API and of librespot is subject to Spotify's terms,
including its rules on content use.

References:

- https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
- https://developer.spotify.com/documentation/web-api/reference/get-a-list-of-current-users-playlists
- https://developer.spotify.com/documentation/web-api/reference/get-users-saved-tracks
- https://developer.spotify.com/documentation/web-api/reference/get-playlists-items
- https://github.com/librespot-org/librespot

## Checks

Commands are run in a checkout of the source; see the [README](../README.md).

- `npm run check:spotify`: account-free assertions covering the API adapter.
- `npm run check`: adds the type check and native local-file playback (PCM,
  pause, seek, track replacement and shared-star persistence through a
  temporary library).
- `npm run test:native`: the native tests, including Spotify metadata, source
  epochs, diagnostics and bounded decoding and seeking of a long file.
- `npm run check:output`: a quiet synthetic tone and a read-only Windows
  per-process audio meter verify initial Play, Pause and Play, a seek while
  playing, Stop and Play, and track replacement; Pause and Stop must produce
  silence. This check needs a working, unmuted Windows output and the
  installed C++ build tools.
- `npm run check:spotify:browser`: a fake account, provider and protocol
  process with the real page and shared renderer. It covers playlists, Liked
  Songs, pagination, cover art, transport, queue advance, Stop and Play,
  disconnect, compact layouts, and that your star ratings are unchanged.

Fixture tests do not establish successful playback with a real account.
