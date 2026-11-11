"""Add g29 organ metadata without repeating unchanged signal measurements."""
from pathlib import Path
import json

p = Path(__file__).resolve().parent
data_path = p/'Open-g29-Sixteen-Studies-Analysis-Data.json'
data = json.loads(data_path.read_text())
for record in data['recordings']:
    for entry in record['interludes']:
        entry.pop('motion', None)
        entry.update(filter_sweep=True, spectral_chorus=True)
    (p/'results'/f'{record["summary"]["seed"]}.json').write_text(json.dumps(record,indent=2))
data['interlude_method']['synthesis'] = 'Filtered Principal pipe ranks, three-band slow chorus, 10% filtered feedback, then 12-second convolution. No granular interlude processing.'
data_path.write_text(json.dumps(data,indent=2))
print('Recorded organ measurements retain their original windows; g29 synthesis metadata added.')
