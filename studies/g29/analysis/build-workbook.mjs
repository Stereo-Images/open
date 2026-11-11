import fs from 'node:fs/promises';
import path from 'node:path';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const root=process.argv[2];
if(!root)throw Error('Pass the absolute Open-g29 directory.');
const data=JSON.parse(await fs.readFile(path.join(root,'analysis/Open-g29-Sixteen-Studies-Analysis-Data.json'),'utf8'));
const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
if(data.recordings.length!==16)throw Error('Expected sixteen completed analyses');
for(const record of data.recordings){
 const row=manifest.recordings.find(r=>r.seed===record.summary.seed);
 if(!row||Math.abs(row.durationSeconds-record.summary.duration)>1e-8)
  throw Error('Analysis does not match the current score: '+record.summary.seed);
}
const picks=JSON.parse(await fs.readFile(path.join(root,'analysis/aesthetic-picks.json'),'utf8'));
for(const pick of picks)if(!manifest.recordings.some(r=>r.seed===pick.seed))throw Error('Unknown recommended seed '+pick.seed);
const outputDir=path.resolve(root,'../outputs/open-g29-batch-analysis');
await fs.mkdir(outputDir,{recursive:true});
const rows=data.recordings.map(r=>r.summary).sort((a,b)=>a.centroid-b.centroid);
const wb=Workbook.create();
const summary=wb.worksheets.add('All recordings');
const comp=wb.worksheets.add('Composition');
const replays=wb.worksheets.add('Replays');
const notes=wb.worksheets.add('FM notes');
const drones=wb.worksheets.add('Drone interludes');
const method=wb.worksheets.add('Method');
const ink='#263E4B', pale='#F0F4F6', gray='#52616B';

function setup(sheet,title,context,headers,values,widths){
 const last=6+values.length,cols=headers.length;
 sheet.showGridLines=false;
 const area=sheet.getRangeByIndexes(0,0,last,cols);
 area.format.font={name:'Arial',size:10,color:'#202B32'};
 area.format.verticalAlignment='center';area.format.rowHeight=21;
 sheet.getRange('A2').values=[[title]];sheet.getRange('A2').format.font={name:'Arial',size:14,bold:true,color:ink};
 sheet.getRangeByIndexes(2,0,1,cols).format.borders={bottom:{style:'thin',color:'#9DADB5'}};
 sheet.getRange('A4').values=[[context]];sheet.getRange('A4').format.font={name:'Arial',size:10,italic:true,color:gray};
 const head=sheet.getRangeByIndexes(5,0,1,cols);head.values=[headers];
 head.format={fill:ink,font:{name:'Arial',size:10,bold:true,color:'#FFFFFF'},wrapText:true,horizontalAlignment:'center',verticalAlignment:'center',rowHeight:42};
 head.format.borders={insideVertical:{style:'thin',color:'#FFFFFF'}};
 const seedColumn=headers.indexOf('Seed');
 // Keep string identifiers intact; this also preserves leading zeroes in previews.
 if(seedColumn>=0&&values.length)sheet.getRangeByIndexes(6,seedColumn,values.length,1).setNumberFormat('00000000');
 if(values.length)sheet.getRangeByIndexes(6,0,values.length,cols).values=values;
 for(let i=0;i<widths.length;i++)sheet.getRangeByIndexes(0,i,last,1).format.columnWidth=widths[i];
 for(let r=6;r<last;r+=2)sheet.getRangeByIndexes(r,0,1,cols).format.fill=pale;
 if(last>35)sheet.freezePanes.freezeRows(6);
 if(cols>10)sheet.freezePanes.freezeColumns(1);
 return last;
}

const allNotes=data.recordings.flatMap(r=>r.notes);
const noteValues=allNotes.map(n=>[n.seed,n.note,n.time/86400,n.pitch,n.interval,n.gap,n.reentry,n.step,n.tritone,n.seventh,n.cycle+1,n.slot+1,n.centroid,n.recorded_roughness,n.controlled_roughness,n.beta,n.energy_1k,n.carrier_gap,n.frequency,n.dry_roughness,n.voice_count,n.fractured,n.nominal_decay,n.volume,n.controlled_centroid,n.recorded_vassilakis]);
const end=setup(notes,'Every bell strike','Nominal note names use A440; the 121 Hz root lies approximately 35 cents below B2.',
 ['Seed','Note','Time','Pitch','Interval st','Gap s','Re-entry','Step','Tritone','Seventh','Iteration','Slot','Brightness Hz','Recorded roughness','Controlled FM roughness','FM index β','Energy >1 kHz','Carrier gap Hz','Frequency Hz','Dry roughness','Voices','Fractured','Decay s','Volume','Controlled brightness Hz','Recorded Vassilakis'],noteValues,
 [13,7,13,9,10,10,10,7,9,9,10,7,14,15,16,12,15,13,14,13,9,10,11,10,17,17]);
notes.getRange(`C7:C${end}`).setNumberFormat('[m]:ss.000');
for(const c of ['F','M','R','S','W','Y'])notes.getRange(`${c}7:${c}${end}`).setNumberFormat('0.00');
for(const c of ['N','O','T','Z'])notes.getRange(`${c}7:${c}${end}`).setNumberFormat('0.000');
notes.getRange(`P7:P${end}`).setNumberFormat('0.00');notes.getRange(`Q7:Q${end}`).setNumberFormat('0.000%');notes.getRange(`X7:X${end}`).setNumberFormat('0.000');

setup(summary,'Open g29 melody and FM analysis','16 mirrored Long studies, sorted darkest to brightest by average early-note spectral centroid.',
 ['Seed','Batch','Duration','Notes','Stepwise','Tritone jumps','Seventh jumps','Brightness Hz','Recorded roughness','Controlled FM roughness','FM index β','Energy >1 kHz'],
 rows.map(s=>[s.seed,s.batch==='reference'?'0b086950':'Random',Math.round(s.duration)/86400,null,null,null,null,null,null,null,null,null]),
 [14,14,12,9,12,12,12,15,16,17,12,15]);
const seedRange=`'FM notes'!$A$7:$A$${end}`;
const formulaRows=rows.map((s,i)=>{const row=i+7;return[
 `=COUNTIFS(${seedRange},A${row})`,
 `=SUMIFS('FM notes'!$H$7:$H$${end},${seedRange},A${row})/(D${row}-1)`,
 `=SUMIFS('FM notes'!$I$7:$I$${end},${seedRange},A${row})`,
 `=SUMIFS('FM notes'!$J$7:$J$${end},${seedRange},A${row})`,
 ...['M','N','O','P','Q'].map(c=>`=AVERAGEIFS('FM notes'!$${c}$7:$${c}$${end},${seedRange},A${row})`)
 ];});
summary.getRange('D7:L22').formulas=formulaRows;
summary.getRange('C7:C22').setNumberFormat('[m]:ss');summary.getRange('E7:E22').setNumberFormat('0.0%');
summary.getRange('H7:H22').setNumberFormat('0');summary.getRange('I7:J22').setNumberFormat('0.000');summary.getRange('K7:K22').setNumberFormat('0.00');summary.getRange('L7:L22').setNumberFormat('0.000%');
summary.getRange('A25').values=[[`Darkest: ${rows[0].seed}. Lowest controlled FM roughness: ${[...rows].sort((a,b)=>a.controlled_roughness-b.controlled_roughness)[0].seed}.`]];
summary.getRange('A27').values=[['Stepwise counts 1–2 semitone moves among all adjacent bells, including unison re-entries. Jump counts exclude interlude re-entries.']];
summary.getRange('A28').values=[['Recorded roughness includes the surrounding mix. Controlled FM holds pitch at 200 Hz and decay at 20 seconds.']];
summary.getRange('A29').values=[['Roughness values are relative model scores. Small differences are not definitive perceptual rankings. See Method for definitions.']];
summary.getRange('A25:L29').format.font={name:'Arial',size:10,color:gray};
summary.getRange('A32').values=[['Tentative aesthetic picks from score and audio measurements, rather than a listening test']];
picks.forEach((pick,i)=>{summary.getRange(`A${33+i}`).values=[[`${pick.label}: ${pick.seed}. ${pick.reason}`]];});
summary.getRange('A32:L36').format.font={name:'Arial',size:10,color:gray};
summary.getRange('A32:L36').format.rowHeight=22;
summary.tabColor=ink;

setup(comp,'Pacing, repetition and harmony','One pitch collection; exact repeated melody. Outward FM palettes return in reverse order. Audio decays run forwards.',
 ['Seed','Nominal BPM','Median gap s','Shortest gap s','Longest gap s','Iterations','Key changes','Last pitch','Last degree st','Chord sets','Brightest strike','Roughest strike','Ending tail s','Interlude RMS dBFS','Interlude brightness Hz','Interlude roughness','Interlude side/mid dB','Chord sequence','Chord statements','FM palette order','Theme st','Carrier gap Hz','Fractured notes','Bell early RMS dBFS','Interlude minus bell dB','Sample peak dBFS','True peak dBFS'],
 rows.map(s=>[s.seed,s.nominal_bpm,s.median_within_phrase_gap,s.minimum_gap,s.max_gap,s.iterations,s.scale_changes,s.ending,s.ending_semitones,s.distinct_chord_pitch_sets,s.brightest_time/86400,s.roughest_time/86400,s.ending_tail_seconds,s.interlude_rms_dbfs,s.interlude_centroid,s.interlude_roughness,s.interlude_side_mid_db,s.interlude_chord_sequence,s.chord_counts.join('–'),s.palette_order.map(i=>String.fromCharCode(65+i)).join('–'),s.theme_semitones.join(', '),s.carrier_gap,s.fractured,s.bell_early_rms_dbfs,s.interlude_minus_bell_db,s.pcm_peak_dbfs,s.true_peak_dbfs]),
 [14,13,14,14,14,12,12,11,13,11,15,15,14,17,19,17,18,100,50,50,45,16,16,18,20,17,17]);
comp.getRange('B7:E22').setNumberFormat('0.00');comp.getRange('K7:L22').setNumberFormat('[m]:ss.0');comp.getRange('M7:O22').setNumberFormat('0.0');comp.getRange('P7:P22').setNumberFormat('0.000');comp.getRange('Q7:Q22').setNumberFormat('0.0');
comp.getRange('A25').values=[['Median gap excludes interlude pauses. Key changes count planned collection changes, rather than inferred key labels.']];
comp.getRange('A26').values=[['Last degree is semitones above the 121 Hz root. Chord sets count distinct pitch-class collections, without distinguishing inversions.']];
comp.getRange('V7:V22').setNumberFormat('0.00');comp.getRange('W7:W22').setNumberFormat('0.0%');comp.getRange('X7:AA22').setNumberFormat('0.0');
comp.getRange('H7:H22').format.horizontalAlignment='center';
notes.getRange(`D7:D${end}`).format.horizontalAlignment='center';
comp.getRange('A27').values=[['Interlude metrics weight each chord statement equally. Windows cover 3.0–9.5 seconds after onset, including lingering bells and any previous organ-statement tail.']];
comp.getRange('A28').values=[['Bell RMS uses 0.05–0.55 seconds after each attack. These window levels describe balance, not integrated loudness or perceived equal loudness.']];
comp.getRange('A25:R27').format.font={name:'Arial',size:10,color:gray};

const droneValues=data.recordings.flatMap(r=>r.interludes).map(v=>[v.seed,v.index,v.swell,v.time/86400,v.harmony,v.centroid,v.roughness,v.rms_dbfs,v.side_mid_db,v.envelope_sd_db,v.voice_count,v.inversion,v.paired_index,v.dry_end/86400,v.return_time/86400,v.registration,v.feedback]);
const de=setup(drones,'Principal organ interludes','Filtered Principal ranks, slow three-band stereo chorus, 10% filtered feedback, 12-second convolution room. Melody drones retain the earlier FM synth.',
 ['Seed','Interlude','Statement','Start','Chord','Brightness Hz','Roughness','RMS dBFS','Side/mid dB','Envelope SD dB','Voices','Inversion','Mirror partner','Direct end','Next bell','Registration','Feedback'],
 droneValues,[14,10,11,14,24,15,13,13,14,17,10,10,15,14,14,34,13]);
drones.getRange(`D7:D${de}`).setNumberFormat('[m]:ss.0');drones.getRange(`F7:F${de}`).setNumberFormat('0');drones.getRange(`G7:G${de}`).setNumberFormat('0.000');drones.getRange(`H7:J${de}`).setNumberFormat('0.0');drones.getRange(`N7:O${de}`).setNumberFormat('[m]:ss.0');drones.getRange(`Q7:Q${de}`).setNumberFormat('0%');
drones.getRange(`D7:D${de}`).format.horizontalAlignment='center';drones.getRange(`O7:O${de}`).format.horizontalAlignment='center';

setup(replays,'Replay and export identifiers','Eight motif-derived studies followed by eight unconditioned random seeds. All are stereo 16-bit PCM WAV.',
 ['Batch','Seed','Engine','Root Hz','Duration','Rate Hz','Replay / export filename'],
 manifest.recordings.map(r=>[r.batch==='reference'?'0b086950':'Random',r.seed,'g29',r.rootHz,Math.round(r.durationSeconds)/86400,r.sampleRate,r.replayFilename]),
 [15,15,10,12,13,13,105]);
replays.getRange('E7:E22').setNumberFormat('[m]:ss');
replays.getRange('F7:F22').format.horizontalAlignment='center';
replays.getRange('A25').values=[['To reproduce the original Short Study, use its full g3 filename in the new player. A bare seed or a g29 tag selects a different engine.']];
replays.getRange('A27').values=[['open-run-0393ded7-mviswtcb-g3-200hz-short-44100sr-1792628825406.wav']];

const methodRows=[
 ['Recordings','The 16 generated g29 Long-study WAVs, 121 Hz, 44.1 kHz, stereo 16-bit PCM. Filenames are on Replays; file hashes are in the source package.'],
 ['Early-note windows','0.50 seconds starting 0.05, 0.65 and 1.30 seconds after each bell. Equal averages of windows and then notes.'],
 ['Spectrum','FFmpeg resampling to 16 kHz; symmetric Hann; FFT 16,384; 60–7,500 Hz. Stereo amplitude is the square root of mean channel spectral power.'],
 ['Brightness','Amplitude-weighted spectral centroid in Hz. Lower values indicate a darker average spectrum.'],
 ['High-frequency energy','Power at or above 1 kHz divided by total power in the analysis band. This is an early-note average, not a whole-recording percentage.'],
 ['Peak selection','Up to 24 peaks; minimum height 1.5%, prominence 0.5%, separation 5 FFT bins. Frequencies use log-amplitude parabolic interpolation; amplitudes retain bin values.'],
 ['Roughness','Sethares pairwise model with equal-L2-norm peak amplitudes. Recorded and controlled columns have separate relative interpretations.'],
 ['Controlled FM','Analytic reconstruction using each note’s frequency ratios, relative carrier detuning, amplitudes and modulation settings; 200 Hz carrier reference and 20-second decay.'],
 ['FM index β','Voice-amplitude-weighted mean of modulation depth divided by modulator frequency at onset. β alone does not establish harshness.'],
 ['Carrier gap','Amplitude-product-weighted mean absolute frequency separation between carrier pairs, in Hz.'],
 ['Melodic intervals','Stepwise = 1 or 2 semitones / all adjacent bell pairs. Unisons remain in the denominator. Tritones = 6 semitones; sevenths = 10 or 11.'],
 ['Phrase re-entries','The first bell following each interlude is excluded from jump counts. Stepwise retains all adjacent pairs, including these unison re-entries.'],
 ['Interlude measurements','0.5-second windows every 0.5 seconds from 3.0 to 9.0 seconds after each swell onset. RMS and width use 3.0–9.5 seconds. Each swell receives equal weight.'],
 ['Envelope variation','SD of 250 ms log-RMS after removing its linear trend. Width is 10 log10(side power / mid power).'],
 ['Calibration','The model reproduces all 128 saved 0b086950 g3 controlled-FM, dry-roughness, beta and carrier-gap values within 2.4e-12 maximum absolute error.'],
 ['Interpretation','Signal-based measurements, not a listening-test rating or a measure of compositional quality. Close ranks may not be perceptually meaningful.'],
 ['Legacy replay','0393ded7 g3 was rerendered through this batch player and matched the preserved floating-PCM digest exactly on the same native audio backend. The engine scripts are unchanged from the verified g29 player. This is not a cross-browser PCM identity claim.'],
 ['Mirroring','11 events: 1–2–3–4–5–6–5–4–3–2–1, with paired pitch, FM recipe, duration, gain, pan and onset gaps. Whole-piece palettes and chords return in reverse order. Decay-aware handoffs mean absolute event times are not a global palindrome.'],
 ['Seed selection','Eight seeds match the original full 0b086950 motif before mirroring. Eight further seeds are unconditioned random draws; matching melodic shapes can occur by chance.'],
 ['Structure','6 or more even-numbered melody passes; one organ interlude after every pass except the last. One complete 1–3–1 statement-count arch expands toward the center.'],
 ['Organ timbre','Independent Principal 8-foot, Octave 4-foot and Superoctave 2-foot ranks, restrained mixtures and a quiet low-octave foundation. The g27 filter contour is retained. Spectral chorus uses three wet bands split at 180 and 500 Hz with 0.023–0.061 Hz modulation.'],
 ['Organ room','Interludes use 12-second stereo convolution, wet gain 1.1, dry gain 0.8, 25 ms pre-delay and a +1.5 dB wet shelf at 1.6 kHz. Melody accompaniment retains the legacy FM drone.'],
 ['Tails and handoffs','The organ enters 6–14 seconds after the final bell strike, during its decay. Direct organ and chorus feedback end 2 seconds before the next bell. The stronger late reverb can continue beneath returning bells. Natural attacks, room tails and oscillator phases are not reversed.'],
 ['Sethares source','https://sethares.engr.wisc.edu/comprog.html'],
 ['Vassilakis source','https://acousticslab.org/learnmoresra/moremodel.html'],
 ['Neroli comparison','Atmospheric kinship only. Neroli uses Phrygian material; these studies use Open’s fixed major-derived collection. Liner-note transcription: https://ambientlandscape.wordpress.com/2012/11/28/brian-eno-liner-notes/'],
 ['Cage comparison','Cage’s Number Pieces use time brackets and performance choices; Open’s fixed palindromes differ. Source: https://www.anothertimbre.com/pages/booklet-for-john-cage-number-pieces-box-set'],
 ['Feldman comparison','The comparison concerns resonance and returning figures, not an identical compositional system. Christopher Fox’s liner notes: https://judithwegmann.ch/wp-content/uploads/2024/03/triadic-memories-linernotes.pdf']
];
const me=setup(method,'Definitions and reproducibility','The established bell measurement protocol is retained for comparison with the earlier tables.', ['Item','Definition'],methodRows,[28,130]);
method.getRange(`B7:B${me}`).format.wrapText=true;method.getRange(`A7:B${me}`).format.rowHeight=42;method.getRange(`A7:A${me}`).format.font={name:'Arial',size:10,bold:true,color:ink};

wb.recalculate();
const actual=summary.getRange('D7:L22').values;
for(let i=0;i<rows.length;i++){
 const s=rows[i],expected=[s.notes,s.stepwise,s.tritones,s.sevenths,s.centroid,s.recorded_roughness,s.controlled_roughness,s.beta,s.energy_1k];
 for(let j=0;j<expected.length;j++)if(typeof actual[i][j]!=='number'||Math.abs(actual[i][j]-expected[j])>1e-8)throw Error(`Summary mismatch ${s.seed} ${j}: ${actual[i][j]} vs ${expected[j]}`);
}
console.log((await wb.inspect({kind:'table',range:'All recordings!A6:L10',include:'values,formulas',tableMaxRows:5,tableMaxCols:12,maxChars:2500})).ndjson);
console.log((await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:20},summary:'Formula error scan'})).ndjson);
for(const [sheet,range,file] of [['All recordings','A1:L36','summary'],['Composition','A1:J22','composition'],['Replays','A1:G27','replays'],['FM notes','A1:Q15','notes'],['Drone interludes','A1:Q16','interludes'],['Method',`A1:B${me}`,'method']]){
 if(sheet==='Method'&&process.env.OPEN_REVIEW_ONLY_CHANGED)continue;
 const blob=await wb.render({sheetName:sheet,range,scale:1.5,format:'png'});await fs.writeFile(path.join(outputDir,file+'.png'),new Uint8Array(await blob.arrayBuffer()));
}
const out=await SpreadsheetFile.exportXlsx(wb);await out.save(path.join(outputDir,'Open-g29-Sixteen-Studies-Melody-FM-Analysis.xlsx'));
await fs.copyFile(new URL(import.meta.url),path.join(root,'analysis/build-workbook.mjs'));
console.log(JSON.stringify({outputDir,recordings:rows.length,notes:allNotes.length,interludeSwells:droneValues.length}));
