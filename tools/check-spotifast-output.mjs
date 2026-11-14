import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createInterface} from 'node:readline';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

import {localRoot as root} from './project-paths.mjs';
const evidence=join(root,'spotify-evidence');mkdirSync(evidence,{recursive:true});
// Quiet, original synthetic audio; no microphone, loopback recording or account.
const rate=44100,frames=rate*25,wav=Buffer.alloc(44+frames*4);
wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(2,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*4,28);wav.writeUInt16LE(4,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(frames*4,40);
for(let i=0;i<frames;i++){wav.writeInt16LE(Math.round(Math.sin(i/rate*Math.PI*440)*5000),44+i*4);wav.writeInt16LE(Math.round(Math.sin(i/rate*Math.PI*1760)*3000),46+i*4);}
const tone=join(evidence,'output-test.wav');writeFileSync(tone,wav);
const enginePath=resolve(process.env.AAAVS_SPOTIFAST_ENGINE??join(root,'target','debug','spotifast-aaavs.exe'));
const engine=spawn(enginePath,['--engine'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
let state={},closed=false;const errors=[];const measurements={};
const exited=new Promise(yes=>engine.once('exit',()=>{closed=true;yes();}));
engine.stdin.on('error',()=>{});engine.stderr.on('data',()=>{});
createInterface({input:engine.stdout}).on('line',line=>{const v=JSON.parse(line);if(v.type==='error')errors.push(v.message);if(v.type==='audio'||v.type==='state')state={...state,...v,frame:undefined};});
const send=o=>engine.stdin.write(JSON.stringify(o)+'\n');
const waitFor=async predicate=>{for(let i=0;i<100;i++){if(predicate(state))return;assert.ok(!closed,'native engine exited');await delay(30);}throw Error('Native transport timed out: '+JSON.stringify(state));};
const meter=async(name,sound)=>{
 const value=JSON.parse((await promisify(execFile)(join(root,'audio-meter.exe'),[String(engine.pid)],{windowsHide:true,timeout:4000})).stdout);measurements[name]=value;
 assert.ok(value.found,'Windows did not expose this engine audio session');
 if(sound){assert.ok(!value.sessionMuted&&!value.endpointMuted,'Windows output is muted');assert.ok(value.peak>.001,`${name}: timer advanced but Windows output was silent`);}
 else assert.ok(value.peak<.00001,`${name}: output was not silent`);
};
try{
 send({op:'volume',volume:.1});send({op:'load',path:tone});await waitFor(s=>s.playing&&s.position>.2);await meter('initialPlay',true);
 send({op:'pause'});await waitFor(s=>!s.playing);await delay(180);await meter('pause',false);
 send({op:'play'});await waitFor(s=>s.playing);await meter('resume',true);
 send({op:'seek',position:8});await waitFor(s=>s.playing&&s.position>=8);await meter('playingSeek',true);
 send({op:'stop'});await waitFor(s=>!s.playing&&s.position===0);await delay(180);await meter('stop',false);
 send({op:'play'});await waitFor(s=>s.playing&&s.position>.2);await meter('stopReplay',true);
 send({op:'load',path:tone});await waitFor(s=>s.playing&&s.epoch>=4);await meter('trackReplacement',true);
 assert.deepEqual(errors,[]);
 const result={ok:true,engine:enginePath,syntheticAudio:true,accountAccess:false,measurements};
 writeFileSync(join(evidence,'windows-output-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{
 send({op:'shutdown'});await Promise.race([exited,delay(1500)]);if(!closed){engine.kill();await exited;}
}
