from pathlib import Path
import concurrent.futures, json, subprocess, time

p=Path(__file__).resolve().parent
(p/'logs').mkdir(exist_ok=True)
rows=json.loads((p/'manifest.json').read_text())['recordings']

def render(row):
    seed=row['seed']; started=time.time()
    result_file=p/'render-results'/f'{seed}.json'
    wav=p/'wav'/row['batch']/row['replayFilename']
    if not (result_file.exists() and wav.exists()):
        for attempt in range(3):
            log_path=p/'logs'/f'{seed}-attempt-{attempt+1}.log'
            with log_path.open('w') as log:
                run=subprocess.run(['node',str(p/'render.cjs'),seed],stdout=log,stderr=subprocess.STDOUT)
            if run.returncode==0:break
            if attempt==2 or 'OfflineAudioContext.suspend' not in log_path.read_text():run.check_returncode()
            print(json.dumps({'retrying':seed,'attempt':attempt+2}),flush=True)
    result=json.loads(result_file.read_text())
    assert result['clipped']==0 and result['nonfinite']==0
    assert abs(result['duration']-row['durationSeconds'])<1e-8
    assert wav.stat().st_size==44+result['frames']*4
    print(json.dumps({'completed':seed,'batch':row['batch'],'seconds':round(time.time()-started,1),'peakDb':round(result['peakDb'],2)}),flush=True)
    return result

with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    futures=[pool.submit(render,row) for row in rows]
    for future in concurrent.futures.as_completed(futures):future.result()
print('All 16 WAV renders passed sample clipping and finite-value checks',flush=True)
