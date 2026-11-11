from pathlib import Path
import zipfile

p=Path(__file__).resolve().parent
files=['README.md','build-g28.py','principal-plenum.js','verify-g28.cjs','check-g28-audio.cjs',
       'check-g28-effects.cjs','render-g28.cjs','render.cjs','harness.cjs','test-harness.cjs','wav-worker.js',
       'make-g28-preview.py','measure-organ.py','package-g28.py','manifest-g28.json','score-g28-40dc1965.json',
       'g28-score-validation.json','g28-audio-validation.json','g28-effects-validation.json',
       'g28-full-render.json','g28-delivery-validation.json','organ-comparison.json',
       'source/Open-Mirrored-Study-g27.html','source/README-g27.md','source/manifest-g27.json',
       'deliverables/Open-Principal-Plenum-g28.html','Open-g28-branch.bundle']
dest=p/'deliverables/Open-g28-Source-and-Validation.zip'
files = [name for name in files if not name.endswith('.bundle') or (p/name).exists()]
with zipfile.ZipFile(dest,'w',zipfile.ZIP_DEFLATED) as z:
    for filename in files:z.write(p/filename,'Open-g28/'+filename)
with zipfile.ZipFile(dest) as z:assert z.testzip() is None
print(dest.name,dest.stat().st_size)
