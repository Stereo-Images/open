from pathlib import Path

p = Path(__file__).resolve().parent
s = (p / 'source/Open-Mirrored-Study-g27.html').read_text()

def change(old, new, count=1):
    global s
    assert s.count(old) == count, (old[:100], s.count(old), count)
    s = s.replace(old, new)

change('  const AUDIBLE_ORGAN_ROOM_ENGINE = "27";', '  const AUDIBLE_ORGAN_ROOM_ENGINE = "27";\n  const PRINCIPAL_PLENUM_ENGINE = "28";')
change('LONG_ORGAN_ROOM_ENGINE, AUDIBLE_ORGAN_ROOM_ENGINE]);', 'LONG_ORGAN_ROOM_ENGINE, AUDIBLE_ORGAN_ROOM_ENGINE, PRINCIPAL_PLENUM_ENGINE]);')
change('return durationInput === "long" ? AUDIBLE_ORGAN_ROOM_ENGINE : RESTORED_TEMPO_ENGINE;', 'return durationInput === "long" ? PRINCIPAL_PLENUM_ENGINE : RESTORED_TEMPO_ENGINE;')
change('25, 26 and 27.', '25, 26, 27 and 28.')
change('  function resolveDuration(seed, durationInput) {', (p / 'principal-plenum.js').read_text() + '\n\n  function resolveDuration(seed, durationInput) {')
change('    const generator = engine === AUDIBLE_ORGAN_ROOM_ENGINE', '''    const generator = engine === PRINCIPAL_PLENUM_ENGINE
      ? (durationInput === "long" ? createPrincipalPlenumGenerator(seed, tone, duration)
        : createFixedWalkGenerator(seed, tone, duration, G21_OPTIONS))
      : engine === AUDIBLE_ORGAN_ROOM_ENGINE''')
change('LONG_ORGAN_ROOM_ENGINE, AUDIBLE_ORGAN_ROOM_ENGINE].includes(engine)', 'LONG_ORGAN_ROOM_ENGINE, AUDIBLE_ORGAN_ROOM_ENGINE, PRINCIPAL_PLENUM_ENGINE].includes(engine)', 2)
change('      } else if (note.organ?.chorus) {', '''      } else if (note.organ?.registration === 'principal-plenum-g28') {
        schedulePrincipalPlenum(ctx, master, note, time);
      } else if (note.organ?.chorus) {''')
change('<title>Open — Mirrored Study g27</title>', '<title>Open — Principal Plenum g28</title>')
change('Mirrored bells, quiet FM drones, and spacious Principal organ interludes with shorter handoffs.', 'Mirrored bells, quiet FM drones, and a fuller Principal chorus with a long organ-room tail.')
change('open-run-${seed}-study-g27-121hz-long-44100sr-1.wav', 'open-run-${seed}-study-g28-121hz-long-44100sr-1.wav')
(p / 'deliverables').mkdir(exist_ok=True)
(p / 'deliverables/Open-Principal-Plenum-g28.html').write_text(s)
print('Built g28: Principal chorus interludes; g1–g27 replays retained')
