from pathlib import Path
import concurrent.futures, json, math, subprocess, sys
import numpy as np
from metrics import RATE, spectral, early, synth, recipe

P=Path(__file__).resolve().parent
ROOT=P.parent
MANIFEST=json.loads((ROOT/'manifest.json').read_text())

def name(freq):
    midi=int(np.floor(69+12*np.log2(freq/440)+.5))
    return ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][midi%12]+str(midi//12-1)

def whole_centroid(x):
    n=2048;f=np.fft.rfftfreq(n,1/RATE);band=(f>=60)&(f<=7500);w=np.hanning(n)
    total=weighted=0.
    for offset in range(0,len(x)-n+1,RATE//2):
        frame=x[offset:offset+n];energy=float(np.mean(frame.astype(float)**2))
        if energy<1e-6:continue
        a=np.sqrt(np.mean(abs(np.fft.rfft(frame*w[:,None],axis=0))**2,axis=1))[band]
        weighted+=float(np.sum(f[band]*a)/np.sum(a))*energy;total+=energy
    return weighted/total

def analyze(row):
    seed=row['seed'];score=json.loads((ROOT/'scores'/f'{seed}.json').read_text())
    wav=ROOT/'wav'/row['batch']/row['replayFilename']
    raw=subprocess.check_output(['ffmpeg','-v','error','-i',str(wav),'-f','f32le','-ac','2','-ar',str(RATE),'-threads','1','-'])
    x=np.frombuffer(raw,dtype='<f4').reshape(-1,2)
    bells=[(g,n) for g in score['groups'] for n in g['notes'] if n['kind']=='bell']
    arch=score['study']['droneArch'];returns=[v['returnTime'] for v in arch['interludes']]
    notes=[]; cache={}
    for i,(group,note) in enumerate(bells):
        prev=bells[i-1][1] if i else None
        interval=round(12*np.log2(note['freq']/prev['freq'])) if prev else None
        gap=note['time']-prev['time'] if prev else None
        reentry=int(any(abs(note['time']-t)<1e-7 for t in returns))
        recorded=early(x,note['time'])
        recipe_key=json.dumps({k:v for k,v in note.items() if k!='time'},sort_keys=True)
        if recipe_key not in cache:cache[recipe_key]=(early(synth(note,True)),early(synth(note)))
        controlled,dry=cache[recipe_key]
        window=x[round((note['time']+.05)*RATE):round((note['time']+.55)*RATE)].astype(float)
        rec=dict(seed=seed,note=i+1,time=note['time'],pitch=name(note['freq']),frequency=note['freq'],
            semitones=round(12*np.log2(note['freq']/row['rootHz'])),interval=interval,abs_interval=abs(interval) if interval is not None else None,
            gap=gap,reentry=reentry,step=int(interval is not None and abs(interval) in [1,2]),
            tritone=int(interval is not None and abs(interval)==6 and not reentry),
            seventh=int(interval is not None and abs(interval) in [10,11] and not reentry),
            above_octave=int(interval is not None and abs(interval)>12 and not reentry),
            cycle=group.get('study',{}).get('cycle'),slot=group.get('study',{}).get('slot'),
            centroid=recorded['centroid'],energy_1k=recorded['energy_1k'],energy_2k=recorded['energy_2k'],
            recorded_roughness=recorded['roughness'],recorded_vassilakis=recorded['vassilakis'],
            controlled_roughness=controlled['roughness'],controlled_vassilakis=controlled['vassilakis'],
            controlled_centroid=controlled['centroid'],dry_roughness=dry['roughness'],**recipe(note),
            nominal_decay=note['duration'],volume=note['volume'],
            early_rms_dbfs=float(10*np.log10(max(np.mean(window*window),1e-30))))
        notes.append(rec)
    interludes=[]
    for g in [g for g in score['groups'] if g.get('interlude')]:
        t=g['time'];specs=[spectral(x[round((t+off)*RATE):round((t+off)*RATE)+RATE//2]) for off in np.arange(3,9.01,.5)]
        a=x[round((t+3)*RATE):round((t+9.5)*RATE)].astype(float)
        mid=(a[:,0]+a[:,1])/2;side=(a[:,0]-a[:,1])/2
        rms_db=10*np.log10(max(np.mean(a*a),1e-30))
        side_mid=10*np.log10(max(np.mean(side*side),1e-30)/max(np.mean(mid*mid),1e-30))
        blocks=a[:len(a)//4000*4000].reshape(-1,4000,2)
        env=10*np.log10(np.maximum(np.mean(blocks*blocks,axis=(1,2)),1e-30));tt=np.arange(len(env))
        residual=env-np.polyval(np.polyfit(tt,env,1),tt)
        voices=[n for n in g['notes'] if n.get('organ')]
        interludes.append(dict(seed=seed,index=g['interlude']['index'],swell=g['interlude']['swell'],time=t,
            harmony=g['interlude']['harmony']['name'],voice_count=len(voices),
            centroid=float(np.mean([s['centroid'] for s in specs])),roughness=float(np.mean([s['roughness'] for s in specs])),
            rms_dbfs=float(rms_db),side_mid_db=float(side_mid),envelope_sd_db=float(np.std(residual)),
            registration=voices[0]['organ']['registration'],feedback=voices[0]['organ']['chorus']['feedback'],
            paired_index=g['interlude']['pairedIndex'],
            voice_frequencies=[n['freq'] for n in voices],
            inversion=g['interlude']['harmony']['inversion'],
            dry_end=max(n['time']+n['duration'] for n in voices),
            return_time=arch['interludes'][g['interlude']['index']-1]['returnTime'],
            filter_sweep=True,spectral_chorus=True))
    gaps=[n['gap'] for n in notes[1:]];intraph=[n['gap'] for n in notes[1:] if not n['reentry']]
    cycle_groups={}
    for g,n in bells:cycle_groups.setdefault(g['study']['cycle'],[]).append(n)
    melody=[n['freq'] for n in next(iter(cycle_groups.values()))]
    assert all([n['freq'] for n in ns]==melody for ns in cycle_groups.values())
    unique_palettes=len(set(json.dumps([n['voices'] for n in ns],sort_keys=True) for ns in cycle_groups.values()))
    assert unique_palettes==len(cycle_groups)//2
    tone=row['rootHz'];harmony=[v['harmony'] for v in arch['interludes']]
    render=json.loads((ROOT/'render-results'/f'{seed}.json').read_text())
    summary=dict(seed=seed,batch=row['batch'],engine=int(row['engine']),duration=row['durationSeconds'],notes=len(notes),
        stepwise=sum(n['step'] for n in notes)/(len(notes)-1),stepwise_within_phrases=sum(n['step'] for n in notes[1:] if not n['reentry'])/len(intraph),
        tritones=sum(n['tritone'] for n in notes),sevenths=sum(n['seventh'] for n in notes),above_octave=sum(n['above_octave'] for n in notes),
        scale_changes=0,nominal_bpm=row['nominalBpm'],median_gap=float(np.median(gaps)),median_within_phrase_gap=float(np.median(intraph)),
        minimum_gap=min(gaps),max_gap=max(gaps),melody_pauses=sum(n['reentry'] for n in notes),
        iterations=len(cycle_groups),unique_fm_palettes=unique_palettes,
        chord_counts=arch['pattern'],palette_order=score['study']['mirror']['paletteOrder'],
        mirror_midpoint=score['study']['mirror']['midpoint'],
        theme_semitones=[round(12*np.log2(f/tone)) for f in melody],
        ending=notes[-1]['pitch'],ending_semitones=notes[-1]['semitones'],ending_tail_seconds=row['durationSeconds']-notes[-1]['time'],
        whole_centroid=whole_centroid(x),drone_entries=len(interludes),
        distinct_chord_pitch_sets=len(set(tuple(sorted(h['pitchClasses'])) for h in harmony)),
        interlude_chord_sequence=' / '.join(h['name'] for h in harmony),
        first_inversions=sum(h['inversion']==1 for h in harmony),triad_interludes=sum(h['voiceCount']==3 for h in harmony),
        brightest_note=max(notes,key=lambda n:n['centroid'])['note'],brightest_time=max(notes,key=lambda n:n['centroid'])['time'],
        roughest_note=max(notes,key=lambda n:n['recorded_roughness'])['note'],roughest_time=max(notes,key=lambda n:n['recorded_roughness'])['time'],
        roughness_p90=float(np.percentile([n['recorded_roughness'] for n in notes],90)),
        median_pitch=float(np.median([n['frequency'] for n in notes])),replay_filename=row['replayFilename'],
        wav_sha256=render.get('wavSha256'),pcm_peak_dbfs=render['peakDb'],true_peak_dbfs=render.get('truePeakDbfs'),
        source_theme_semitones=row['sourceThemeSemitones'],
        first_half_palette_count=unique_palettes,ending_policy='complete-mirror',
        background_chords=sum(bool(g.get('background')) for g in score['groups']))
    for key in ['centroid','recorded_roughness','recorded_vassilakis','controlled_roughness','controlled_vassilakis','controlled_centroid','dry_roughness','beta','energy_1k','energy_2k','carrier_gap','fractured']:
        summary[key]=float(np.mean([n[key] for n in notes]))
    for key in ['centroid','roughness','rms_dbfs','side_mid_db','envelope_sd_db']:
        summary['interlude_'+key]=float(np.mean([v[key] for v in interludes]))
    summary['bell_early_rms_dbfs']=float(np.mean([n['early_rms_dbfs'] for n in notes]))
    summary['interlude_minus_bell_db']=summary['interlude_rms_dbfs']-summary['bell_early_rms_dbfs']
    result=dict(summary=summary,notes=notes,interludes=interludes)
    (P/'results').mkdir(exist_ok=True);(P/'results'/f'{seed}.json').write_text(json.dumps(result,indent=2))
    print(json.dumps({k:summary[k] for k in ['seed','notes','stepwise','centroid','recorded_roughness','controlled_roughness','beta','energy_1k']}),flush=True)
    return result

def save_results(records):
    prior=json.loads((P/'reference-data.json').read_text())
    data=dict(engine=29,method_version='open-early-fm-v1-recovered',calibration=json.loads((P/'calibration.json').read_text()),
        method=prior['method'],stepwise_convention=prior['stepwise_convention'],limits=prior['limits'],
        interlude_method={**prior['granular_method'],
            'scope':'Recorded Principal organ windows, including lingering bells and any previous organ-statement tail; not granular or isolated-voice measurements.',
            'reason':'The windows match the earlier protocol, fall within each 22-second statement, and precede the returning bell.',
            'averaging':'Each chord statement has equal weight.'},
        reference_summary=prior['reference']['summary'],recordings=records)
    (P/'Open-g29-Sixteen-Studies-Analysis-Data.json').write_text(json.dumps(data,indent=2))

if __name__=='__main__':
    rows=MANIFEST['recordings']
    if len(sys.argv)>1:rows=[r for r in rows if r['seed'] in sys.argv[1:]]
    with concurrent.futures.ProcessPoolExecutor(max_workers=2) as pool:records=list(pool.map(analyze,rows))
    save_results(records)
