from pathlib import Path
import json,time,concurrent.futures
import analyze

def ready(row):
    file=analyze.ROOT/'render-results'/f'{row["seed"]}.json'
    deadline=time.monotonic()+1800
    while True:
        if file.exists():
            try:
                if json.loads(file.read_text()).get('truePeakDbfs') is not None:break
            except json.JSONDecodeError:pass
        if time.monotonic()>deadline:raise TimeoutError(row['seed'])
        time.sleep(1)
    return analyze.analyze(row)

if __name__=='__main__':
    with concurrent.futures.ProcessPoolExecutor(max_workers=2) as pool:
        records=list(pool.map(ready,analyze.MANIFEST['recordings']))
    analyze.save_results(records)
    print('All 16 analyses complete',flush=True)
