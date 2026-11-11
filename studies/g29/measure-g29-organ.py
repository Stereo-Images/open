import json, subprocess
from pathlib import Path
import numpy as np
from scipy.signal import welch
from scipy.io import wavfile

p=Path(__file__).resolve().parent
rows=[]
for index in [1,6]:
    for engine in [27,28,29]:
        filename=p/f'checks/compare-g{engine}-{index}.wav'
        rate,audio=wavfile.read(filename)
        audio=audio.astype(np.float64)/32768
        stop=(22 if index==1 else 66)*rate
        active=audio[3*rate:stop-2*rate]
        frequencies,power=welch(active,rate,nperseg=32768,axis=0)
        power=power.mean(axis=1)
        amplitude=np.sqrt(power)
        valid=(frequencies>=40)&(frequencies<=10000)
        centroid=np.sum(frequencies[valid]*amplitude[valid])/amplitude[valid].sum()
        run=subprocess.run(['ffmpeg','-hide_banner','-nostats','-i',str(filename),'-af','loudnorm=I=-23:TP=-1:LRA=11:print_format=json','-f','null','-'],capture_output=True,text=True,check=True)
        mid=active.mean(axis=1);side=(active[:,0]-active[:,1])/2
        width=float(10*np.log10(np.mean(side**2)/np.mean(mid**2)))
        correlation=float(np.corrcoef(active.T)[0,1])
        loudness=json.JSONDecoder().raw_decode(run.stderr[run.stderr.rfind('{'):])[0]
        rows.append(dict(engine=engine,interlude=index,duration=len(audio)/rate,
            activeRmsDbfs=float(20*np.log10(np.sqrt(np.mean(active**2)))),
            centroidHz=float(centroid),energyAbove1kPercent=float(power[frequencies>=1000].sum()/power.sum()*100),
            sideMidDb=width,channelCorrelation=correlation,integratedLUFS=float(loudness['input_i']),truePeakDbfs=float(loudness['input_tp'])))
for index in [1,6]:
    r={row['engine']:row for row in rows if row['interlude']==index}
    assert r[29]['centroidHz']<r[28]['centroidHz']
    assert r[29]['truePeakDbfs']<0
    assert r[29]['channelCorrelation']>0
(p/'g29-organ-comparison.json').write_text(json.dumps(rows,indent=2))
print(json.dumps(rows,indent=2))
