import {StandaloneBridge,PlayerPcmQueue} from 'aaavs/standalone-player.ts';
import {freshSettings,type SetupSettings} from 'aaavs/mpc-setups.ts';
import {prefsToWire,type DisplayPrefs} from 'aaavs/mpc-display.ts';
import {TRANSITIONS} from 'aaavs/mpc-transition.ts';
import {createHostTrackStore} from 'aaavs/show/track-host.ts';
import {SpotifyLibrary,type SpotifyTrack,type SpotifyContext} from './spotifast-spotify.ts';

type RecordValue=Record<string,unknown>;
interface NativeFrame {epoch:number;sequence:number;time:number;sampleRate:number;samples:number;pcm:number[]}
interface NativeState {epoch:number;position:number;duration:number;playing:boolean;loading?:boolean;name?:string;error?:string;ended:number;frames:NativeFrame[];source?:string;title?:string;artist?:string;album?:string;uri?:string;cover?:string;url?:string;stopped?:boolean}

export async function startSpotifastPlayer():Promise<void> {
  const get=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
  const notice=(text:string)=>{get('player-notice').textContent=text;};
  const secret=location.hash.slice(1);history.replaceState(null,'',location.pathname);
  const headers={'Content-Type':'application/json','X-AAAVS-Session':secret};
  const tracks=createHostTrackStore(),queue=new PlayerPcmQueue();
  let state:NativeState={epoch:0,position:0,duration:0,playing:false,ended:0,frames:[]};
  let sequence=0,epoch=-1,disposed=false,ended=0,at=-1,lastName='';
  const files:{id:string;name:string}[]=[];
  let spotifyQueue:SpotifyTrack[]=[],spotifyAt=-1,spotifyContext:SpotifyContext={kind:'liked',next:null};
  let spotifyBusy=false,spotifyVersion=0;
  const options=get<HTMLDialogElement>('player-options');
  const api=async(path:string,body?:unknown)=>{
    const response=await fetch('/api/spotifast/'+path,{headers,...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)}),signal:AbortSignal.timeout(path.startsWith('spotify/')||String((body as RecordValue|undefined)?.op??'').startsWith('spotify-')?20000:5000)});
    const value=await response.json();if(!response.ok)throw Error(value.error??'Local player unavailable');return value;
  };
  const command=(body:RecordValue)=>api('command',body).catch(error=>notice(String(error)));
  const toggle=()=>{void (async()=>{if(state.source==='spotify'&&(state.stopped||state.error)){await playSpotify();return;}if(!state.playing&&state.duration>0&&state.position>=state.duration)await command({op:'seek',position:0});await command({op:state.playing?'pause':'play'});})();};
  const fullscreen=()=>{void (document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()).catch(error=>notice(String(error)));};
  const settingKeys=['enabled','bars','shuffle','minimumRating','transition','durationMs','keepOld','manualFade','autoFade','fadeTiming','fadeAnchor','queueQuantize'] as const;
  const displayKeys=['quality','avsResolution','pixelArt','showFps','timingOverlay'] as const;
  const bridge=new StandaloneBridge({
    async library(value){const response=await fetch('/api/aaavs/library',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});return response.json();},
    playPause:toggle,fullscreen,options:()=>options.showModal(),notice,
    panelOpening:()=>{get('music').hidden=true;get('player-music').setAttribute('aria-pressed','false');get('spotify-library').hidden=true;get('player-spotify').setAttribute('aria-pressed','false');},
    panelChanged:panel=>{get('player-manager').setAttribute('aria-pressed',String(panel===1));get('player-setups').setAttribute('aria-pressed',String(panel===2));},
    settings(value:SetupSettings,prefs:DisplayPrefs){
      const settings=value as unknown as RecordValue;
      for(const key of settingKeys){const field=get<HTMLInputElement|HTMLSelectElement>('setting-'+key);if(!field||settings[key]===undefined)continue;if(field instanceof HTMLInputElement&&field.type==='checkbox')field.checked=settings[key]===true;else field.value=String(settings[key]);}
      const wire=prefsToWire(prefs);for(const key of displayKeys)get<HTMLSelectElement>('setting-'+key).value=String(wire[key]);
      get('player-shuffle').setAttribute('aria-pressed',String(value.shuffle));get('player-auto').setAttribute('aria-pressed',String(value.enabled));
      const mask=value.fadeRandomSet??31;for(let i=0;i<5;i++){const box=get<HTMLInputElement>('setting-fadeSet'+i);if(box){box.checked=!!(mask&(1<<i));box.disabled=value.fadeTiming!==6;}}
    },
  });
  Object.assign(window,{aaavsBridge:bridge,aaavsTracks:tracks,aaavsSongMap:null});
  // The native host supplies samples; the shared MPC host owns the renderer,
  // navigation, star ratings, filters, folders and Setup Builder.
  const on=(id:string,action:()=>void)=>get(id)?.addEventListener('click',action);
  on('player-open',()=>{(window as unknown as {ipc?:{postMessage(s:string):void}}).ipc?.postMessage('pick-files');});
  on('player-play',toggle);
  on('player-stop',()=>{void command({op:'stop'});});
  on('player-track-next',()=>{if(state.source==='spotify')void stepSpotify(1);else playAt(at+1);});on('player-track-prev',()=>{if(state.source==='spotify')void stepSpotify(-1);else playAt(at-1);});
  for(const [id,message] of [['player-rate-up','rate-up'],['player-rate-down','rate-down'],['player-manager','show-manager'],['player-setups','show-setups'],['player-play-folder','play-folder']])on(id!,()=>bridge.postMessage(message!));
  for(const [id,key] of [['player-shuffle','shuffle'],['player-auto','enabled']] as const)on(id,()=>bridge.toggle(key));
  on('player-options-button',()=>options.showModal());on('player-options-close',()=>options.close());on('player-fullscreen',fullscreen);
  on('player-previous',()=>bridge.emit({type:'previous'}));on('player-next',()=>bridge.emit({type:'next'}));
  const volume=get<HTMLInputElement>('player-volume');volume.value='0.6';volume.addEventListener('input',()=>void command({op:'volume',volume:Number(volume.value)}));
  const seek=get<HTMLInputElement>('player-seek');seek.addEventListener('change',()=>void command({op:'seek',position:Number(seek.value)}));
  TRANSITIONS.forEach((name,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=name;get('setting-transition').append(option);});
  for(const key of settingKeys)get<HTMLInputElement|HTMLSelectElement>('setting-'+key)?.addEventListener('change',event=>{
    const field=event.target as HTMLInputElement;bridge.configure({[key]:field.type==='checkbox'?field.checked:Number(field.value)});
  });
  for(let bit=0;bit<5;bit++)get('setting-fadeSet'+bit)?.addEventListener('change',()=>{
    let mask=0;for(let i=0;i<5;i++)if(get<HTMLInputElement>('setting-fadeSet'+i)?.checked)mask|=1<<i;
    if(!mask){mask=1<<bit;get<HTMLInputElement>('setting-fadeSet'+bit).checked=true;}bridge.configure({fadeRandomSet:mask});
  });
  for(const key of displayKeys)get<HTMLSelectElement>('setting-'+key)?.addEventListener('change',event=>bridge.postMessage('display:'+JSON.stringify({[key]:Number((event.target as HTMLSelectElement).value)})));
  const music=get('music');
  const spotifyPanel=get('spotify-library');
  const spotifyLibrary=new SpotifyLibrary(spotifyPanel,api,(rows,index,context)=>{spotifyVersion++;spotifyQueue=rows;spotifyAt=index;spotifyContext=context;void playSpotify();},()=>{get('player-spotify').setAttribute('aria-pressed','false');get('player-spotify').focus();});
  on('player-spotify',()=>{if(!spotifyPanel.hidden){spotifyLibrary.hide();return;}get('music').hidden=true;get('player-music').setAttribute('aria-pressed','false');bridge.postMessage('hide-panels');spotifyLibrary.show();get('player-spotify').setAttribute('aria-pressed','true');});
  async function playSpotify():Promise<void>{const track=spotifyQueue[spotifyAt];if(!track)return;notice('Opening '+track.title+' on Spotify…');await command({op:'spotify-play',id:track.id});}
  async function stepSpotify(delta:number):Promise<void>{
    if(spotifyBusy)return;spotifyBusy=true;const version=spotifyVersion;
    try{
    if(delta<0&&state.position>3){await command({op:'seek',position:0});return;}
    let index=spotifyAt+delta;
    for(let pages=0;pages<5;pages++){
      while(index>=0&&index<spotifyQueue.length&&!spotifyQueue[index]!.playable)index+=delta;
      if(index<spotifyQueue.length||spotifyContext.next===null||delta<0)break;
      const page=await api(`spotify/library?kind=${spotifyContext.kind}&offset=${spotifyContext.next}${spotifyContext.id?'&id='+encodeURIComponent(spotifyContext.id):''}`);if(version!==spotifyVersion)return;spotifyQueue.push(...page.items);spotifyContext.next=page.next;
    }
    if(index<0||index>=spotifyQueue.length||version!==spotifyVersion)return;spotifyAt=index;await playSpotify();
    }catch(error){notice(String(error));}finally{spotifyBusy=false;}
  }
  music.classList.add('local-queue');
  music.addEventListener('dblclick',event=>event.stopPropagation());
  function renderQueue():void {
    music.replaceChildren();const header=document.createElement('header');
    const title=document.createElement('h1');title.textContent='Local queue';header.append(title);
    const close=document.createElement('button');close.textContent='Close';close.onclick=()=>{music.hidden=true;get('player-music').setAttribute('aria-pressed','false');get('player-music').focus();};header.append(close);music.append(header);
    const summary=document.createElement('p');summary.className='queue-summary';summary.textContent=files.length?`${files.length} ${files.length===1?'track':'tracks'} · plays in order`:'Open audio to add local files to your queue.';music.append(summary);
    for(let i=0;i<files.length;i++){const button=document.createElement('button');button.className='queue-track';button.textContent=`${String(i+1).padStart(2,'0')}  ${files[i]!.name}`;button.setAttribute('aria-current',i===at?'true':'false');button.onclick=()=>playAt(i);music.append(button);}
  }
  const closeQueue=()=>{music.hidden=true;get('player-music').setAttribute('aria-pressed','false');get('player-music').focus();};
  music.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeQueue();}});
  on('player-music',()=>{music.hidden=!music.hidden;get('player-music').setAttribute('aria-pressed',String(!music.hidden));if(!music.hidden){spotifyPanel.hidden=true;get('player-spotify').setAttribute('aria-pressed','false');bridge.postMessage('hide-panels');renderQueue();music.querySelector('button')?.focus();}});
  function playAt(index:number):void {if(!files.length)return;spotifyVersion++;at=(index+files.length)%files.length;void command({op:'load',id:files[at]!.id});renderQueue();}
  window.addEventListener('aaavs-files',event=>{void api('command',{op:'add',paths:(event as CustomEvent).detail}).then(result=>{const first=files.length;files.push(...result.files);renderQueue();if(result.files.length)playAt(first);else notice('Choose a supported local audio file.');}).catch(error=>notice(String(error)));});
  const time=(value:number)=>`${Math.floor(value/60)}:${String(Math.floor(value%60)).padStart(2,'0')}`;
  async function poll():Promise<void> {
    try {
      const next=await api('state?after='+sequence) as NativeState;if(disposed)return;
      if(next.epoch<state.epoch)return;
      const wasPlaying=state.playing;state=next;
      if(epoch!==state.epoch){epoch=state.epoch;queue.reset(epoch,0,0);lastName='';tracks.clear();get('spotify-now-playing').replaceChildren();}
      if(state.name&&state.name!==lastName){
        lastName=state.name;tracks.setBridge({type:'track',basename:state.uri??state.name,title:state.title??state.name,artist:state.artist??'',album:state.album??'',duration:state.duration});
        const credit=get('spotify-now-playing');credit.replaceChildren();
        if(state.source==='spotify'){
          if(state.cover){const img=document.createElement('img');img.src=state.cover;img.alt=state.album?'Cover of '+state.album:'Album cover';credit.append(img);}
          const link=document.createElement('a');link.textContent='From Spotify';link.href=state.url??'https://open.spotify.com/';link.addEventListener('click',event=>{event.preventDefault();(window as unknown as {ipc?:{postMessage(s:string):void}}).ipc?.postMessage(JSON.stringify({op:'open-spotify',url:state.url}));});credit.append(link);spotifyLibrary.markCurrent(state.uri?.split(':').at(-1)??'');
        }
      }
      for(const frame of state.frames){const gap=sequence>0&&frame.sequence!==sequence+1;sequence=Math.max(sequence,frame.sequence);queue.push({...frame,discontinuity:gap,pcm:new Float32Array(frame.pcm).buffer});}
      if(bridge.ready){const batch=queue.take(state.position);bridge.emit({type:'audio',live:false,epoch,position:state.position,duration:state.duration,playing:state.playing,visible:!document.hidden,...batch});}
      seek.disabled=state.duration<=0;seek.max=String(state.duration);if(document.activeElement!==seek)seek.value=String(state.position);
      get('player-clock').textContent=`${time(state.position)} / ${time(state.duration)}`;get('player-play').textContent=state.playing?'Pause':'Play';
      get('player-track').textContent=state.loading?'Opening audio…':state.name??'Choose a local audio file';
      if(state.playing&&!wasPlaying)notice(state.source==='spotify'?'Playing from Spotify. Presets and stars use your shared AAAVS library.':'Playing local audio.');
      if(state.error)notice(state.error);
      if(state.ended>ended){ended=state.ended;if(state.source==='spotify')void stepSpotify(1);else if(files.length>1)playAt(at+1);}
    }catch{if(!disposed){bridge.emit({type:'audio',epoch,position:state.position,playing:false,pcm:new Float32Array(1152)});notice('Local audio engine unavailable.');}}
    finally{if(!disposed)window.setTimeout(()=>void poll(),33);}
  }
  window.addEventListener('pagehide',()=>{disposed=true;},{once:true});
  bridge.emit({type:'settings',...freshSettings,...prefsToWire(bridge.prefs)});
  try{await import('aaavs/mpc-host.ts');}catch(error){notice('Visualizer startup failed: '+String(error));}
  void poll();
}

if(typeof document!=='undefined'&&document.getElementById('unused-browser-audio'))void startSpotifastPlayer();
