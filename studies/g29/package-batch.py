from pathlib import Path
import json, zipfile

p = Path(__file__).resolve().parent
names = json.loads((p/'batch-package-files.json').read_text())
names += ['finalize-batch.py','package-batch.py','batch-package-files.json']
dest = p/'deliverables/Open-g29-Sixteen-Studies-Source-and-Analysis.zip'
names = [name for name in names if not name.endswith('.bundle') or (p/name).exists()]
with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED) as z:
    for name in names:
        z.write(p/name, 'Open-g29-Sixteen-Studies/'+name)
with zipfile.ZipFile(dest) as z:
    assert z.testzip() is None
print(dest.name, dest.stat().st_size)
