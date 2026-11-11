from pathlib import Path
import json

p = Path(__file__).resolve().parent
s = (p / 'source/Open-Mirrored-Study-g26.html').read_text()

def change(old, new, count=1):
    global s
    assert s.count(old) == count, (old[:100], s.count(old), count)
    s = s.replace(old, new)

change('  const LONG_ORGAN_ROOM_ENGINE = "26";', '  const LONG_ORGAN_ROOM_ENGINE = "26";\n  const AUDIBLE_ORGAN_ROOM_ENGINE = "27";')
change('MIRRORED_STUDY_ENGINE, LONG_ORGAN_ROOM_ENGINE]);', 'MIRRORED_STUDY_ENGINE, LONG_ORGAN_ROOM_ENGINE, AUDIBLE_ORGAN_ROOM_ENGINE]);')
change('return durationInput === "long" ? LONG_ORGAN_ROOM_ENGINE : RESTORED_TEMPO_ENGINE;', 'return durationInput === "long" ? AUDIBLE_ORGAN_ROOM_ENGINE : RESTORED_TEMPO_ENGINE;')
change('22, 23, 24, 25 and 26.', '22, 23, 24, 25, 26 and 27.')
change('      const span = offsets.at(-1)+bells.at(-1).duration;', '''      const directSpan = offsets.at(-1)+bells.at(-1).duration;
      // Begin the interlude while the final bell is fading, rather than
      // waiting through the nearly inaudible end of its exponential decay.
      const hold = compositionOptions.bellTailHandoff
        ? Math.max(4, Math.min(12, bells.at(-1).duration*.35)) : bells.at(-1).duration;
      const span = offsets.at(-1)+hold, finalTailExtension = directSpan-span;''')
change('      halves.push({bells,background,span,gaps:reflectedGaps});', '      halves.push({bells,background,span,gaps:reflectedGaps,finalTailExtension});')
change('+statementDuration*counts.reduce((a,b)=>a+b,0)+sectionGap*(4*h-2);', '+statementDuration*counts.reduce((a,b)=>a+b,0)+sectionGap*(4*h-2)+halves[0].finalTailExtension;')
change('      cursor+=pass.span;passes.push({cycle,palette,start,end:cursor,span:pass.span});', '''      const span = pass.span+(cycle===passCount-1?pass.finalTailExtension:0);
      cursor+=span;passes.push({cycle,palette,start,end:cursor,span,
        ...(compositionOptions.bellTailHandoff?{bellDirectEnd:start+pass.span+pass.finalTailExtension}: {})});''')
change('midpoint:(startTime+cursor)/2,sectionGapSeconds:sectionGap,eventSymmetry:true,reverseAudio:false}',
       "midpoint:(startTime+cursor)/2,sectionGapSeconds:sectionGap,eventSymmetry:!compositionOptions.bellTailHandoff,reverseAudio:false,\n          ...(compositionOptions.bellTailHandoff?{handoff:'bell-tail-overlap',orderSymmetry:true}: {})}")
# The optional longer harmony lookahead is active only in g27. Every older
# caller retains the exact previous chord choices and random stream.
change('overlap:groups.flatMap(g=>g.notes).filter(n=>n.time<entry.end+tail&&n.time+n.duration+tail>entry.start)',
       'overlap:groups.flatMap(g=>g.notes).filter(n=>n.time<entry.end+(compositionOptions.organTailSeconds??tail)&&n.time+n.duration+tail>entry.start)')
change('  function resolveDuration(seed, durationInput) {', (p / 'audible-organ-room.js').read_text() + '\n\n  function resolveDuration(seed, durationInput) {')
change('    const generator = engine === LONG_ORGAN_ROOM_ENGINE', '''    const generator = engine === AUDIBLE_ORGAN_ROOM_ENGINE
      ? (durationInput === "long" ? createAudibleOrganRoomGenerator(seed, tone, duration)
        : createFixedWalkGenerator(seed, tone, duration, G21_OPTIONS))
      : engine === LONG_ORGAN_ROOM_ENGINE''')
change('MIRRORED_STUDY_ENGINE, LONG_ORGAN_ROOM_ENGINE].includes(engine)', 'MIRRORED_STUDY_ENGINE, LONG_ORGAN_ROOM_ENGINE, AUDIBLE_ORGAN_ROOM_ENGINE].includes(engine)', 2)
change('    longOrganEffectStates.delete(ctx);', '    longOrganEffectStates.delete(ctx);\n    audibleOrganEffectStates.delete(ctx);')
change('function getOrganEffects(ctx, destination, room) {', '''function getOrganEffects(ctx, destination, room) {
    if (room === 'audible-convolution-g27') return getAudibleOrganEffects(ctx, destination);''')
change('<title>Open — Mirrored Study with Long Organ Reverb</title>', '<title>Open — Mirrored Study g27</title>')
change('Mirrored bell melodies, quiet FM drones, and Principal organ interludes with a long, spacious reverb tail.', 'Mirrored bells, quiet FM drones, and spacious Principal organ interludes with shorter handoffs.')
change('open-run-${seed}-study-g26-121hz-long-44100sr-1.wav', 'open-run-${seed}-study-g27-121hz-long-44100sr-1.wav')
# Existing seed choices are retained; omit their stale g26 durations.
rows = json.loads((p / 'manifest.json').read_text())['recordings']
choices = []
for batch, label in [('reference', 'Based on 0b086950'), ('random', 'New random studies')]:
    choices.append(f'<optgroup label="{label}">')
    for row in rows:
        if row['batch'] == batch:
            choices.append(f'<option value="{row["seed"]}">{row["seed"]}</option>')
    choices.append('</optgroup>')
start = s.index('<select id="batchSeed">') + len('<select id="batchSeed">')
end = s.index('</select>', start)
s = s[:start] + '\n' + '\n'.join(choices) + '\n' + s[end:]
(p / 'deliverables').mkdir(exist_ok=True)
(p / 'deliverables/Open-Mirrored-Study-g27.html').write_text(s)
print('Built g27: fuller organ reverb, two-second handoffs, all earlier engines retained')
