# Ordinary generation of exact performances

Long performances use one 17-character hexadecimal seed: a form marker followed by a complete 32-bit melody seed and a complete 32-bit performance seed. Store and parse the complete code as text; it exceeds JavaScript Number's exact integer range.

| Marker | Melody construction | Form |
| --- | --- | --- |
| `5` | Compact eleven-note theme | Theme → mirror → organ, with a whole-piece FM palette mirror |
| `0` | Saved compact eleven-note theme | Theme → mirror → organ, with fresh palettes throughout |
| `2` | Twenty-eight-note walk | Theme → organ → mirror → organ |
| `1` | Saved twenty-eight-note walk | Preserved immediate mirror before the organ |

Every form ends with its final mirror and natural tail, without a trailing organ passage. Marker `1` keeps its original meaning; changing the form must never silently change a saved seed's performance.

Ordinary Long Play draws two independent 32-bit words with `crypto.getRandomValues`: the first selects an eleven-note melody and the second selects its performance settings. It prefixes them with form marker `5`. Every melody/performance combination has nonzero probability, including the eight [compact reference performances](#compact-reference-performances) below. Markers `0`, `1` and `2` remain replay-only. No seed registry, named parent, favorites list, audio file or quality score participates in this path. A fallback without Web Crypto draws the same two words with Math.random.

The compact construction retains the established eleven-note phrase algorithm. The walking construction is retained only to replay existing 28-note recordings, including the approved strike-23 tritone correction in the 08b0195e theme. Marker `2` uses the same 28-note melody construction as marker `1`, with different organ placement. Neither walking form is selected by ordinary Play.

The performance word retains the existing timing, FM, accompaniment, organ, duration-selection and spatial streams. Marker `5` introduces a fresh bell palette for each pair in the first half of the pair sequence, plus the central pair when the count is odd. The second half reuses those palettes in reverse order. It deterministically replaces only second-half bell voice recipes and consumes no new random values. An odd number of pairs retains one central palette, while an even number repeats the central palette across the middle. The original onset schedule, dynamics, stereo movement, organ and accompaniment remain unchanged. The seed determines tempo throughout. No extra random draw is inserted into those streams. Rendering receives this 32-bit audio seed, never a rounded conversion of the longer replay code.

## Existing study mapping

[`studies/nov12-ordinary-seeds/manifest.json`](../studies/nov12-ordinary-seeds/manifest.json) maps all 24 archived recordings to complete seeds. The first eight use marker `1` and melody word `08b0195e`; the next eight use marker `0` and melody word `4850166b`; the independent eight use marker `0` and their original seed for both words. These exact seeds are replay-only under the current generator. The sixteen marker-0 melody/performance combinations can occur through ordinary Play with marker `5`, which adds the whole-piece FM mirror. The manifest is documentation/test evidence only and is never loaded by the player.

At the original settings (Long, 121 Hz, 44.1 kHz export), every archived seed retains its saved full planned events, density, duration and audio seed. Tests compare all 24 older studies against their original explicit recipe and frozen event hashes under both g38 and g39.

## Compact reference performances

The eight reference combinations in [`tests/ordinary-seeds.test.cjs`](../tests/ordinary-seeds.test.cjs) share melody word `08b0195e` and use the performance words shown in their seed suffixes. At a 121 Hz root, each uses the same eleven-note theme. The marker-0 seeds retain their original g39 replay; the marker-5 counterparts can arise through ordinary Long Play with g41. Their second-half bell palettes differ deliberately.

| Archived replay seed (`g39`) | Ordinary Play counterpart (`g41`) |
| --- | --- |
| `008b0195ebd58cab9` | `508b0195ebd58cab9` |
| `008b0195eea052f22` | `508b0195eea052f22` |
| `008b0195e92f674dc` | `508b0195e92f674dc` |
| `008b0195eaff38550` | `508b0195eaff38550` |
| `008b0195e0569bc17` | `508b0195e0569bc17` |
| `008b0195e5b42aeb6` | `508b0195e5b42aeb6` |
| `008b0195e3db9492e` | `508b0195e3db9492e` |
| `008b0195e685ff5ef` | `508b0195e685ff5ef` |

The [EP's Long Study](../README.md#open-ep) uses `508b0195e3db9492e` at 121 Hz, with a 44.1 kHz source export. Its source performance is covered separately by [`tests/fm-arch.test.cjs`](../tests/fm-arch.test.cjs).

Tests inject compact melody/performance word combinations at the normal two-word random boundary and press ordinary Play without a replay. They verify all eight marker-5 reference seeds above as well as the sixteen compact combinations in the archived manifest. Separate tests verify odd/even pair counts across unrelated seeds and root tones, preservation of the original first half, matching global FM recipes, unchanged timing and accompaniment, and filename/link/bare-seed replay. Cross-browser floating-point DSP can still differ; exact performance preservation does not promise identical samples across browsers or devices.

## Duration and replay

Ordinary Long Play now generates only eleven-note forms. The structural duration check remains in place for compatibility, but 28-note duration constraints apply only when replaying archived performances. Replay never redraws, and nothing is filtered by musical quality. All eight compact reference combinations above have valid ordinary g41 counterparts at 121 Hz.

New performances use the Long replay recipe `g41` and marker `5`. Bare marker-5 seeds select g41; marker 5 is rejected by earlier recipes, and g41 requires marker 5. The new prefix preserves the meaning of every older seed. For example, `508b0195e3db9492e` uses the same melody and performance words as `008b0195e3db9492e`, with only the larger FM mirror added. A bare 17-character seed automatically selects Long and uses the root tone currently selected in the player. Bare marker-2 seeds select g39 for historical replay. Bare marker-0 and marker-1 seeds retain g38, which produces exactly the same performance as g39 for those markers. Marker-2 seeds are rejected with g38 or earlier recipes instead of being misinterpreted. Old complete filenames and links retain their original behavior, including g35/g36/g37 and 0393ded7 g3 Short. Bare eight-character Long seeds retain the prior ordinary g35 meaning; their corresponding compact complete seed is `0` followed by that word twice. Short keeps its eight-character format and existing default. The root tone and duration remain the existing controls; a complete replay link or filename additionally preserves those settings and sample rate.

The specific Short Study `open-run-0393ded7-mviswtcb-g3-200hz-short-44100sr-1792628825406` is protected by a separate regression: its 11 complete strike recipes, timing, density, audio seed and 85.56632370385142-second export duration must match both saved-file replay and ordinary Short Play at 200 Hz. The frozen event hash was checked against the archived `open-seed-0393ded7-g3.html` source. Rendering that archived source and the current ordinary Short engine through the same native audio backend produced byte-identical stereo PCM: all 7,546,950 samples matched, including the tail. A native-browser test also compares full WAV exports from the exact filename and ordinary Play in Chromium, Firefox and WebKit.

This preserves the performance and synthesis, not an archive-file checksum across different renderers. The archived WAV and this environment's native render have the same frame count but different sample values; the archived source produces exactly the same native render as the new engine. The original WAV therefore remains the reference when the recording's exact bytes are needed.

Being in the random output space does not guarantee encounter within any finite number of Plays. Each complete code is directly reproducible, while spontaneous rediscovery remains extremely rare.
