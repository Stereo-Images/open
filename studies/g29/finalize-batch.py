from pathlib import Path
import hashlib, json, wave

p = Path(__file__).resolve().parent
manifest = json.loads((p/'manifest.json').read_text())
analysis = json.loads((p/'analysis/Open-g29-Sixteen-Studies-Analysis-Data.json').read_text())
player = p/'deliverables/Open-g29-Sixteen-New-Studies.html'
player_hash = hashlib.file_digest(player.open('rb'), 'sha256').hexdigest()
results = json.loads((p/'render-validation.json').read_text())
assert len(results) == len(analysis['recordings']) == len(manifest['recordings']) == 16
assert len({r['pcmSha256'] for r in results}) == 16
assert {r['seed'] for r in results} == {r['summary']['seed'] for r in analysis['recordings']}
endpoints = []
for row in manifest['recordings']:
    result = next(r for r in results if r['seed'] == row['seed'])
    assert result['engine'] == '29' and result['playerSha256'] == player_hash
    assert result['clipped'] == result['nonfinite'] == 0 and result['truePeakDbfs'] < 0
    assert abs(result['duration'] - row['durationSeconds']) < 1e-8
    audio = p/'wav'/row['batch']/row['replayFilename']
    with wave.open(str(audio)) as w:
        assert w.getnframes() == result['frames']
        w.setpos(w.getnframes()-4410)
        import struct
        ending = struct.unpack('<'+'h'*(4410*2), w.readframes(4410))
        end_peak = max(abs(v) for v in ending)
    endpoints.append({'seed':row['seed'], 'last100msPeakPCM16':end_peak})
    assert end_peak <= 2, (row['seed'], end_peak)
handoffs = json.loads((p/'batch-handoff-validation.json').read_text())
legacy = json.loads((p/'batch-g3-validation.json').read_text())
assert legacy['g3SampleIdentical'] and handoffs['allDirectVoicesClearBeforeBell']
out = {
    'engine':29, 'recordings':16, 'batches':{'reference':8,'random':8},
    'allDistinctAudio':True, 'allFiniteAndUnclipped':True,
    'maximumTruePeakDbfs':max(r['truePeakDbfs'] for r in results),
    'minimumTruePeakDbfs':min(r['truePeakDbfs'] for r in results),
    'totalDurationSeconds':sum(r['duration'] for r in results),
    'checkedHandoffs':sum(len(s['entries']) for s in handoffs['scoreChecks']),
    'directGapSeconds':2, 'g3SampleIdentical':True,
    'g3PcmSha256':legacy['results'][0]['pcmSha256'],
    'playerSha256':player_hash, 'naturalEndings':endpoints,
    'analysisMethod':analysis['method_version']
}
(p/'batch-delivery-validation.json').write_text(json.dumps(out,indent=2))
print(json.dumps({k:v for k,v in out.items() if k!='naturalEndings'},indent=2))
