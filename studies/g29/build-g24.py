from pathlib import Path

p=Path(__file__).resolve().parent
s=(p/'source/Open-Rich-Organ-g23.html').read_text()

def change(old,new,count=1):
    global s
    assert s.count(old)==count,(old[:100],s.count(old),count)
    s=s.replace(old,new)

change('  const SMOOTH_ORGAN_ENGINE = "23";',
       '  const SMOOTH_ORGAN_ENGINE = "23";\n  const ORGAN_CHORUS_ENGINE = "24";')
change('PER_PASS_ARCH_ENGINE, SMOOTH_ORGAN_ENGINE]);',
       'PER_PASS_ARCH_ENGINE, SMOOTH_ORGAN_ENGINE, ORGAN_CHORUS_ENGINE]);')
change('return durationInput === "long" ? SMOOTH_ORGAN_ENGINE : RESTORED_TEMPO_ENGINE;',
       'return durationInput === "long" ? ORGAN_CHORUS_ENGINE : RESTORED_TEMPO_ENGINE;')
change('21, 22 and 23.','21, 22, 23 and 24.')

# Keep the complete g23 organ path literal. Derive g24's scheduler from it,
# inserting one chorus stage after filtering and before the dedicated room.
start=s.index('  function scheduleSmoothOrgan(')
end=s.index('  function resolveDuration(',start)
scheduler=s[start:end].replace('function scheduleSmoothOrgan(', 'function scheduleChorusedOrgan(',1)
old='      lp.connect(createNoteDrift(ctx, room.input, room.silentSend, time, note.duration, note.pan));'
assert scheduler.count(old)==1
scheduler=scheduler.replace(old,'''      const output = createNoteDrift(ctx, room.input, room.silentSend, time, note.duration, note.pan);
      lp.connect(createOrganChorus(ctx, output, note, time));''')
marker='  // g23 changes only the foreground interlude instrument.'
change(marker,(p/'organ-chorus.js').read_text()+'\n\n'+scheduler+'\n'+marker)
change('    const generator = engine === SMOOTH_ORGAN_ENGINE',
       '''    const generator = engine === ORGAN_CHORUS_ENGINE
      ? (durationInput === "long" ? createChorusedOrganGenerator(seed, tone, duration)
        : createFixedWalkGenerator(seed, tone, duration, G21_OPTIONS))
      : engine === SMOOTH_ORGAN_ENGINE''')
change('[SWEPT_INTERLUDE_ENGINE, RESTORED_TEMPO_ENGINE, PER_PASS_ARCH_ENGINE, SMOOTH_ORGAN_ENGINE].includes(engine)',
       '[SWEPT_INTERLUDE_ENGINE, RESTORED_TEMPO_ENGINE, PER_PASS_ARCH_ENGINE, SMOOTH_ORGAN_ENGINE, ORGAN_CHORUS_ENGINE].includes(engine)')
change('[PER_PASS_ARCH_ENGINE, SMOOTH_ORGAN_ENGINE].includes(engine)',
       '[PER_PASS_ARCH_ENGINE, SMOOTH_ORGAN_ENGINE, ORGAN_CHORUS_ENGINE].includes(engine)')
change('''      } else if (note.organ) {
        scheduleSmoothOrgan''',
       '''      } else if (note.organ?.chorus) {
        scheduleChorusedOrgan(ctx, master, note, time);
      } else if (note.organ) {
        scheduleSmoothOrgan''')
change('<title>Open — Rich Organ Study</title>', '<title>Open — Principal Organ Study</title>')
change('Rich, smoothly voiced pipe-organ chords between returning bell melodies.',
       'Rich Principal organ chords with a slow, spacious chorus between returning bell melodies.')
change('open-run-${seed}-study-g23-121hz-long-44100sr-1.wav',
       'open-run-${seed}-study-g24-121hz-long-44100sr-1.wav')
(p/'deliverables/Open-Organ-Chorus-g24.html').write_text(s)
print('Built g24 Principal organ with chorus and feedback; Long studies only')
