const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const dir=__dirname,html=path.join(dir,'deliverables/Open-g29-Sixteen-New-Studies.html');
const results=[];
function render(args){
 const output=args.filename+'.json';
 const code="require('./render.cjs').render(JSON.parse(process.argv[1])).then(r=>require('fs').writeFileSync(process.argv[2],JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1})";
 const run=spawnSync(process.execPath,['-e',code,JSON.stringify(args),output],{cwd:dir,encoding:'utf8',maxBuffer:1e6});
 if(run.status!==0)throw Error(run.stderr);
 const result=JSON.parse(fs.readFileSync(output));results.push(result);return result;
}
const g3=render({html,seed:'0393ded7',engine:'3',duration:'short',tone:200,filename:path.join(dir,'checks/g29-preserved-g3.wav')});
assert.equal(g3.pcmSha256,'a259348dc27fb39ca87c047d36e23d848bd35e18fce689971f799f91bd68dafa');

fs.writeFileSync('batch-g3-validation.json',JSON.stringify({g3SampleIdentical:true,results},null,2));
console.log('Original g3 Short Study is sample-identical to the retained baseline.');
