"""Open melody/FM comparison, using the retained early-note measurement protocol."""
import json, math
from pathlib import Path
import numpy as np
from scipy.signal import find_peaks, lfilter

RATE=16000
NFFT=16384
OFFSETS=(.05,.65,1.30)
WINDOW=8000
FREQUENCIES=np.fft.rfftfreq(NFFT,1/RATE)
BAND=(FREQUENCIES>=60)&(FREQUENCIES<=7500)
HANN=np.hanning(WINDOW)

def spectral(x):
    if x.ndim==1:x=x[:,None]
    if len(x)<WINDOW:x=np.pad(x,((0,WINDOW-len(x)),(0,0)))
    power=np.mean(np.abs(np.fft.rfft(x[:WINDOW]*HANN[:,None],n=NFFT,axis=0))**2,axis=1)
    amplitude=np.sqrt(power)
    f=FREQUENCIES[BAND];a=amplitude[BAND];p=power[BAND]
    centroid=float(np.sum(f*a)/np.sum(a))
    energy_1k=float(np.sum(p[f>=1000])/np.sum(p))
    energy_2k=float(np.sum(p[f>=2000])/np.sum(p))
    inds,_=find_peaks(a,height=.015*a.max(),prominence=.005*a.max(),distance=5)
    inds=inds[np.argsort(a[inds])[-24:]]
    if len(inds):
        la=np.log(np.maximum(a,1e-30))
        delta=.5*(la[inds-1]-la[inds+1])/(la[inds-1]-2*la[inds]+la[inds+1])
        pf=f[inds]+delta*(RATE/NFFT);pa=a[inds];pa=pa/np.sqrt(np.sum(pa**2))
        order=np.argsort(pf);pf=pf[order];pa=pa[order]
        i,j=np.triu_indices(len(pa),1);sep=pf[j]-pf[i];s=.24/(.0207*pf[i]+18.96)
        amin=np.minimum(pa[i],pa[j]);amax=np.maximum(pa[i],pa[j])
        rough=float(np.sum(5*amin*(np.exp(-3.51*s*sep)-np.exp(-5.75*s*sep))))
        vas=float(np.sum((amin*amax)**.1*.5*(2*amin/(amin+amax))**3.11*(np.exp(-3.5*s*sep)-np.exp(-5.75*s*sep))))
    else:rough=vas=0.
    return dict(centroid=centroid,energy_1k=energy_1k,energy_2k=energy_2k,roughness=rough,vassilakis=vas)

def early(x,start=0):
    values=[spectral(x[round((start+off)*RATE):round((start+off)*RATE)+WINDOW]) for off in OFFSETS]
    return {k:float(np.mean([v[k] for v in values])) for k in values[0]}

def synth(note,controlled=False):
    f0=200 if controlled else note['freq']
    dur=20 if controlled else note['duration']
    t=np.arange(round(1.81*RATE))/RATE
    signal=np.zeros_like(t)
    w0=2*np.pi*min(f0*3.5,6000)/RATE
    alpha=np.sin(w0)/(2*10**(.6/20));cs=np.cos(w0)
    b=np.array([(1-cs)/2,1-cs,(1-cs)/2])/(1+alpha)
    a=np.array([1+alpha,-2*cs,1-alpha])/(1+alpha)
    for v in note['voices']:
        fc=v['frequency']*f0/note['freq'];fm=f0*v['modRatio'];depth=f0*v['modIndex']
        k=np.log(v['modIndex']/.01)/(.3*dur);w=2*np.pi*fm
        tt=np.minimum(t,.3*dur)
        integ=depth*(w-np.exp(-k*tt)*(k*np.sin(w*tt)+w*np.cos(w*tt)))/(k*k+w*w)
        if np.any(t>.3*dur):
            mask=t>.3*dur
            integ[mask]+=f0*.01*(np.cos(w*.3*dur)-np.cos(w*t[mask]))/w
        phase=2*np.pi*(fc*t+integ)
        amp=v['amp']/note['totalAmp']*note['volume']
        env=amp*(.0001/amp)**((t-.01)/(dur-.01))
        attack=t<=.01
        env[attack]=.0001*(amp/.0001)**(t[attack]/.01)
        signal+=lfilter(b,a,np.sin(phase)*env)
    return signal

def recipe(note):
    weights=np.array([v['amp'] for v in note['voices']]);weights/=weights.sum()
    beta=float(sum(w*v['modIndex']/v['modRatio'] for w,v in zip(weights,note['voices'])))
    fs=np.array([v['frequency'] for v in note['voices']])
    i,j=np.triu_indices(len(fs),1);pair_weights=weights[i]*weights[j]
    gap=float(np.sum(np.abs(fs[i]-fs[j])*pair_weights)/sum(pair_weights)) if len(i) else 0.
    return dict(beta=beta,carrier_gap=gap,voice_count=len(fs),fractured=int(len({v['modRatio'] for v in note['voices']})>1))

if __name__=='__main__':
    p=Path(__file__).resolve().parent
    prior=json.loads((p/'reference-data.json').read_text())['reference']
    score=json.loads((p/'0b086950-g3-score.json').read_text())
    notes=[n for g in score['groups'] for n in g['notes'] if n['kind']=='bell']
    for i in [0,1,2,4,12,25,70,110]:
        n=notes[i];r=early(synth(n,True));old=prior['notes'][i]
        print(i+1,'rough',r['roughness'],old['controlled_roughness'],'centroid',r['centroid'],old['controlled_centroid'],'beta',recipe(n)['beta'],old['beta'])
