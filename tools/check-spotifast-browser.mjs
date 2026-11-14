// Inspects only the prototype's explicitly enabled local WebView2 debug port.
import {aaavsRequire,localRoot} from './project-paths.mjs';
const {chromium}=aaavsRequire()('playwright-core');
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const out=join(localRoot,'evidence');mkdirSync(out,{recursive:true});
const browser=await chromium.connectOverCDP(process.env.AAAVS_SPOTIFAST_CDP??'http://127.0.0.1:9338');
const page=browser.contexts().flatMap(c=>c.pages()).find(p=>/^http:\/\/127\.0\.0\.1:\d+\//.test(p.url()));
if(!page)throw Error('The prototype page is not open');
const errors=[];page.on('pageerror',error=>errors.push(String(error)));
await page.waitForFunction(()=>window.aaavsBridge?.ready,{},{timeout:30000});
const summary=await page.evaluate(()=>({title:document.title,notice:document.querySelector('#player-notice')?.textContent,preset:document.querySelector('#preset')?.textContent,status:document.querySelector('#status')?.textContent,bridgeReady:window.aaavsBridge?.ready,webview:!!window.chrome?.webview,canvas:{width:document.querySelector('canvas')?.width,height:document.querySelector('canvas')?.height}}));
await page.screenshot({path:join(out,'windows-player.png')});
if(process.argv.includes('--play')) {
  const file=process.env.AAAVS_SPOTIFAST_TEST_FILE;if(!file)throw Error('Provide the synthetic test WAV path');
  await page.locator('#player-volume').evaluate(input=>{input.value='0';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.evaluate(path=>window.dispatchEvent(new CustomEvent('aaavs-files',{detail:[path]})),file);
  await page.waitForFunction(()=>Number(document.querySelector('#player-seek')?.value)>.4&&document.querySelector('#player-play')?.textContent==='Pause');
  summary.playing=await page.locator('#player-clock').innerText();
  const pixels=()=>page.evaluate(()=>{const c=document.querySelector('canvas');const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let sum=0,lit=0;for(let i=0;i<p.length;i+=16){sum=(sum*31+p[i]+p[i+1]+p[i+2])>>>0;if(p[i]+p[i+1]+p[i+2]>15)lit++;}return {sum,lit};});
  const first=await pixels();await page.waitForTimeout(400);const second=await pixels();
  summary.frames={first,second,changed:first.sum!==second.sum};
  await page.screenshot({path:join(out,'windows-playing.png')});
  await page.locator('#player-play').click();await page.waitForFunction(()=>document.querySelector('#player-play')?.textContent==='Play');
  summary.paused=true;
}
await page.locator('#player-manager').click();await page.waitForSelector('#management:not([hidden])');
summary.presetManager=(await page.locator('#management').innerText()).slice(0,1000);
await page.screenshot({path:join(out,'shared-preset-manager.png')});
await page.locator('#player-manager').click();
// Navigation uses the same host messages as the existing Player.
const oldPreset=await page.locator('#preset').textContent();
await page.locator('#player-next').click();
await page.waitForFunction(old=>document.querySelector('#preset')?.textContent!==old,oldPreset);
summary.presetNext=await page.locator('#preset').innerText();
summary.errors=errors;writeFileSync(join(out,process.argv.includes('--play')?'browser-check.json':'browser-navigation.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary));
if(process.argv.includes('--close'))await page.evaluate(()=>window.ipc.postMessage('close-player')).catch(()=>{});
await browser.close();
