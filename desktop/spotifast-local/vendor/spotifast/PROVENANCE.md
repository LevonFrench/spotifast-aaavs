# Spotifast audio output

Source: https://github.com/crmne/spotifast

Pinned revision: d0c2f052030b2f53158f7deb5df8fbba37eb68dc (retrieved 2026-11-09).

The files [`sink.rs`](sink.rs) and [`resample.rs`](resample.rs) in this folder
come from the upstream source directory. Copyright and MIT permission notice:
[LICENSE](LICENSE).

The local sink adaptation adds only a read-only queued-duration accessor for
the AAAVS media clock. One upstream test fixture unwraps the released librespot
URI API's Result (the upstream checkout uses a different API revision).
The rest of the output, device maintenance, fades,
volume smoothing and resampling remain upstream code.

Only Spotifast's output engine is used here. The rest of Spotifast (its GUI,
its Spotify session code and Soloist) is not included and is not called.
