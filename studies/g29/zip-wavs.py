from pathlib import Path
import json,zipfile,time,hashlib
p=Path(__file__).resolve().parent
m=json.loads((p/'manifest.json').read_text())
archive=p/'deliverables/Open-g29-All-16-WAVs.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=3,allowZip64=True) as z:
    for r in m['recordings']:
        validation=p/'render-results'/f'{r["seed"]}.json'
        deadline=time.monotonic()+1800
        while True:
            if validation.exists():
                try:
                    if json.loads(validation.read_text()).get('truePeakDbfs') is not None:break
                except json.JSONDecodeError:pass
            if time.monotonic()>deadline:raise TimeoutError(r['seed'])
            time.sleep(1)
        folder='01-Based-on-0b086950' if r['batch']=='reference' else '02-Random-seeds'
        z.write(p/'wav'/r['batch']/r['replayFilename'],f'{folder}/{r["replayFilename"]}')
        print(json.dumps({'archived':r['seed']}),flush=True)
with zipfile.ZipFile(archive) as z:
    assert len(z.namelist())==16 and all(n.endswith('.wav') for n in z.namelist())
    assert z.testzip() is None
info={'file':archive.name,'bytes':archive.stat().st_size,'sha256':hashlib.file_digest(archive.open('rb'),'sha256').hexdigest(),'wavCount':16,'batches':2}
(p/'wav-archive-validation.json').write_text(json.dumps(info,indent=2));print(json.dumps(info),flush=True)
