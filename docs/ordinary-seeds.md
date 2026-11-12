# Ordinary generation of exact performances

New Long performances use one 17-character hexadecimal seed. Its first digit is a construction bit (`0` compact eleven-note theme; `1` twenty-eight-note walk), followed by a complete 32-bit melody seed and a complete 32-bit performance seed. Store and parse the complete code as text: 65 bits exceed JavaScript Number's exact integer range.

Ordinary Play draws three words with `crypto.getRandomValues`: the first word's low bit selects the construction, the second word selects the melody, and the third selects the performance. Every construction/melody/performance tuple has nonzero probability. No seed registry, named parent, favorites list, audio file or quality score participates in this path. A fallback without Web Crypto draws the same words with Math.random.

The compact construction retains the established eleven-note phrase algorithm. The walking construction gathers 28 bell pitches from the original walk, projects them into the root's major collection, and replaces every melodic tritone with the nearest allowed pitch (lower pitch breaks a tie). It does not single out a source seed or strike number. For the 08b0195e melody at 121 Hz, that general rule produces exactly the approved strike-23 correction. The complete theme then recurs, with its full mirror, before each organ interlude.

The performance word retains the existing timing, FM, accompaniment, organ, duration-selection and spatial streams. The seed determines tempo throughout. No extra random draw is inserted into those streams. Rendering receives this 32-bit audio seed, never a rounded conversion of the longer replay code.

## Existing study mapping

`studies/nov12-ordinary-seeds/manifest.json` maps all 24 finished recordings to complete seeds. The first eight use construction 1 and melody word 08b0195e; the next eight use construction 0 and melody word 4850166b; the independent eight use construction 0 and their original seed for both words. These are ordinary tuples, not exceptions in the generator. The manifest is documentation/test evidence only and is never loaded by the player.

At the original settings (Long, 121 Hz, 44.1 kHz export), the full planned events, density, duration and audio seed equal the saved recordings. Tests inject each tuple at the random-word boundary and press ordinary Play without a replay. They also compare all event data against the older explicit recipe and its frozen event hash. Native rendering probes exercise each construction and the unchanged synthesis path. Cross-browser floating-point DSP can still differ; this is exact performance preservation, not a promise that all audio hardware yields identical bytes.

## Duration and replay

A very slow 28-note theme may not fit two complete pairs in 30 minutes. Only this structural duration failure causes ordinary Play to redraw, up to 32 attempts. The stored seed is the accepted draw. Replay never redraws, and nothing is filtered by musical quality. All 24 mapped tuples fit and are accepted on their first attempt.

New seeds use the current Long replay recipe (`g38`). Old complete filenames and links retain their original behavior, including g35/g36/g37 and 0393ded7 g3 Short. Bare eight-character Long seeds retain the prior ordinary g35 meaning; their corresponding compact complete seed is `0` followed by that word twice. Short keeps its eight-character format and existing default. The root tone and duration remain the existing controls; a complete replay link or filename additionally preserves those settings and sample rate.

Being in the random output space does not guarantee encounter within any finite number of Plays. Each complete code is directly reproducible, while spontaneous rediscovery remains extremely rare.
