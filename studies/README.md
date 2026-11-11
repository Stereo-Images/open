# Open studies

[Listen to the studies](https://stereo-images.github.io/open/studies/).

Sixteen saved Long performances share the main player's sound, controls and export tools. Eight studies share the original melodic motif of `0b086950`; eight were independently drawn. The Short Study button returns to the preserved `0393ded7` performance.

The approved [manifest](g29/manifest.json) and [scores](g29/scores) retain the complete performance settings and planned notes. Keep these files unchanged when editing the interface.

The page loads the root `player.js`, `style.css` and `wav-worker.js`. `studies.js` only connects the selector and Short Study button to the shared player. Existing current-study URLs redirect here or to the main player, preserving replay settings.

Earlier players, analyses, workbooks and development scripts are preserved on the [development archive branch](https://github.com/Stereo-Images/open/tree/archive/g29-development/studies/g29). They are no longer part of the published site.

For automated score checks and scripted WAV rendering, see the [development notes](../tests/README.md).
