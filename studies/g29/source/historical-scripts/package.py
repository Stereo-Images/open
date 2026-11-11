from pathlib import Path
import zipfile

p=Path(__file__).resolve().parent
names=['README.md','manifest.json','build.py','audible-organ-room.js','harness.cjs','test-harness.cjs','wav-worker.js',
       'verify-mirror.cjs','effects-check.cjs','effects-validation.json','room-check.cjs','room-validation.json','scheduler-check.cjs','render.cjs','check-native.cjs',
       'validate-wavs.py','package.py','render-batch.py','select-seeds.cjs','refresh-scores.cjs','excluded-seeds.json',
       'batch-validation.json','mirror-validation.json','scheduler-validation.json','audio-validation.json','render-validation.json','player-validation.json','player-check.cjs','reverb-comparison.json','handoff-validation.json','handoff-check.cjs','zip-wavs.py','wav-archive-validation.json','entry-audibility.py','entry-audibility-validation.json',
       'source/Open-Mirrored-Study-g26.html','source/README-g26.md','source/manifest-g26.json','deliverables/Open-Mirrored-Study-g27.html',
       'analysis/analyze.py','analysis/analyze-when-ready.py','analysis/metrics.py','analysis/calibrate.py','analysis/calibration.json',
       'analysis/reference-data.json','analysis/0b086950-g3-score.json','analysis/build-workbook.mjs','analysis/aesthetic-picks.json',
       'analysis/Open-g27-Sixteen-Studies-Analysis-Data.json']
import json
for row in json.loads((p/'manifest.json').read_text())['recordings']:
    names.extend([f'scores/{row["seed"]}.json',f'render-results/{row["seed"]}.json',f'analysis/results/{row["seed"]}.json'])
if (p/'Open-g27-branch.bundle').exists():names.append('Open-g27-branch.bundle')
dest=p/'deliverables/Open-g27-Source-and-Validation.zip'
with zipfile.ZipFile(dest,'w',zipfile.ZIP_DEFLATED) as z:
    for name in names:z.write(p/name,'Open-g27/'+name)
with zipfile.ZipFile(dest) as z:assert z.testzip() is None
print(dest.name, dest.stat().st_size)
