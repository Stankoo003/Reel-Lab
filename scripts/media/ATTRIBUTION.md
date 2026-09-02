# Media attribution

The seeded clips are excerpts from Blender Foundation open movies, used under
**Creative Commons Attribution 3.0**. Attribution is a licence condition, not a courtesy.

| Clip | Source | Credit |
|---|---|---|
| `videos/blender/big-buck-bunny/clip.mp4` | *Big Buck Bunny* trailer (2008) | © Blender Foundation · [peach.blender.org](https://peach.blender.org) |
| `videos/blender/sintel/clip.mp4` | *Sintel* trailer (2010) | © Blender Foundation · [durian.blender.org](https://durian.blender.org) |
| `videos/local/steel-*/clip.mp4` | *Tears of Steel* (2012) | © Blender Foundation · [mango.blender.org](https://mango.blender.org) |

All are short excerpts, re-encoded. Posters are frames from those excerpts.

Note on *Tears of Steel*: the `copyright.txt` shipped alongside the download reads
**Attribution-NoDerivs**, but that notice is scoped to the standalone *soundtrack* files.
The film itself is released under **CC Attribution 3.0**, which is what these excerpts rely on.

Licence text: https://creativecommons.org/licenses/by/3.0/

## Bundled music beds

`assets/spike/audio/*.m4a` — the three beds the editor's AUDIO tab offers.

| Track | File | Length | Source | Author | Licence |
|---|---|---|---|---|---|
| Pulse | `assets/spike/audio/pulse.m4a` | 0:08 | Synthesised by `scripts/media/make-audio.sh` | ReelLab | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| Drift | `assets/spike/audio/drift.m4a` | 0:30 | Synthesised by `scripts/media/make-audio.sh` | ReelLab | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| Ticker | `assets/spike/audio/ticker.m4a` | 0:20 | Synthesised by `scripts/media/make-audio.sh` | ReelLab | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

These are not excerpts of anything. Each one is generated from FFmpeg `aevalsrc`
oscillators — sines, an exponential decay envelope and a tremolo — so there is no
third-party sample, loop pack or recording anywhere in the chain and nobody else holds
rights in the result. That is verifiable rather than merely asserted: run
`./scripts/media/make-audio.sh` and the same files come back.

CC0 imposes no attribution condition, so nothing here is legally load-bearing; the credit
line is still shown at the bottom of the editor's AUDIO tab (`MUSIC_CREDIT` in
`src/assets.ts`) so that the app never presents unattributed audio, whatever gets added
later.

**Removed:** `assets/spike/music.m4a`, the spike's original single bed. Its source, author
and licence were never recorded anywhere in this repo, so it could not be attributed and was
replaced rather than shipped on an unverifiable provenance.
