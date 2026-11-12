# Selective FM refinement for Short and Long

This rule translates the approved listening example E into a bounded adjustment for new performances. It targets a specific pair of strongly modulated partials that can beat rapidly. It does not predict overall musical quality, reject seeds, or guarantee that every harsh sound is removed. The thresholds below are provisional artistic settings derived from one approved example; broader listening remains necessary.

## Rules

Let `f0` be the nominal bell frequency, `fc` a layer's actual carrier frequency, and `fm = f0 * modRatio` its modulation frequency. The true initial FM index is `beta = modIndex / modRatio`: the existing `modIndex` field expresses frequency deviation relative to `f0`, not `fm`.

1. Trigger only when a layer with at least 20% of the bell's nominal amplitude has `beta >= 1.2` and `abs(fm - 2*fc)` is between 12 and 45 Hz, inclusive. In this near-2:1 region, that gap is the separation between the carrier and its reflected first sideband. Nominal amplitude is a cheap proxy, not a measurement of perceived partial loudness.
2. Move the bell's modulation frequency toward 2:1, on the same side as the strongest triggering layer. Prefer a nominal gap of `min(0.02*f0, 4)` Hz. Allow for existing carrier detuning by constraining the result so each layer with at least 10% of the nominal amplitude has a carrier/sideband gap of at most 6 Hz. If those constraints cannot all be met, leave the bell alone. Small or zero gaps are allowed; a slow audible pulse is not guaranteed for every layer.
3. For a changed bell, cap the initial `beta` of layers at or above 10% amplitude at 1.2. Retain lower values and leave faint layers' normalized depth unchanged. Scale the final modulation-depth parameter with the frequency ratio so its normalized endpoint is preserved. The amplitude attack, decay length, carrier detuning, programmed level, panning, resonators and room remain unchanged. A changed spectrum can still change perceived loudness.
4. Apply this once to the finished plan, using no additional random draws. Pitch choices, intervals, strike timing, form, drones and organ are identical to the previous default for that duration. No seed search, rendered-audio analysis, filter change or new listener control is involved.

## Reference E

Source: `open-run-08c1db04-study-g21-121hz-long-44100sr-1794286390870.wav`, eighth bell at 59.802327696464054 seconds, nominal pitch 152.45044703727964 Hz.

The original shared ratio is 1.8361852135276422. The dominant layer's initial beta is about 2.145 and its carrier/sideband gap is about 25.413 Hz. The rule produces the approved ratio 1.98, dominant beta 1.2, and gap about 3.488 Hz. It preserves the faint first layer and the lower-depth third layer in normalized FM terms. All three resulting voice recipes match E, including the adjusted decay endpoint `terminalModIndex = 0.010783225926300015`.

The earlier comparison used constant presentation gains to match loudness. Its E attenuation of approximately 1.13 dB is not part of this synthesis rule. That diagnostic comparison omitted the full room and resonator path; full-engine playback is a further listening check.

## Scope and reproducibility

Internal replay recipe 33 uses the previous Short planner (21) and Long planner (30), followed by this FM pass. Newly generated performances and bare seeds use 33. Complete older filenames and replay links continue selecting their saved recipe; saved studies and the original `0393ded7` recording are not overwritten. The identifier is carried in exports and sharing links, with no extra UI choice.

To apply the rule to an older performance, recipe 33 accepts an explicit original recipe, stored as `base` in replay links and `-b21` (for example) in filenames. It first reconstructs that exact older score, then changes only the targeted bells' FM parameters. It never substitutes today's composition for the older one. Every unaffected strike retains its complete original recipe. Changed strikes' resonances and reverb tails naturally change the sound where they overlap subsequent events.

Generate such a variation with a complete saved filename or replay link:

```sh
node tools/refine-replay.cjs 'open-run-08c1db04-study-g21-121hz-long-44100sr-1794286390870.wav'
```

The tool prints its new replay link and the exact changed-strike list. For the original `0393ded7` Short Study at 200 Hz, the rule finds no targeted strikes; even requesting the variation leaves that entire score unchanged. A seed by itself cannot identify an older performance's original root, duration or recipe, so this conversion requires its complete saved settings. Original links continue to reproduce original audio.

The `refineBellFM` helper is deterministic, idempotent and non-mutating. `scheduleNote` honors its optional FM endpoint while retaining the exact original 0.01 fallback for every legacy voice.

## Coverage and validation

`node tools/check-fm.cjs` checks 128 fixed seeds at roots 110, 121, 165 and 200 Hz in both lengths. It counts audible strike occurrences, including repeated Long phrases, rather than unique timbres. This is descriptive coverage, not a perceptual success rate.

| Length | Plans | Bell strikes | Changed strikes | Changed share |
| --- | ---: | ---: | ---: | ---: |
| Short | 512 | 6,977 | 1,033 | 14.81% |
| Long | 512 | 57,464 | 8,444 | 14.69% |

Unit checks cover the exact reference recipe, untouched cases, unchanged composition, the depth/gap bounds, immutability, replay and the actual scheduled FM endpoint. With `OPEN_FM_BASELINE` pointing to `player.js` from commit `da8aded3b9c871a8473d74fc4ed08ad1a00098fc`, they also compare 232 original plans across every retained replay identifier and 232 refined variations of those same plans. CI loads that baseline. Native audio checks verify the original `0393ded7` Short Study's exact floating-PCM checksum both with and without the rule, and compare the reference Long excerpt before and after its first targeted strike. Native browser checks cover sharing, exporting and replaying an older-score variation from its filename.
