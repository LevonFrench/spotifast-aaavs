// Test a user-selected local file without exporting/copying its audio.
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createInterface} from 'node:readline';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {localRoot as root} from './project-paths.mjs';
const file=process.env.AAAVS_SPOTIFAST_TEST_FILE;assert.ok(file,'Set AAAVS_SPOTIFAST_TEST_FILE to an authorized local audio file');
const path=resolve(process.env.AAAVS_SPOTIFAST_ENGINE??join(root,'target','debug','spotifast-aaavs.exe'));
const engine=spawn(path,['--engine'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
let state={},closed=false,nonSilent=false;const errors=[];const started=performance.now();let firstAudioMs=null;
const exited=new Promise(yes=>engine.once('exit',()=>{closed=true;yes();}));
engine.stdin.on('error',()=>{});engine.stderr.on('data',()=>{});
createInterface({input:engine.stdout}).on('line',line=>{const v=JSON.parse(line);if(v.type==='error')errors.push(v.message);if(v.type==='audio'||v.type==='state')state={...state,...v,frame:undefined};if(v.type==='audio'){firstAudioMs??=performance.now()-started;if(v.frame.pcm.some(x=>Math.abs(x)>.001))nonSilent=true;}});
const send=value=>engine.stdin.write(JSON.stringify(value)+'\n');
const wait=async predicate=>{for(let i=0;i<300;i++){assert.deepEqual(errors,[]);assert.ok(!closed,'engine exited');if(predicate(state))return;await delay(30);}throw Error('Local file did not respond: '+JSON.stringify(state));};
const meter=async()=>JSON.parse((await promisify(execFile)(join(root,'audio-meter.exe'),[String(engine.pid)],{windowsHide:true,timeout:4000})).stdout);
try{
 send({op:'volume',volume:.08});send({op:'load',path:file});await wait(s=>s.playing&&s.position>.5&&nonSilent);
 const initial=await meter();assert.ok(initial.peak>.0001,'Windows output is silent');
 const duration=state.duration;assert.ok(duration>600,'This regression expects a file longer than the former ten-minute limit');
 send({op:'seek',position:610});await wait(s=>s.playing&&s.epoch===2&&s.position>610.2);const beyondTenMinutes=await meter();assert.ok(beyondTenMinutes.peak>.0001);
 send({op:'pause'});await wait(s=>!s.playing);send({op:'play'});await wait(s=>s.playing);const resumed=await meter();assert.ok(resumed.peak>.0001);
 send({op:'stop'});await wait(s=>!s.playing&&s.position===0);send({op:'play'});await wait(s=>s.playing&&s.position>.2);const replay=await meter();assert.ok(replay.peak>.0001);
 const result={ok:true,engine:path,file,duration,firstAudioMs,nonSilent,initial,beyondTenMinutes,resumed,replay,errors,accountAccess:false};
 const evidence=join(root,'spotify-evidence');mkdirSync(evidence,{recursive:true});writeFileSync(join(evidence,'long-local-file-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{send({op:'shutdown'});await Promise.race([exited,delay(1500)]);if(!closed){engine.kill();await exited;}}
