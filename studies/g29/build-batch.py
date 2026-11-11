from pathlib import Path
import json, re

p = Path(__file__).resolve().parent
manifest = json.loads((p/'manifest.json').read_text())
source = (p/'deliverables/Open-Filtered-Spectral-Organ-g29.html').read_text()
groups = []
for batch, label in [('reference', 'Based on 0b086950'), ('random', 'New random studies')]:
    options = '\n'.join(f'<option value="{r["seed"]}">{r["seed"]}</option>' for r in manifest['recordings'] if r['batch'] == batch)
    groups.append(f'<optgroup label="{label}">\n{options}\n</optgroup>')
updated, count = re.subn(r'(<select id="batchSeed">).*?(</select>)', lambda m: m[1]+'\n'+'\n'.join(groups)+'\n'+m[2], source, flags=re.S)
assert count == 1
assert re.findall(r'<script\b[^>]*>(.*?)</script>', source, re.S) == re.findall(r'<script\b[^>]*>(.*?)</script>', updated, re.S)
(p/'deliverables/Open-g29-Sixteen-New-Studies.html').write_text(updated)
print('Updated only the study selector; engine scripts unchanged.')
