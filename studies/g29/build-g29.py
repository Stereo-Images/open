from pathlib import Path

p=Path(__file__).resolve().parent
s=(p/'source/Open-Principal-Plenum-g28.html').read_text()
def change(old,new,count=1):
    global s
    assert s.count(old)==count,(old[:100],s.count(old),count)
    s=s.replace(old,new)

change('  const PRINCIPAL_PLENUM_ENGINE = "28";', '  const PRINCIPAL_PLENUM_ENGINE = "28";\n  const SPECTRAL_ORGAN_ENGINE = "29";')
change('AUDIBLE_ORGAN_ROOM_ENGINE, PRINCIPAL_PLENUM_ENGINE]);', 'AUDIBLE_ORGAN_ROOM_ENGINE, PRINCIPAL_PLENUM_ENGINE, SPECTRAL_ORGAN_ENGINE]);')
change('return durationInput === "long" ? PRINCIPAL_PLENUM_ENGINE : RESTORED_TEMPO_ENGINE;', 'return durationInput === "long" ? SPECTRAL_ORGAN_ENGINE : RESTORED_TEMPO_ENGINE;')
change('26, 27 and 28.', '26, 27, 28 and 29.')
change('  function resolveDuration(seed, durationInput) {',(p/'spectral-organ.js').read_text()+'\n\n  function resolveDuration(seed, durationInput) {')
change('    const generator = engine === PRINCIPAL_PLENUM_ENGINE', '''    const generator = engine === SPECTRAL_ORGAN_ENGINE
      ? (durationInput === "long" ? createSpectralOrganGenerator(seed, tone, duration)
        : createFixedWalkGenerator(seed, tone, duration, G21_OPTIONS))
      : engine === PRINCIPAL_PLENUM_ENGINE''')
change('AUDIBLE_ORGAN_ROOM_ENGINE, PRINCIPAL_PLENUM_ENGINE].includes(engine)', 'AUDIBLE_ORGAN_ROOM_ENGINE, PRINCIPAL_PLENUM_ENGINE, SPECTRAL_ORGAN_ENGINE].includes(engine)',2)
change("note.organ?.registration === 'principal-plenum-g28'", "['principal-plenum-g28','filtered-spectral-plenum-g29'].includes(note.organ?.registration)")
change('      lp.connect(createOrganChorus(ctx,output,note,time));', '''      lp.connect(note.organ.spectralChorus
        ? createSpectralOrganChorus(ctx,output,note,time)
        : createOrganChorus(ctx,output,note,time));''')
change('<title>Open — Principal Plenum g28</title>','<title>Open — Filtered Spectral Organ g29</title>')
change('Mirrored bells, quiet FM drones, and a fuller Principal chorus with a long organ-room tail.', 'Mirrored bells, quiet FM drones, and softly filtered organ interludes with slow spectral chorus.')
change('open-run-${seed}-study-g28-121hz-long-44100sr-1.wav','open-run-${seed}-study-g29-121hz-long-44100sr-1.wav')
# Publish only finite performances. Internal Infinity bounds still construct the
# unchanged source motifs; they are not a selectable performance mode.
change('            <option value="infinite">Infinite</option>\n', '')
change('["short", "long", "infinite"]', '["short", "long"]', 2)
change('The replay length must be short, long, or infinite.', 'The replay length must be short or long.')
change('    if (durationInput === "infinite") return Infinity;\n', '')
change('    while (duration !== Infinity || generator.nextTime < 1800) {', '    while (true) {')
change('Math.max(duration === Infinity ? 1800 : duration, lastVoiceEnd)', 'Math.max(duration, lastVoiceEnd)')
change('      continuation: duration === Infinity ? generator : null', '      continuation: null')
change('    return sessionSnapshot.continuation?.next() || null;', '    return null;')
change('    // Start from the saved settings, rebuilding even an advanced Infinite run\n    // from its seed. Edited controls and the Revisit field belong to other runs.',
       '    // Rebuild from the saved settings and seed. Edited controls and the\n    // Revisit field belong to other runs.')
change('Short and Infinite', 'Short', 2)
change('Short/Infinite', 'Short')
(p/'deliverables/Open-Filtered-Spectral-Organ-g29.html').write_text(s)
print('Built g29: exact g27 filter, three-band slow stereo chorus, retained g28 ranks and room')
