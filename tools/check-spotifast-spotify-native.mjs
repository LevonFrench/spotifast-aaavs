import {aaavsRequire,localRoot} from './project-paths.mjs';
const {chromium}=aaavsRequire()('playwright-core');
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
const out=join(localRoot,'spotify-evidence');mkdirSync(out,{recursive:true});
const browser=await chromium.connectOverCDP('http://127.0.0.1:9358');
const page=browser.contexts().flatMap(c=>c.pages()).find(p=>/^http:\/\/127\.0\.0\.1:\d+\//.test(p.url()));assert.ok(page);
const errors=[];page.on('pageerror',error=>errors.push(String(error)));
try {
  await page.waitForFunction(()=>window.aaavsBridge?.ready);
  assert.ok(await page.evaluate(()=>!!window.chrome?.webview),'real WebView2 host');
  await page.locator('#player-spotify').click();
  await page.getByRole('button',{name:'Connect Spotify',exact:true}).waitFor();
  await page.getByText('First-time setup',{exact:true}).click();
  assert.match(await page.locator('#spotify-library').innerText(),/127\.0\.0\.1:43817\/spotify-callback/);
  assert.equal(await page.locator('input[name=clientId]').inputValue(),'','no account or credentials preloaded');
  await page.screenshot({path:join(out,'native-spotify-setup.png')});
  // The connection button is intentionally never clicked by this test.
  await page.locator('#spotify-library header button').click();
  if(process.env.AAAVS_SPOTIFAST_TEST_FILE){
    await page.locator('#player-volume').evaluate(e=>{e.value='0';e.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.evaluate(path=>window.dispatchEvent(new CustomEvent('aaavs-files',{detail:[path]})),process.env.AAAVS_SPOTIFAST_TEST_FILE);
    await page.waitForFunction(()=>Number(document.querySelector('#player-seek').value)>.3&&document.querySelector('#player-play').textContent==='Pause');
    await page.screenshot({path:join(out,'native-local-playback.png')});
    await page.locator('#player-stop').click();await page.waitForFunction(()=>document.querySelector('#player-play').textContent==='Play'&&Number(document.querySelector('#player-seek').value)===0);
  }
  assert.equal(errors.length,0);writeFileSync(join(out,'native-check.json'),JSON.stringify({webview2:true,spotifySetup:true,noAccountAccess:true,localPlayback:!!process.env.AAAVS_SPOTIFAST_TEST_FILE,errors},null,2));
  console.log('Native WebView2: Spotify setup and local playback/Stop passed; no sign-in or account access.');
}finally{await page.evaluate(()=>window.ipc.postMessage('close-player')).catch(()=>{});await browser.close();}
