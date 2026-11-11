from pathlib import Path
import json,subprocess,numpy as np
p=Path(__file__).resolve().parent
rows=json.loads((p/'manifest.json').read_text())['recordings'];out=[]
for r in rows:
    result=p/'render-results'/f'{r["seed"]}.json'
    if not result.exists():continue
    s=json.loads((p/'scores'/f'{r["seed"]}.json').read_text());e=s['study']['droneArch']['interludes'][0]
    bells=[n for g in s['groups'] for n in g['notes'] if n['kind']=='bell' and n['time']<e['start']]
    start=bells[-1]['time'];stop=e['start']+8;wav=p/'wav'/r['batch']/r['replayFilename']
    raw=subprocess.check_output(['ffmpeg','-v','error','-ss',str(start),'-t',str(stop-start),'-i',str(wav),'-ar','8000','-ac','2','-f','f32le','-'])
    x=np.frombuffer(raw,'<f4').reshape(-1,2);x=x[:len(x)//2000*2000].reshape(-1,2000,2)
    db=10*np.log10(np.maximum(np.mean(x*x,axis=(1,2)),1e-30))
    def longest(th):
        run=best=0
        for b in db<th:run=run+1 if b else 0;best=max(best,run)
        return best*.25
    out.append({'seed':r['seed'],'firstStrikeToOrganSeconds':e['start']-start,'longestBelowMinus60DbfsSeconds':longest(-60),'longestBelowMinus55DbfsSeconds':longest(-55),'rmsAtOrganOnsetDbfs':float(db[int((e['start']-start)/.25)])})
print(json.dumps(out,indent=2))
(p/'entry-audibility-validation.json').write_text(json.dumps({'method':'First transition, last bell onset to 8 seconds after organ onset; 250 ms stereo RMS at 8 kHz. Thresholds describe measured low levels, not universal perceptual silence.','recordings':out},indent=2))
