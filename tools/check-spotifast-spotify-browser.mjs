// Assembled browser test with a fake account/provider and protocol process.
// Native device playback is covered separately; this never contacts Spotify.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {aaavsRequire,aaavsRoot,localRoot,projectRoot} from './project-paths.mjs';
const {chromium}=aaavsRequire()('playwright-core');
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {startDesktopServer} from './spotifast-server.mjs';
// The page is this project's renderer build (node tools/build-renderer.mjs); presets and ratings are AAAVS's.
const root=aaavsRoot(),out=join(localRoot,'spotify-evidence'),renderer=resolve(process.env.SPOTIFAST_RENDERER??join(localRoot,'renderer-dev'));
assert.ok(existsSync(join(renderer,'spotifast-player.js')),'Build the renderer first: node tools/build-renderer.mjs');mkdirSync(out,{recursive:true});
const first='A'.repeat(22),second='B'.repeat(22),third='C'.repeat(22),playlist='P'.repeat(22);
const song=(id,name)=>({id,type:'track',name,artists:[{name:'Fixture artist'}],album:{name:'Fixture album',images:[{url:'https://i.scdn.co/image/fixturecover'}]},duration_ms:120000});
const json=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
let providerCalls=0;
const provider=async(url)=>{
  providerCalls++;
  if(url==='https://accounts.spotify.com/api/token')return json({access_token:'fixture-only-access',refresh_token:'fixture-only-refresh',expires_in:3600});
  if(url==='https://i.scdn.co/image/fixturecover')return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#203e4d"/><circle cx="32" cy="32" r="20" fill="#74c9e8"/></svg>',{headers:{'Content-Type':'image/svg+xml'}});
  assert.ok(url.startsWith('https://api.spotify.com/v1/'));
  if(url.includes('/me/playlists?'))return json({items:[{id:playlist,name:'Fixture playlist',tracks:{total:2}}],total:1,next:null});
  if(url.includes('/playlists/'))return json({items:[{item:song(first,'Playlist first')},{item:song(second,'Playlist second')}],total:2,next:null});
  if(url.includes('offset=50'))return json({items:[{track:song(third,'Liked later page')}],total:3,next:null});
  return json({items:[{track:song(first,'Liked first')},{track:song(second,'Liked second')}],total:3,next:'https://api.spotify.com/v1/me/tracks?offset=50'});
};
const ratings=()=>new Map(JSON.parse(readFileSync(join(root,'avs presets/catalog/presets.json'))).presets.map(p=>[p.sha256,p.rating]));
const original=ratings();
const app=await startDesktopServer({root,renderer,engine:process.execPath,engineArgs:[join(projectRoot,'tools/test-support/spotify-engine-fixture.mjs')],spotifyOptions:{fetch:provider,callbackPort:0}});
const post=async body=>(await fetch(app.url+'api/spotifast/command',{method:'POST',headers:{'Content-Type':'application/json','X-AAAVS-Session':app.secret,Origin:app.url.slice(0,-1)},body:JSON.stringify(body)})).json();
let browser;const errors=[];const report={account:'fixture only',nativeAccountPlayback:'not tested'};
try {
  const flow=await post({op:'spotify-connect',clientId:'a'.repeat(32)}),auth=new URL(flow.authorizeUrl);
  assert.equal((await fetch(flow.redirectUri+'?state='+auth.searchParams.get('state')+'&code=fixture')).status,200);
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(app.url+'#'+app.secret);await page.waitForFunction(()=>window.aaavsBridge?.ready);
  await page.locator('#player-spotify').click();await page.getByRole('button',{name:'Liked first',exact:false}).waitFor();
  await page.screenshot({path:join(out,'spotify-liked-songs.png')});
  await page.getByRole('button',{name:'Load more songs'}).click();await page.getByRole('button',{name:'Liked later page',exact:false}).waitFor();report.pagination=true;
  await page.getByRole('button',{name:'Fixture playlist',exact:true}).click();await page.getByRole('button',{name:'Playlist first',exact:false}).waitFor();
  await page.getByRole('button',{name:'Playlist first',exact:false}).click();
  await page.waitForFunction(()=>document.querySelector('#player-track').textContent.includes('Playlist first')&&document.querySelector('#player-play').textContent==='Pause');
  await page.waitForFunction(()=>document.querySelector('#spotify-now-playing img')?.naturalWidth>0);report.coverAndAttribution=true;
  await page.locator('#spotify-library header button').click();await page.waitForTimeout(500);await page.screenshot({path:join(out,'spotify-playing-fixture.png')});
  await page.locator('#player-play').click();await page.waitForFunction(()=>document.querySelector('#player-play').textContent==='Play');report.pause=true;
  await page.locator('#player-seek').evaluate(e=>{e.value='20';e.dispatchEvent(new Event('change',{bubbles:true}));});await page.waitForFunction(()=>Number(document.querySelector('#player-seek').value)===20);report.seek=true;
  await page.locator('#player-track-next').click();await page.waitForFunction(()=>document.querySelector('#player-track').textContent.includes('Playlist second'));report.next=true;
  await page.locator('#player-track-prev').click();await page.waitForFunction(()=>document.querySelector('#player-track').textContent.includes('Playlist first'));report.previous=true;
  app.child.stdin.write(JSON.stringify({op:'fixture-end'})+'\n');await page.waitForFunction(()=>document.querySelector('#player-track').textContent.includes('Playlist second'));report.autoQueue=true;
  await page.locator('#player-stop').click();await page.waitForFunction(()=>document.querySelector('#player-play').textContent==='Play'&&Number(document.querySelector('#player-seek').value)===0);await page.locator('#player-play').click();await page.waitForFunction(()=>document.querySelector('#player-play').textContent==='Pause');report.stopAndRestart=true;
  await page.locator('#player-manager').click();await page.locator('#management:not([hidden])').waitFor();const manager=await page.locator('#management').innerText();assert.match(manager,/5 stars|5\+ stars/);report.sharedStarUi=true;
  await page.screenshot({path:join(out,'spotify-shared-star-library.png')});await page.locator('#player-manager').click();
  for(const width of [768,375]){await page.setViewportSize({width,height:800});await page.locator('#player-spotify').click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(out,`spotify-${width}.png`)});await page.locator('#spotify-library header button').click();}
  await page.locator('#player-spotify').click();await page.getByRole('button',{name:'Disconnect',exact:true}).click();await page.getByRole('button',{name:'Connect Spotify',exact:true}).waitFor();report.disconnect=true;
  assert.equal(errors.length,0,JSON.stringify(errors));const after=ratings();for(const [hash,rating]of original)assert.equal(after.get(hash),rating,'owner star ratings unchanged');
  report.ownerStarsUnchanged=true;report.errors=errors;report.providerFixtureCalls=providerCalls;writeFileSync(join(out,'browser-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser?.close();await app.close();}
