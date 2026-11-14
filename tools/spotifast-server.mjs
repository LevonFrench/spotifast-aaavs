import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createReadStream,existsSync,realpathSync,statSync,readFileSync} from 'node:fs';
import {resolve,join,extname,sep,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {importFromAaavs} from './project-paths.mjs';
// AAAVS owns the preset library server; this host uses it as it is.
const {createLibraryHandler}=await importFromAaavs('tools/standalone-library.mjs');
import {createDesktopSpotify} from './spotifast-spotify.mjs';

export function desktopPage(source) {
  return source.replaceAll('AAAVS Player','Spotifast + AAAVS')
    .replace('</head>',`<style>
    .spotify-library{position:absolute;inset:0 auto 0 0;width:min(860px,100%);z-index:5;display:flex;flex-direction:column;background:var(--aa-panel,#181e25);border-right:1px solid var(--aa-border,#435162);padding:18px;overflow:hidden}
    .spotify-library[hidden]{display:none}.spotify-library>header{display:flex;align-items:center;justify-content:space-between;gap:16px}.spotify-library h1{margin:0;font-size:22px}.spotify-library h2{margin:0 0 12px;font-size:18px}
    .spotify-library button,.spotify-library input,#player-spotify{color:var(--aa-text,#edf2f7);background:var(--aa-control,#252f3b);border:1px solid var(--aa-border,#435162);border-radius:5px;padding:8px 11px;min-height:36px}
    .spotify-library button:hover:not(:disabled),#player-spotify[aria-pressed=true]{background:var(--aa-accent-bg,#203e4d);border-color:var(--aa-accent,#74c9e8)}.spotify-library button:disabled{opacity:.5}
    .spotify-message{color:var(--aa-muted,#a6b3c4);min-height:20px;margin:10px 0}.spotify-account{margin:0 0 14px}.spotify-account>span{margin-right:12px}.spotify-account form{display:flex;gap:10px;align-items:end;flex-wrap:wrap}.spotify-account label{display:grid;gap:5px;flex:1}.spotify-account input{min-width:180px;width:100%}.spotify-account details{margin-top:12px}.spotify-account code{display:block;padding:10px 0;overflow-wrap:anywhere}.spotify-account p{max-width:640px;color:var(--aa-muted,#a6b3c4)}
    .spotify-layout{display:grid;grid-template-columns:190px minmax(0,1fr);gap:18px;min-height:0;flex:1}.spotify-layout nav,.spotify-layout section{min-width:0;overflow:auto}.spotify-layout nav button{display:block;text-align:left;width:100%;margin-bottom:6px;overflow-wrap:anywhere}.spotify-track{display:grid;width:100%;grid-template-columns:minmax(0,1fr) auto;gap:2px 12px;text-align:left;margin-bottom:6px}.spotify-track strong,.spotify-track span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.spotify-track span{grid-column:1;font-size:12px;color:var(--aa-muted,#a6b3c4)}.spotify-track time{grid-column:2;grid-row:1/3;align-self:center;font:12px Consolas,monospace}.spotify-track[aria-current=true]{border-color:var(--aa-accent,#74c9e8);background:var(--aa-accent-bg,#203e4d)}
    #spotify-now-playing{display:flex;align-items:center;gap:8px;flex:none;font-size:12px}#spotify-now-playing img{width:38px;height:38px;object-fit:cover}#spotify-now-playing:empty{display:none}
    @media(max-width:600px){.spotify-library{padding:12px}.spotify-layout{grid-template-columns:125px minmax(0,1fr);gap:10px}#spotify-now-playing a{display:none}.spotify-library button{padding:7px}.spotify-account form button{width:100%}}
    </style></head>`)
    .replace('id="player-audio"','id="unused-browser-audio"')
    .replace('dist/player/standalone-player.js','dist/player/spotifast-player.js')
    .replace(/<fieldset><legend>Music<\/legend>[\s\S]*?<\/fieldset>/,'')
    .replace('Local audio stays in your browser. The local server saves preset ratings and setups.','Local files play through Spotifast. Presets, stars and setups use your current AAAVS library.')
    .replace('id="player-live"','hidden id="player-live"').replace('id="player-track-shuffle"','hidden id="player-track-shuffle"')
    .replace('id="player-lyrics"','hidden id="player-lyrics"')
    .replace('title="Music folder browser">Music</button>','title="Local-file queue">Queue</button>')
    .replace(/<a id="player-studio"[^>]*>Studio<\/a>/,'<button id="player-spotify" aria-pressed="false">Spotify</button><span id="spotify-now-playing"></span>')
    .replace('</main>','<section id="spotify-library" hidden role="dialog" aria-label="Spotify library"></section></main>');
}

export class DesktopAudioState {
  state={epoch:0,position:0,duration:0,playing:false,name:null};
  frames=[]; sequence=0; last=Date.now(); error=null; ended=0;
  accept(value) {
    if(value.type==='error'){
      if(Number.isSafeInteger(value.epoch)&&value.epoch<this.state.epoch)return;
      if(Number.isSafeInteger(value.epoch))this.state.epoch=value.epoch;
      this.error=String(value.message).slice(0,300);this.frames=[];this.state.playing=false;this.state.loading=false;return;
    }
    if(!['audio','state'].includes(value.type))return;
    if(!Number.isSafeInteger(value.epoch)||value.epoch<0||value.epoch<this.state.epoch)return;
    if(value.epoch!==this.state.epoch){this.frames=[];this.error=null;}
    const {frame,type,...state}=value;
    this.state={...this.state,...state}; this.last=Date.now();
    if(value.ended)this.ended++;
    if(!value.playing)this.frames=[];
    if(frame&&value.playing&&Number.isFinite(frame.time)&&Array.isArray(frame.pcm)&&frame.pcm.length===1152&&frame.pcm.every(Number.isFinite)) {
      this.frames.push({...frame,sequence:++this.sequence,epoch:value.epoch});
      if(this.frames.length>64)this.frames.shift();
    }
  }
  snapshot(after=0) {
    const fresh=!this.state.playing||Date.now()-this.last<1500;
    return {...this.state,playing:this.state.playing&&fresh,error:this.error??(fresh?null:'Audio engine stopped responding'),ended:this.ended,
      frames:this.frames.filter(f=>f.sequence>after&&f.time<=this.state.position&&this.state.position-f.time<.25),
      discontinuity:!fresh||this.state.discontinuity===true};
  }
}

export async function startDesktopServer({root,engine,port=0,initialFile,engineArgs=[],renderer,spotifyOptions}) {
  root=realpathSync(root);
  if(!existsSync(join(root,'avs presets','catalog','presets.json')))throw Error('The current AAAVS preset catalogue is missing.');
  const secret=randomBytes(24).toString('hex');
  const child=spawn(engine,engineArgs.length?engineArgs:['--engine'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  const audio=new DesktopAudioState(); const files=new Map(); let nextFile=0; let stopped=false;let playIntent=0;
  const spotify=createDesktopSpotify(spotifyOptions);
  let nativeReady=false; let stderr='';
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-2000);});
  createInterface({input:child.stdout}).on('line',line=>{
    if(line.length>100000)return;
    try{const value=JSON.parse(line);if(value.type==='ready')nativeReady=true;audio.accept(value);}catch{}
  });
  child.on('error',()=>{audio.error='The native audio engine could not start';audio.state.playing=false;});
  child.on('exit',code=>{if(!stopped){audio.error=`The native audio engine exited (${code??'signal'})`;audio.state.playing=false;}});
  const send=value=>{
    if(child.stdin.destroyed||!child.stdin.writable||child.stdin.writableLength>65536)throw Error('Audio engine is unavailable or busy');
    child.stdin.write(JSON.stringify(value)+'\n');
  };
  child.stdin.on('error',()=>{});
  const add=paths=>paths.slice(0,200).flatMap(path=>{
    if(typeof path!=='string'||path.length>32768||!['.wav','.mp3','.flac','.ogg','.opus','.m4a','.aac'].includes(extname(path).toLowerCase()))return [];
    try{const actual=realpathSync(path);if(!statSync(actual).isFile())return [];const id=String(++nextFile);files.set(id,actual);return [{id,name:basename(actual)}];}catch{return [];}
  });
  const library=createLibraryHandler(root,{showPacks:undefined});
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
  const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json',...headers});res.end(JSON.stringify(value));};
  const server=createServer(async(req,res)=>{
    try {
      const origin=`http://127.0.0.1:${server.address().port}`;
      if(req.headers.host!==new URL(origin).host){json(res,403,{error:'Loopback host required'});return;}
      const url=new URL(req.url,origin);
      if(url.pathname.startsWith('/api/spotifast/')) {
        const cover=/^\/api\/spotifast\/spotify\/cover\/([a-f0-9]{32})$/.exec(url.pathname);
        if(cover&&req.method==='GET'){
          if(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'||req.headers.origin&&req.headers.origin!==origin){res.writeHead(403);res.end();return;}
          const image=await spotify.image(cover[1]);if(!image){res.writeHead(404);res.end();return;}
          res.writeHead(200,{'Content-Type':image.type,...headers});res.end(image.bytes);return;
        }
        if(req.headers['x-aaavs-session']!==secret||req.headers.origin&&req.headers.origin!==origin){req.resume();json(res,403,{error:'Player session required'});return;}
        if(url.pathname==='/api/spotifast/state'&&req.method==='GET'){json(res,200,{...audio.snapshot(Number(url.searchParams.get('after'))||0),ready:nativeReady});return;}
        if(url.pathname==='/api/spotifast/spotify/status'&&req.method==='GET'){json(res,200,spotify.status());return;}
        if(url.pathname==='/api/spotifast/spotify/library'&&req.method==='GET'){
          json(res,200,await spotify.page(url.searchParams.get('kind'),{id:url.searchParams.get('id'),offset:Number(url.searchParams.get('offset')??0)}));return;
        }
        if(url.pathname==='/api/spotifast/command'&&req.method==='POST') {
          let bytes=0,parts=[];
          for await(const part of req){bytes+=part.length;if(bytes>65536){json(res,413,{error:'Command too large'});return;}parts.push(part);}
          const body=JSON.parse(Buffer.concat(parts));
          if(body.op==='spotify-connect'){const flow=await spotify.begin(body.clientId);playIntent++;if(audio.state.source==='spotify')send({op:'spotify-disconnect'});json(res,200,flow);return;}
          if(body.op==='spotify-disconnect'){playIntent++;spotify.disconnect();if(audio.state.source==='spotify')send({op:'spotify-disconnect'});json(res,200,{ok:true});return;}
          if(body.op==='spotify-play'){const intent=++playIntent;const playback=await spotify.playback(body.id);if(intent!==playIntent){json(res,409,{error:'The playback choice changed.'});return;}send(playback);json(res,200,{ok:true});return;}
          if(body.op==='add') {json(res,200,{files:add(Array.isArray(body.paths)?body.paths:[])});return;}
          if(body.op==='load') {const path=files.get(String(body.id));if(!path)throw Error('Select an audio file first');playIntent++;send({op:'load',path,play:true});}
          else if(body.op==='seek'&&Number.isFinite(body.position))send({op:'seek',position:body.position});
          else if(body.op==='volume'&&Number.isFinite(body.volume))send({op:'volume',volume:body.volume});
          else if(['play','pause','stop'].includes(body.op))send({op:body.op});
          else throw Error('Unknown player command');
          json(res,200,{ok:true});return;
        }
        json(res,404,{error:'Unknown player endpoint'});return;
      }
      // Current AAAVS library handler/root: one set of ratings, folders,
      // setups and not-working flags, using its existing file locks.
      if(await library(req,res))return;
      if(req.method!=='GET'&&req.method!=='HEAD'){json(res,405,{error:'Use GET'});return;}
      const path=decodeURIComponent(url.pathname);
      if(path==='/') {res.writeHead(200,{'Content-Type':'text/html; charset=utf-8',...headers});res.end(desktopPage(readFileSync(join(root,'standalone.html'),'utf8')));return;}
      if(!/^\/(dist\/player\/|show-assets\/|avs presets\/)/.test(path)||path.split(/[\\/]/).some(p=>p.startsWith('.')||p.toLowerCase()==='show-assets-private')) {json(res,404,{error:'Not found'});return;}
      const base=renderer&&path.startsWith('/dist/player/')?realpathSync(renderer):root;
      const file=resolve(base,'.'+(base===root?path:path.slice('/dist/player'.length)));
      if(!file.startsWith(base+sep)||!existsSync(file)||!statSync(file).isFile()){json(res,404,{error:'Not found'});return;}
      const actual=realpathSync(file);if(!actual.startsWith(base+sep)){json(res,403,{error:'Linked files outside AAAVS are unavailable'});return;}
      const types={'.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg'};
      res.writeHead(200,{'Content-Type':types[extname(actual)]??'application/octet-stream',...headers});
      if(req.method==='HEAD')res.end();else createReadStream(actual).on('error',()=>res.destroy()).pipe(res);
    }catch(error){if(!res.headersSent)json(res,error.status??400,{error:error.status||error.message?.startsWith('Select')?error.message:'The local player could not complete that request'});else res.destroy();}
  });
  await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',yes);});
  const url=`http://127.0.0.1:${server.address().port}/`;
  async function close(){if(stopped)return;stopped=true;await spotify.close();try{send({op:'shutdown'});}catch{}await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill();resolve();},1000);child.once('exit',()=>{clearTimeout(timer);resolve();});});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  if(initialFile){const [file]=add([initialFile]);if(file)send({op:'load',path:files.get(file.id),play:true});}
  return {url,secret,audio,files,child,close,get diagnostics(){return {nativeReady,stderr};}};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const flag=name=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:undefined;};
  const app=await startDesktopServer({root:flag('--root'),engine:flag('--engine'),initialFile:flag('--file'),renderer:flag('--renderer')});
  console.log(JSON.stringify({url:app.url+'#'+app.secret}));
  const shutdown=async()=>{await app.close();process.exit(0);};
  process.stdin.on('data',()=>void shutdown());process.stdin.on('end',()=>void shutdown());process.on('SIGINT',()=>void shutdown());process.on('SIGTERM',()=>void shutdown());
}
