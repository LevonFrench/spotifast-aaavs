import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createDesktopSpotify,SPOTIFY_SCOPES} from './spotifast-spotify.mjs';

let assertions=0;
const check=(value,message)=>{assert.ok(value,message);assertions++;};
const id='a'.repeat(32),playlist='P'.repeat(22),song='S'.repeat(22),later='L'.repeat(22),unavailable='U'.repeat(22);
let clock=100000,refreshes=0,grants=0,apiCalls=0,rateLimit=false,unauthorized=0,releaseApi=null,holdApi=false;
const row=(id,title)=>({id,type:'track',uri:'spotify:track:'+id,name:title,artists:[{name:'Fixture artist'}],album:{name:'Fixture album',images:[]},duration_ms:123000});
const response=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...headers}});
const provider=async(url,options={})=>{
  if(url==='https://accounts.spotify.com/api/token') {
    const body=new URLSearchParams(options.body);
    if(body.get('grant_type')==='refresh_token'){refreshes++;return response({access_token:'fixture-refreshed',expires_in:60});}
    grants++;check(body.get('client_id')===id,'the owner client ID is used');check(body.has('code_verifier'),'PKCE verifier is sent server-side');
    return response({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:60});
  }
  check(url.startsWith('https://api.spotify.com/v1/'),'only fixed Spotify API origins are requested');apiCalls++;
  check(options.headers.Authorization.startsWith('Bearer fixture-'),'tokens stay on provider requests');
  if(rateLimit)return response({error:'provider detail should not be exposed'},429,{'retry-after':'2'});
  if(unauthorized>0){unauthorized--;return response({error:'private provider detail'},401);}
  if(holdApi)await new Promise(resolve=>{releaseApi=resolve;});
  if(url.includes('/me/playlists?'))return response({items:[{id:playlist,name:'My playlist',description:'Private fixture',tracks:{total:2},images:[]}],total:1,next:null});
  if(url.includes('offset=50'))return response({items:[{track:row(later,'Later page')}],total:51,next:null});
  if(url.includes('/items?'))return response({items:[{item:row(song,'New item schema')},{track:row(later,'Legacy track schema')},{item:{...row(unavailable,'Unavailable'),is_playable:false}},{item:{...row('E'.repeat(22),'Episode'),type:'episode'}},{item:{...row('F'.repeat(22),'Local'),is_local:true}}],total:5,next:null});
  return response({items:[{track:row(song,'Liked track')}],total:51,next:'https://untrusted.invalid/not-followed'});
};
const spotify=createDesktopSpotify({fetch:provider,callbackPort:0,now:()=>clock});
try {
  check(!spotify.status().connected,'starts disconnected without reading account state');
  await assert.rejects(()=>spotify.playback(song),/Select/);assertions++;
  await assert.rejects(()=>spotify.begin('not-a-client-id'),/Client ID/);assertions++;
  const flow=await spotify.begin(id),authorize=new URL(flow.authorizeUrl);
  check(authorize.origin==='https://accounts.spotify.com','official authorization page');
  check(authorize.searchParams.get('code_challenge_method')==='S256','PKCE S256');
  check(authorize.searchParams.get('scope').split(' ').every(scope=>SPOTIFY_SCOPES.includes(scope)),'only declared scopes');
  const callback=new URL(flow.redirectUri);
  const bad=await fetch(callback+'?state=wrong&code=fixture');check(bad.status===400,'wrong state rejected before token exchange');check(grants===0,'wrong state makes no provider request');
  const unicode=await fetch(callback+'?state='+encodeURIComponent('é'.repeat(48))+'&code=fixture');check(unicode.status===400,'unequal nonce byte lengths fail safely');
  const good=await fetch(callback+'?state='+authorize.searchParams.get('state')+'&code=fixture-code');check(good.status===200,'valid callback connects');
  check(spotify.status().connected,'connection is available');
  check(!JSON.stringify(spotify.status()).includes('fixture-access'),'status never exposes access tokens');
  const replay=await fetch(callback+'?state='+authorize.searchParams.get('state')+'&code=fixture-code');check(replay.status===400,'authorization state is one-use');
  const lists=await spotify.page('playlists');check(lists.items[0].id===playlist,'private playlist list');
  const liked=await spotify.page('liked');check(liked.items[0].title==='Liked track'&&liked.next===50,'Liked Songs has bounded pagination');
  const next=await spotify.page('liked',{offset:liked.next});check(next.items[0].id===later,'later pages use the official endpoint');
  const items=await spotify.page('tracks',{id:playlist});check(items.items.length===3,'episodes and local entries are excluded');check(items.items[0].title==='New item schema'&&items.items[1].title==='Legacy track schema','new and legacy playlist schemas work');
  await assert.rejects(()=>spotify.playback(unavailable),/available/);assertions++;
  const play=await spotify.playback(song);check(play.op==='spotify-load'&&play.track.uri==='spotify:track:'+song,'browsed tracks map to the native player');
  await assert.rejects(()=>spotify.page('tracks',{id:'../escape'}),/Unknown/);assertions++;
  await assert.rejects(()=>spotify.page('liked',{offset:-1}),/Invalid/);assertions++;
  clock+=61000;await Promise.all([spotify.page('liked'),spotify.page('playlists')]);check(refreshes===1,'concurrent expiry refreshes once');
  unauthorized=1;await spotify.page('liked');check(refreshes===2,'401 refreshes once and retries');
  rateLimit=true;await assert.rejects(()=>spotify.page('liked'),/2 seconds/);assertions++;const previous=apiCalls;await assert.rejects(()=>spotify.page('liked'),/rate-limiting/);assertions++;check(apiCalls===previous,'rate-limit cooldown prevents repeated provider calls');
  rateLimit=false;clock+=3000;
  holdApi=true;const stale=spotify.page('liked');while(!releaseApi)await new Promise(resolve=>setTimeout(resolve,1));spotify.disconnect();releaseApi();await assert.rejects(()=>stale,/cancelled/);assertions++;
  check(!spotify.status().connected,'disconnect clears the in-memory account');
  await assert.rejects(()=>spotify.playback(song),/Select/);assertions++;
  check(await spotify.image('not-known')===null,'unknown covers cannot proxy arbitrary URLs');
  console.log(`Spotify adapter: PASS (${assertions} assertions; PKCE, callback replay/nonce checks, playlist/Liked Songs pagination, schema compatibility, native mapping, refresh, cooldown, disconnect). No real account or Spotify network request used.`);
}finally{await spotify.close();}
