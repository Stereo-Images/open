import json, subprocess
from pathlib import Path
import numpy as np
from scipy.signal import welch
from scipy.io import wavfile

p=Path(__file__).resolve().parent
rows=[]
for index in [1,6]:
    for engine in [27,28]:
        filename=p/f'checks/balance-g{engine}-{index}.wav'
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
        loudness=json.JSONDecoder().raw_decode(run.stderr[run.stderr.rfind('{'):])[0]
        rows.append(dict(engine=engine,interlude=index,duration=len(audio)/rate,
            activeRmsDbfs=float(20*np.log10(np.sqrt(np.mean(active**2)))),
            centroidHz=float(centroid),energyAbove1kPercent=float(power[frequencies>=1000].sum()/power.sum()*100),
            integratedLUFS=float(loudness['input_i']),truePeakDbfs=float(loudness['input_tp'])))
(p/'organ-comparison.json').write_text(json.dumps(rows,indent=2))
print(json.dumps(rows,indent=2))
