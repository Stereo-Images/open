import argparse, hashlib, json, math, subprocess, wave
from pathlib import Path
import numpy as np

p=Path(__file__).resolve().parent
parser=argparse.ArgumentParser()
parser.add_argument('--old-wav',type=Path)
args=parser.parse_args()
manifest=json.loads((p/'manifest-g28.json').read_text())
row=manifest['recordings'][0]
oldrow=next(r for r in json.loads((p/'source/manifest-g27.json').read_text())['recordings'] if r['seed']==row['seed'])
old=args.old_wav or p.parent/'open-g27/wav/reference'/oldrow['replayFilename']
new=p/'deliverables'/row['replayFilename']
score=json.loads((p/'score-g28-40dc1965.json').read_text())
entry=score['study']['droneArch']['interludes'][0]
rate=44100
start=round((entry['start']-10)*rate)
length=50*rate
def read(path,start,length):
    with wave.open(str(path),'rb') as w:
        assert (w.getnchannels(),w.getframerate(),w.getsampwidth())==(2,rate,2)
        w.setpos(start)
        data=w.readframes(length)
        assert len(data)==length*4
        return data

prefix=math.floor(entry['start']*rate)
assert read(old,0,prefix)==read(new,0,prefix),'Pre-organ bells and accompaniment must remain sample-identical'
chunks=[]
for path in [old,new]:
    audio=np.frombuffer(read(path,start,length),dtype='<i2').reshape(-1,2).astype(np.float64)
    fade=round(.020*rate)
    audio[:fade]*=np.linspace(0,1,fade)[:,None]
    audio[-fade:]*=np.linspace(1,0,fade)[:,None]
    chunks.append(np.rint(audio).astype('<i2').tobytes())
dest=p/'deliverables/Open-40dc1965-Organ-Comparison-g27-then-g28.wav'
with wave.open(str(dest),'wb') as w:
    w.setnchannels(2);w.setsampwidth(2);w.setframerate(rate)
    w.writeframes(chunks[0]+bytes(2*rate*4)+chunks[1])
run=subprocess.run(['ffmpeg','-hide_banner','-nostats','-i',str(new),'-af',
    'loudnorm=I=-23:TP=-1:LRA=11:print_format=json','-f','null','-'],capture_output=True,text=True,check=True)
loudness=json.JSONDecoder().raw_decode(run.stderr[run.stderr.rfind('{'):])[0]
assert float(loudness['input_tp'])<0
render=json.loads((p/'g28-full-render.json').read_text())
with wave.open(str(new),'rb') as w:
    assert w.getnframes()==render['frames']
    assert abs(w.getnframes()/rate-row['durationSeconds'])<1/rate
assert render['clipped']==0 and render['nonfinite']==0
assert render['playerSha256']==hashlib.sha256((p/'deliverables/Open-Principal-Plenum-g28.html').read_bytes()).hexdigest()
result={'seed':row['seed'],'engine':28,'fullFilename':new.name,'durationSeconds':row['durationSeconds'],
    'fullWavSha256':hashlib.file_digest(new.open('rb'),'sha256').hexdigest(),
    'sampleIdenticalBeforeFirstOrgan':True,'truePeakDbfs':float(loudness['input_tp']),
    'integratedLUFS':float(loudness['input_i']),'clippedSamples':render['clipped'],
    'previewFilename':dest.name,'previewDurationSeconds':102,'previewOldStart':0,'previewNewStart':52,
    'organEntriesInPreviewSeconds':[10,62],'returningBellsInPreviewSeconds':[34,86],
    'previewLevelAdjustmentDb':0,'boundaryFadesMilliseconds':20}
(p/'g28-delivery-validation.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
