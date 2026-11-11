from pathlib import Path
import zipfile

p=Path(__file__).resolve().parent
files=['README.md','build-g29.py','spectral-organ.js','verify-g29.cjs','check-g29-audio.cjs',
       'check-g29-effects.cjs','render-g29.cjs','render.cjs','harness.cjs','test-harness.cjs','wav-worker.js',
       'make-g29-preview.py','measure-g29-organ.py','package-g29.py','manifest-g29.json','score-g29-40dc1965.json',
       'g29-score-validation.json','g29-audio-validation.json','g29-effects-validation.json',
       'g29-full-render.json','g29-delivery-validation.json','g29-organ-comparison.json',
       'source/Open-Principal-Plenum-g28.html','source/README-g28.md','source/manifest-g27.json',
       'g28-audio-validation.json','deliverables/Open-Filtered-Spectral-Organ-g29.html','Open-g29-branch.bundle']
dest=p/'deliverables/Open-g29-Source-and-Validation.zip'
files = [name for name in files if not name.endswith('.bundle') or (p/name).exists()]
with zipfile.ZipFile(dest,'w',zipfile.ZIP_DEFLATED) as z:
    for filename in files:z.write(p/filename,'Open-g29/'+filename)
with zipfile.ZipFile(dest) as z:assert z.testzip() is None
print(dest.name,dest.stat().st_size)
