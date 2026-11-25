# Open studies

[Listen to the studies](https://stereo-images.github.io/open/studies/).

The page lists **56 saved Long performances: 24 theme-and-mirror studies and 32 earlier studies**. All are archived performances preserved for replay through the shared player's controls and export tools. The separate Short Study button returns to the preserved `0393ded7` performance and is not included in the Long count.

| Collection | Long performances | Contents | Saved settings |
| --- | ---: | --- | --- |
| Archived theme and mirror studies | 24 | Eight using the 28-note theme of `08b0195e`, eight using the 11-note theme of `4850166b`, and eight independent 11-note themes | [Complete seeds and replay links](nov12-ordinary-seeds/manifest.json) |
| Earlier opening-preserved studies | 16 | Eight retaining the opening of `08b0195e` with its corrected note, and eight independent performances | [Manifest](nov11/manifest.json) |
| Original organ studies | 16 | Eight using the melodic motif of `0b086950`, and eight independent performances | [Manifest](g29/manifest.json) and [scores](g29/scores) |

The 24 theme-and-mirror studies use seventeen-character seeds with markers `0` or `1` and retain their saved form. Their exact seeds are replay-only: ordinary Long Play now draws only marker `5`, with an eleven-note theme and a whole-piece FM palette mirror. The sixteen compact studies' melody/performance word combinations remain possible under marker `5`, but those new performances return through earlier bell palettes in the second half instead of introducing fresh palettes throughout. They are not the original archived performances. See the [seed-generation notes](../docs/ordinary-seeds.md) for the distinction.

All 56 saved Long studies remain available with their original replay settings. Keep the manifests and archived scores unchanged when editing the interface; `npm run check:player` verifies the selector against all three manifests and checks the documented total.

The page loads the root `player.js`, `style.css` and `wav-worker.js`. `studies.js` only connects the selector and Short Study button to the shared player. Existing study URLs redirect here or to the main player, preserving replay settings.

Earlier players, analyses, workbooks and development scripts are preserved on the [development archive branch](https://github.com/Stereo-Images/open/tree/archive/g29-development/studies/g29). They are no longer part of the published site.

For automated score checks and scripted WAV rendering, see the [development notes](../tests/README.md).

