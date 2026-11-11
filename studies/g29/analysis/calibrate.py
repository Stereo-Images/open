"""Check all 128 retained reference notes against the previous FM analysis."""
import json
from pathlib import Path
from metrics import early, synth, recipe

p=Path(__file__).resolve().parent
prior=json.loads((p/'reference-data.json').read_text())['reference']['notes']
score=json.loads((p/'0b086950-g3-score.json').read_text())
notes=[n for g in score['groups'] for n in g['notes'] if n['kind']=='bell']
errors={k:0. for k in ['controlled_roughness','controlled_centroid','dry_roughness','beta','carrier_gap']}
assert len(notes)==len(prior)==128
for note,old in zip(notes,prior):
    controlled=early(synth(note,True));dry=early(synth(note))
    values={'controlled_roughness':controlled['roughness'],'controlled_centroid':controlled['centroid'],
            'dry_roughness':dry['roughness'],**recipe(note)}
    for key in errors:errors[key]=max(errors[key],abs(values[key]-old[key]))
assert max(errors.values())<1e-8,errors
result={'referenceSeed':'0b086950','engine':3,'notes':len(notes),'maximumAbsoluteErrors':errors}
(p/'calibration.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
