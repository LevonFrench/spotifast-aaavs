export interface SpotifyTrack {id:string;uri:string;title:string;artist:string;album:string;duration:number;cover:string|null;url:string;playable:boolean}
export interface SpotifyContext {kind:'liked'|'tracks';id?:string;next:number|null}
type Api=(path:string,body?:unknown)=>Promise<any>;

/** Account UI only. Preset navigation and ratings stay in the shared host. */
export class SpotifyLibrary {
  private generation=0;
  private connected=false;
  private disposed=false;
  private timer=0;
  private error:HTMLElement;
  private account:HTMLElement;
  private content:HTMLElement;
  private playlists:HTMLElement;
  private rows:SpotifyTrack[]=[];
  private context:SpotifyContext={kind:'liked',next:null};
  private current='';
  private busy=false;
  private status:{connected:boolean;connecting:boolean;redirectUri:string;error?:string}={connected:false,connecting:false,redirectUri:'http://127.0.0.1:43817/spotify-callback'};
  constructor(private panel:HTMLElement,private api:Api,private play:(tracks:SpotifyTrack[],index:number,context:SpotifyContext)=>void,private closed:()=>void) {
    panel.classList.add('spotify-library');
    const header=document.createElement('header'),title=document.createElement('h1');title.textContent='Spotify';header.append(title);
    const close=this.button('Close',()=>this.hide());header.append(close);panel.append(header);
    this.error=document.createElement('p');this.error.className='spotify-message';this.error.setAttribute('role','status');panel.append(this.error);
    this.account=document.createElement('div');this.account.className='spotify-account';panel.append(this.account);
    const layout=document.createElement('div');layout.className='spotify-layout';
    this.playlists=document.createElement('nav');this.playlists.setAttribute('aria-label','Spotify collections');
    this.content=document.createElement('section');this.content.setAttribute('aria-label','Spotify tracks');layout.append(this.playlists,this.content);panel.append(layout);
    panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.hide();}});
    panel.addEventListener('dblclick',event=>event.stopPropagation());
    window.addEventListener('pagehide',()=>{this.disposed=true;clearTimeout(this.timer);},{once:true});
    this.renderAccount();void this.refresh();
  }
  private button(label:string,action:()=>void):HTMLButtonElement {const b=document.createElement('button');b.textContent=label;b.type='button';b.onclick=action;return b;}
  show():void {this.panel.hidden=false;this.panel.querySelector<HTMLButtonElement>('header button')?.focus();void this.refresh();}
  hide():void {this.panel.hidden=true;this.closed();}
  markCurrent(id:string):void {if(this.current===id)return;this.current=id;for(const row of this.content.querySelectorAll<HTMLElement>('[data-track-id]'))row.setAttribute('aria-current',String(row.dataset.trackId===id));}
  private open(url:string):void {(window as unknown as {ipc?:{postMessage(s:string):void}}).ipc?.postMessage(JSON.stringify({op:'open-spotify',url}));}
  private renderAccount():void {
    this.account.replaceChildren();
    if(this.status.connected){const label=document.createElement('span');label.textContent='Connected to Spotify';this.account.append(label,this.button('Disconnect',()=>{void this.api('command',{op:'spotify-disconnect'}).then(()=>{this.generation++;this.rows=[];this.playlists.replaceChildren();this.content.replaceChildren();return this.refresh();}).catch(error=>{this.error.textContent=String(error);});}));return;}
    const form=document.createElement('form'),label=document.createElement('label'),input=document.createElement('input');
    label.textContent='Spotify Client ID';input.name='clientId';input.placeholder='Your app’s 32-character Client ID';input.maxLength=32;input.required=true;input.pattern='[a-fA-F0-9]{32}';input.spellcheck=false;input.autocomplete='off';label.append(input);
    const connect=this.button('Connect Spotify',()=>{});connect.type='submit';form.append(label,connect);
    form.onsubmit=event=>{event.preventDefault();connect.disabled=true;this.error.textContent='Opening Spotify in your browser…';void this.api('command',{op:'spotify-connect',clientId:input.value.trim()}).then(result=>{this.open(result.authorizeUrl);this.error.textContent='Complete sign-in in your browser, then return here.';return this.refresh();}).catch(error=>{this.error.textContent=String(error);}).finally(()=>{connect.disabled=false;});};
    const help=document.createElement('details'),summary=document.createElement('summary');summary.textContent='First-time setup';help.append(summary);
    const explanation=document.createElement('p');explanation.textContent='Create an app in the Spotify developer dashboard, select Web API and register this exact redirect URI. Playback requires Spotify Premium. Your connection lasts until you close this player.';
    const uri=document.createElement('code');uri.textContent=this.status.redirectUri;
    help.append(explanation,uri,this.button('Open Spotify dashboard',()=>this.open('https://developer.spotify.com/dashboard')));
    this.account.append(form,help);
  }
  private async refresh():Promise<void> {
    clearTimeout(this.timer);
    try {
      const status=await this.api('spotify/status');if(this.disposed)return;
      const changed=this.connected!==status.connected;this.status=status;
      if(changed){this.connected=status.connected;this.renderAccount();if(this.connected){this.error.textContent='';await this.loadPlaylists();}}
      if(status.error)this.error.textContent=status.error;
    }catch(error){if(!this.panel.hidden)this.error.textContent=String(error);}
    finally{if(!this.disposed)this.timer=window.setTimeout(()=>void this.refresh(),this.status.connecting||!this.panel.hidden?3000:15000);}
  }
  private async loadPlaylists(offset=0):Promise<void> {
    const generation=this.generation;
    try {
      const result=await this.api('spotify/library?kind=playlists&offset='+offset);if(generation!==this.generation)return;
      if(!offset){this.playlists.replaceChildren(this.button('Liked Songs',()=>void this.loadTracks('liked',undefined,0,'Liked Songs')));}
      this.playlists.querySelector('[data-more]')?.remove();
      for(const playlist of result.items){const button=this.button(playlist.name,()=>void this.loadTracks('tracks',playlist.id,0,playlist.name));button.title=playlist.description;this.playlists.append(button);}
      if(result.next!==null){const more=this.button('More playlists',()=>{more.disabled=true;void this.loadPlaylists(result.next);});more.dataset.more='true';this.playlists.append(more);}
      if(!offset)await this.loadTracks('liked',undefined,0,'Liked Songs');
    }catch(error){this.error.textContent=String(error);}
  }
  private async loadTracks(kind:'liked'|'tracks',id:string|undefined,offset:number,title:string):Promise<void> {
    if(this.busy&&offset)return;
    const generation=offset?this.generation:++this.generation;this.busy=true;this.error.textContent='Loading '+title+'…';
    try {
      const result=await this.api(`spotify/library?kind=${kind}&offset=${offset}${id?'&id='+encodeURIComponent(id):''}`);if(generation!==this.generation)return;
      if(!offset){this.rows=[];this.content.replaceChildren();const h=document.createElement('h2');h.textContent=title;this.content.append(h);}
      this.context={kind,id,next:result.next};this.content.querySelector('[data-more]')?.remove();
      for(const row of result.items as SpotifyTrack[]) {
        const index=this.rows.length;this.rows.push(row);const button=this.button('',()=>this.play([...this.rows],index,{...this.context}));
        button.className='spotify-track';button.dataset.trackId=row.id;button.disabled=!row.playable;button.setAttribute('aria-current',String(row.id===this.current));
        const name=document.createElement('strong');name.textContent=row.title;const artist=document.createElement('span');artist.textContent=row.artist+' · '+row.album;
        const duration=document.createElement('time');duration.textContent=`${Math.floor(row.duration/60)}:${String(Math.floor(row.duration%60)).padStart(2,'0')}`;
        button.append(name,artist,duration);if(!row.playable)button.title='Spotify does not make this track available for playback.';this.content.append(button);
      }
      if(result.next!==null){const more=this.button('Load more songs',()=>void this.loadTracks(kind,id,result.next,title));more.dataset.more='true';this.content.append(more);}
      this.error.textContent=this.rows.length?`${this.rows.length} of ${result.total} songs`:'No playable songs in this collection.';
    }catch(error){if(generation===this.generation)this.error.textContent=String(error);}
    finally{if(generation===this.generation)this.busy=false;}
  }
}
