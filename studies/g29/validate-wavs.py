from pathlib import Path
import json, subprocess, re, hashlib, concurrent.futures, wave, time

p=Path(__file__).resolve().parent
m=json.loads((p/'manifest.json').read_text())

def validate(row):
    wav=p/'wav'/row['batch']/row['replayFilename']
    result_path=p/'render-results'/f'{row["seed"]}.json'
    deadline=time.monotonic()+1800
    while not result_path.exists():
        if time.monotonic()>deadline:raise TimeoutError(row['seed'])
        time.sleep(1)
    result=json.loads(result_path.read_text())
    with wave.open(str(wav)) as audio:
        assert audio.getnchannels()==2 and audio.getsampwidth()==2 and audio.getframerate()==44100
        assert audio.getnframes()==result['frames']
    assert result['clipped']==0 and result['nonfinite']==0
    check=subprocess.run(['ffmpeg','-hide_banner','-nostats','-threads','1','-i',str(wav),
                          '-af','ebur128=peak=true:framelog=verbose','-f','null','-'],capture_output=True,text=True,check=True)
    peak=re.findall(r'True peak:\s*Peak:\s*([-0-9.inf]+)\s*dBFS',check.stderr)
    assert peak,(row['seed'],check.stderr[-2000:])
    true_peak=float(peak[-1]);assert true_peak<0,(row['seed'],true_peak)
    result.update(wavSha256=hashlib.file_digest(wav.open('rb'),'sha256').hexdigest(),truePeakDbfs=true_peak,wavBytes=wav.stat().st_size)
    (p/'render-results'/f'{row["seed"]}.json').write_text(json.dumps(result,indent=2))
    print(json.dumps({'seed':row['seed'],'samplePeakDb':round(result['peakDb'],3),'truePeakDb':true_peak}),flush=True)
    return result

with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    results=list(pool.map(validate,m['recordings']))
assert len(results)==16 and len({r['pcmSha256'] for r in results})==16
(p/'render-validation.json').write_text(json.dumps(results,indent=2))
print('All 16 WAVs distinct, complete, and below clipping',flush=True)
