from pathlib import Path
import json
p = Path(__file__).resolve().parent
s = (p / 'source/Open-Organ-Chorus-g24.html').read_text()
def change(old, new, count=1):
    global s
    assert s.count(old) == count, (old[:100], s.count(old), count)
    s = s.replace(old, new)
change('  const ORGAN_CHORUS_ENGINE = "24";', '  const ORGAN_CHORUS_ENGINE = "24";\n  const MIRRORED_STUDY_ENGINE = "25";')
change('SMOOTH_ORGAN_ENGINE, ORGAN_CHORUS_ENGINE]);', 'SMOOTH_ORGAN_ENGINE, ORGAN_CHORUS_ENGINE, MIRRORED_STUDY_ENGINE]);')
change('return durationInput === "long" ? ORGAN_CHORUS_ENGINE : RESTORED_TEMPO_ENGINE;', 'return durationInput === "long" ? MIRRORED_STUDY_ENGINE : RESTORED_TEMPO_ENGINE;')
change('21, 22, 23 and 24.', '21, 22, 23, 24 and 25.')
change('  function resolveDuration(seed, durationInput) {', (p / 'mirrored-study.js').read_text() + '\n\n  function resolveDuration(seed, durationInput) {')
change('    const generator = engine === ORGAN_CHORUS_ENGINE', '''    const generator = engine === MIRRORED_STUDY_ENGINE
      ? (durationInput === "long" ? createMirroredStudyGenerator(seed, tone, duration)
        : createFixedWalkGenerator(seed, tone, duration, G21_OPTIONS))
      : engine === ORGAN_CHORUS_ENGINE''')
change('[SWEPT_INTERLUDE_ENGINE, RESTORED_TEMPO_ENGINE, PER_PASS_ARCH_ENGINE, SMOOTH_ORGAN_ENGINE, ORGAN_CHORUS_ENGINE].includes(engine)', '[SWEPT_INTERLUDE_ENGINE, RESTORED_TEMPO_ENGINE, PER_PASS_ARCH_ENGINE, SMOOTH_ORGAN_ENGINE, ORGAN_CHORUS_ENGINE, MIRRORED_STUDY_ENGINE].includes(engine)')
change('[PER_PASS_ARCH_ENGINE, SMOOTH_ORGAN_ENGINE, ORGAN_CHORUS_ENGINE].includes(engine)', '[PER_PASS_ARCH_ENGINE, SMOOTH_ORGAN_ENGINE, ORGAN_CHORUS_ENGINE, MIRRORED_STUDY_ENGINE].includes(engine)')
change('<title>Open — Principal Organ Study</title>', '<title>Open — Mirrored Study</title>')
change('Rich Principal organ chords with a slow, spacious chorus between returning bell melodies.', 'Mirrored bell melodies and a returning arch of rich Principal organ chords.')
change('Each interlude sounds its chord 1, 2, 3, 2, 1, 2… times, then releases into the room before the melody returns.',
       'Each Long study expands toward a central three-chord interlude, then returns through its earlier sounds. Short studies keep their original form.')
change('open-run-${seed}-study-g24-121hz-long-44100sr-1.wav', 'open-run-${seed}-study-g25-121hz-long-44100sr-1.wav')
manifest = p / 'manifest.json'
if manifest.exists() and json.loads(manifest.read_text()).get('engine') == '25':
    rows = json.loads(manifest.read_text())['recordings']
    choices = []
    for batch, label in [('reference','Based on 0b086950'),('random','New random studies')]:
        choices.append(f'<optgroup label="{label}">')
        for row in rows:
            if row['batch'] != batch: continue
            seconds = round(row['durationSeconds'])
            choices.append(f'<option value="{row["seed"]}">{row["seed"]} · {seconds//60}:{seconds%60:02d}</option>')
        choices.append('</optgroup>')
    start = s.index('<select id="batchSeed">') + len('<select id="batchSeed">')
    end = s.index('</select>',start)
    s = s[:start] + '\n' + '\n'.join(choices) + '\n' + s[end:]
(p / 'deliverables').mkdir(exist_ok=True)
(p / 'deliverables/Open-Mirrored-Study-g25.html').write_text(s)
print('Built g25 nested mirrored Long form; earlier engine paths retained')
