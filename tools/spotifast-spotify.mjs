// Spotify account state belongs to this running app only. No credential files,
// existing Spotify installations or account stores are read by this adapter.
import {createServer} from 'node:http';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';

export const SPOTIFY_SCOPES=['playlist-read-private','playlist-read-collaborative','user-library-read','streaming','user-read-private'];
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9]{22}$/.test(id);
const text=(value,max=300)=>typeof value==='string'?value.slice(0,max):'';
const publicError=(message,status=400)=>Object.assign(Error(message),{status});

export function createDesktopSpotify({fetch:request=globalThis.fetch,callbackPort=43817,now=Date.now}={}) {
  let tokens=null,clientId='',pending=null,callbackServer=null,refreshing=null,generation=0,lastError='',cooldown=0;
  const tracks=new Map(),covers=new Map(),coverIds=new Map();
  const redirect=()=>`http://127.0.0.1:${callbackServer?.address()?.port??callbackPort}/spotify-callback`;
  const requestOptions=options=>({...options,redirect:'error',signal:AbortSignal.timeout(15000)});
  async function responseJson(url,options={}) {
    let response;
    try{response=await request(url,requestOptions(options));}catch{throw publicError('Spotify could not be reached. Check your connection and try again.',502);}
    if(response.status===429){const seconds=Math.max(1,Math.min(3600,Number(response.headers.get('retry-after'))||30));cooldown=now()+seconds*1000;throw publicError(`Spotify is busy. Try again in ${seconds} seconds.`,429);}
    const body=await response.json().catch(()=>null);
    return {response,body};
  }
  async function tokenRequest(body,version) {
    const {response,body:result}=await responseJson('https://accounts.spotify.com/api/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});
    if(version!==generation)throw publicError('This connection was cancelled.',409);
    if(!response.ok||typeof result?.access_token!=='string'){tokens=null;throw publicError('Spotify connection expired or was declined. Connect again.',401);}
    tokens={access:result.access_token,refresh:result.refresh_token??tokens?.refresh,expires:now()+Math.max(1,Math.min(86400,Number(result.expires_in)||3600))*1000};
    lastError='';return tokens.access;
  }
  async function accessToken(force=false) {
    if(!tokens)throw publicError('Connect Spotify first.',401);
    if(!force&&tokens.expires>now()+30000)return tokens.access;
    if(!tokens.refresh){tokens=null;throw publicError('Connect Spotify again.',401);}
    return refreshing??=(tokenRequest({grant_type:'refresh_token',refresh_token:tokens.refresh,client_id:clientId},generation).finally(()=>{refreshing=null;}));
  }
  async function api(path,retried=false) {
    if(now()<cooldown)throw publicError('Spotify is rate-limiting requests. Please wait before trying again.',429);
    const version=generation,bearer=await accessToken();
    const {response,body}=await responseJson('https://api.spotify.com/v1/'+path,{headers:{Authorization:'Bearer '+bearer}});
    if(version!==generation)throw publicError('This connection was cancelled.',409);
    if(response.status===401&&!retried){await accessToken(true);return api(path,true);}
    if(!response.ok)throw publicError(response.status===403?'Spotify declined access. Check this app’s permissions, allowed users and Premium subscription.':response.status===404?'Spotify could not find or grant access to this collection.':'Spotify could not load this page. Try again.',response.status);
    return body;
  }
  function cover(images) {
    const image=Array.isArray(images)?images.find(i=>typeof i?.url==='string'&&/^https:\/\/i\.scdn\.co\/image\/[a-zA-Z0-9]+$/.test(i.url)):null;
    if(!image)return null;
    const key=coverIds.get(image.url)??randomBytes(16).toString('hex');covers.set(key,image.url);coverIds.set(image.url,key);
    if(covers.size>2000){const first=covers.keys().next().value;coverIds.delete(covers.get(first));covers.delete(first);}
    return '/api/spotifast/spotify/cover/'+key;
  }
  function track(value) {
    if(!value||value.type&&value.type!=='track'||!validId(value.id)||value.is_local)return null;
    const row={id:value.id,uri:'spotify:track:'+value.id,title:text(value.name),artist:(value.artists??[]).slice(0,12).map(a=>text(a?.name,100)).filter(Boolean).join(', '),album:text(value.album?.name),duration:Math.max(0,Math.min(86400,(Number(value.duration_ms)||0)/1000)),cover:cover(value.album?.images),url:'https://open.spotify.com/track/'+value.id,playable:value.is_playable!==false&&!value.restrictions?.reason};
    tracks.set(row.id,row);if(tracks.size>10000)tracks.delete(tracks.keys().next().value);return row;
  }
  async function page(kind,{id,offset=0}={}) {
    if(!Number.isInteger(offset)||offset<0||offset>100000)throw publicError('Invalid page.');
    const suffix=`limit=50&offset=${offset}`;
    let body;
    if(kind==='playlists')body=await api('me/playlists?'+suffix);
    else if(kind==='liked')body=await api('me/tracks?'+suffix);
    else if(kind==='tracks'&&validId(id)) {
      try{body=await api(`playlists/${id}/items?${suffix}`);}catch(error){if(error.status!==404)throw error;body=await api(`playlists/${id}/tracks?${suffix}`);}
    }else throw publicError('Unknown Spotify collection.');
    const items=(Array.isArray(body?.items)?body.items:[]).slice(0,50);
    return {items:kind==='playlists'?items.filter(p=>validId(p?.id)).map(p=>({id:p.id,name:text(p.name),description:text(p.description),total:Number(p.items?.total??p.tracks?.total)||0,cover:cover(p.images)})):items.map(item=>track(item?.item??item?.track)).filter(Boolean),offset,total:Number(body?.total)||0,next:body?.next?offset+50:null};
  }
  function status(){return {connected:!!tokens,connecting:!!pending,clientId,redirectUri:redirect(),error:lastError};}
  async function begin(id) {
    if(typeof id!=='string'||!/^[a-fA-F0-9]{32}$/.test(id))throw publicError('Enter your 32-character Spotify Client ID.');
    if(!callbackServer) {
      callbackServer=createServer(async(req,res)=>{
        const url=new URL(req.url,'http://127.0.0.1');
        if(req.headers.host!==new URL(redirect()).host||req.method!=='GET'||url.pathname!=='/spotify-callback'){res.writeHead(404);res.end();return;}
        const state=url.searchParams.get('state')??'',flow=pending;
        const incoming=Buffer.from(state),expected=Buffer.from(flow?.state??'');
        if(!flow||now()>flow.expires||incoming.length!==expected.length||!timingSafeEqual(incoming,expected)){res.writeHead(400);res.end('This Spotify connection is invalid or expired. Return to the player and connect again.');return;}
        pending=null;
        try {
          const code=url.searchParams.get('code');if(url.searchParams.has('error')||!code)throw publicError('Spotify sign-in was cancelled.');
          await tokenRequest({grant_type:'authorization_code',code,redirect_uri:flow.redirect,client_id:clientId,code_verifier:flow.verifier},flow.generation);
          res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"});
          res.end('<title>Spotify connected</title><body style="font:18px system-ui;background:#151c25;color:#edf5fc;padding:48px">Spotify is connected. Return to Spotifast + AAAVS. You can close this tab.</body>');
        }catch(error){if(flow.generation===generation)lastError=error.message;res.writeHead(400,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end('Spotify was not connected. Return to the player for details.');}
      });
      try{await new Promise((yes,no)=>{callbackServer.once('error',no);callbackServer.listen(callbackPort,'127.0.0.1',yes);});}
      catch{callbackServer=null;throw publicError('The Spotify return port is busy. Close another player instance and try again.',409);}
    }
    generation++;clientId=id;tokens=null;tracks.clear();covers.clear();coverIds.clear();lastError='';
    const verifier=randomBytes(48).toString('base64url'),state=randomBytes(24).toString('hex');
    pending={verifier,state,expires:now()+600000,redirect:redirect(),generation};
    const params=new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:pending.redirect,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),state,scope:SPOTIFY_SCOPES.join(' ')});
    return {authorizeUrl:'https://accounts.spotify.com/authorize?'+params,redirectUri:pending.redirect};
  }
  function disconnect(){generation++;tokens=null;pending=null;lastError='';tracks.clear();covers.clear();coverIds.clear();}
  async function playback(id) {const row=tracks.get(id);if(!row||!row.playable)throw publicError('Select an available Spotify track from this library.');const version=generation,access=await accessToken();if(version!==generation)throw publicError('This connection was cancelled.',409);return {op:'spotify-load',clientId,accessToken:access,track:row};}
  async function image(key) {
    const url=covers.get(key);if(!url)return null;
    const response=await request(url,requestOptions({}));if(!response.ok||Number(response.headers.get('content-length'))>2097152)return null;
    const reader=response.body.getReader();let size=0,parts=[];
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2097152){await reader.cancel();return null;}parts.push(Buffer.from(value));}
    return {bytes:Buffer.concat(parts),type:response.headers.get('content-type')?.startsWith('image/')?response.headers.get('content-type'):'image/jpeg'};
  }
  async function close(){disconnect();if(callbackServer){callbackServer.closeAllConnections();await new Promise(resolve=>callbackServer.close(resolve));callbackServer=null;}}
  return {status,begin,disconnect,page,playback,image,close};
}
