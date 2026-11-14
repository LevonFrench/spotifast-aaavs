import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {DesktopAudioState,desktopPage,startDesktopServer} from './spotifast-server.mjs';
import {aaavsRoot,localRoot} from './project-paths.mjs';

const state=new DesktopAudioState();
state.accept({type:'audio',epoch:1,position:1,playing:true,frame:{time:.99,sampleRate:44100,samples:576,pcm:Array(1152).fill(.2)}});
assert.equal(state.snapshot().frames.length,1);
state.accept({type:'state',epoch:2,position:0,playing:false});
state.accept({type:'audio',epoch:1,position:2,playing:true,frame:{time:2,pcm:Array(1152).fill(.2)}});
assert.equal(state.snapshot().frames.length,0,'seek rejects old-epoch samples');
assert.equal(state.snapshot().epoch,2);
state.accept({type:'audio',epoch:2,position:1,playing:true,frame:{time:2,pcm:Array(1152).fill(.2)}});
assert.equal(state.snapshot().frames.length,0,'future samples wait for the native playhead');
for(let i=0;i<100;i++)state.accept({type:'audio',epoch:2,position:3,playing:true,frame:{time:2.9,pcm:Array(1152).fill(.2)}});
assert.equal(state.frames.length,64,'audio retention stays bounded');
state.accept({type:'state',epoch:2,position:3,playing:false});assert.equal(state.frames.length,0,'pause clears pending samples');
const page=desktopPage(readFileSync(join(aaavsRoot(),'standalone.html'),'utf8'));
assert.ok(page.includes('spotifast-player.js'));assert.ok(!page.includes('id="player-audio"'));assert.ok(!page.includes('Connect Spotify'));
for(const id of ['player-rate-up','player-rate-down','player-manager','player-setups','setting-minimumRating'])assert.ok(page.includes(`id="${id}"`));

const engine=resolve(process.env.AAAVS_SPOTIFAST_ENGINE??join(localRoot,'target','debug','spotifast-aaavs.exe'));
assert.ok(existsSync(engine),'Build the native engine before the integration check');
const root=mkdtempSync(join(tmpdir(),'aaavs-spotifast-'));
mkdirSync(join(root,'avs presets','catalog'),{recursive:true});mkdirSync(join(root,'avs presets','presets','unique'),{recursive:true});writeFileSync(join(root,'standalone.html'),'<title>AAAVS Player</title>');
const preset=Buffer.from('AAAVS star persistence fixture');const hash=createHash('sha256').update(preset).digest('hex');
writeFileSync(join(root,'avs presets','presets','unique','fixture.avs'),preset);
writeFileSync(join(root,'avs presets','catalog','presets.json'),JSON.stringify({presets:[{sha256:hash,bytes:preset.length,canonical_path:'presets/unique/fixture.avs',display_name:'Fixture',rating:2}]}));
// Original synthetic stereo audio: left 220 Hz, right 880 Hz. No music asset.
const rate=44100,frames=rate*4,wav=Buffer.alloc(44+frames*4);
wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(2,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*4,28);wav.writeUInt16LE(4,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(frames*4,40);
for(let i=0;i<frames;i++){wav.writeInt16LE(Math.round(Math.sin(i/rate*Math.PI*440)*5000),44+i*4);wav.writeInt16LE(Math.round(Math.sin(i/rate*Math.PI*1760)*3000),46+i*4);}
const tone=join(root,'stereo-test.wav');writeFileSync(tone,wav);
const app=await startDesktopServer({root,engine,spotifyOptions:{callbackPort:0,fetch:async()=>{throw Error('No Spotify network is used by this fixture');}}});
const second=await startDesktopServer({root,engine});
const nativeHeaders={'Content-Type':'application/json','X-AAAVS-Session':app.secret,Origin:app.url.slice(0,-1)};
const command=async body=>{const r=await fetch(app.url+'api/spotifast/command',{method:'POST',headers:nativeHeaders,body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
const waitFor=async predicate=>{for(let i=0;i<100;i++){const value=app.audio.snapshot();if(predicate(value))return value;await delay(50);}throw Error('Timed out waiting for native audio: '+JSON.stringify(app.diagnostics));};
try {
  assert.equal((await fetch(app.url+'api/spotifast/state')).status,403);
  assert.equal((await fetch(app.url+'api/spotifast/command',{method:'POST',headers:{...nativeHeaders,Origin:'https://example.com'},body:'{}'})).status,403);
  for(const path of ['.private/spotify.json','.local/config','desktop/spotifast-local/Cargo.toml','avs%20presets/.aaavs-private/settings.json'])assert.equal((await fetch(app.url+path)).status,404);
  const library=async(url,body)=>{const r=await fetch(url+'api/aaavs/library',{method:'POST',headers:{'Content-Type':'application/json',Origin:url.slice(0,-1)},body:JSON.stringify(body)});const result=await r.json();assert.equal(r.status,200,JSON.stringify(result));return result;};
  assert.equal((await library(app.url,{op:'rate',hash,rating:5})).type,'rating-saved');
  const catalog=await (await fetch(second.url+'avs%20presets/catalog/presets.json')).json();assert.equal(catalog.presets[0].rating,5,'another host reads the same persisted stars');
  await library(app.url,{op:'configure',settings:{enabled:true,bars:4,shuffle:true,minimumRating:4,transition:0,beats:0,durationMs:1000,keepOld:true,manualFade:false,autoFade:true}});
  assert.equal((await library(second.url,{op:'load-settings'})).minimumRating,4,'rating filter shares current settings');
  await command({op:'volume',volume:0});
  const added=await command({op:'add',paths:[tone]});assert.equal(added.files.length,1);
  await command({op:'load',id:added.files[0].id});
  const playing=await waitFor(s=>s.playing&&s.position>.3&&s.frames.length>0);
  assert.ok(playing.frames.some(f=>f.pcm.some(v=>Math.abs(v)>.01)),'decoded local audio reaches the visualization tap even at zero volume');
  await command({op:'spotify-connect',clientId:'a'.repeat(32)});await delay(100);assert.ok(app.audio.snapshot().playing&&app.audio.snapshot().epoch===playing.epoch,'preparing an account connection leaves local music playing');
  await command({op:'spotify-disconnect'});await delay(100);assert.ok(app.audio.snapshot().playing&&app.audio.snapshot().epoch===playing.epoch,'disconnecting an account leaves local music playing');
  await command({op:'pause'});const paused=await waitFor(s=>!s.playing&&s.position>0);await delay(200);assert.equal(app.audio.snapshot().position,paused.position);
  await command({op:'seek',position:1.5});const sought=await waitFor(s=>s.epoch>playing.epoch&&Math.abs(s.position-1.5)<.01);assert.equal(sought.frames.length,0);
  await command({op:'play'});await waitFor(s=>s.playing&&s.position>1.6&&s.frames.every(f=>f.epoch===sought.epoch));
  await command({op:'load',id:added.files[0].id});await waitFor(s=>s.epoch>sought.epoch&&s.position<.3);
  await command({op:'stop'});await waitFor(s=>!s.playing&&s.position===0);await command({op:'play'});await waitFor(s=>s.playing&&s.position>.1);
  console.log(JSON.stringify({ok:true,nativeTransport:true,nonSilentPreVolumeStereo:true,windowsOutputMeasured:false,pause:true,seek:true,trackReset:true,sharedStars:true,sharedMinimumRating:true,root}));
}finally{await Promise.all([app.close(),second.close()]);}
