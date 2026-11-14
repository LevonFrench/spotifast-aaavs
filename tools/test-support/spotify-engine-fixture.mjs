// Account-free browser-test process. Never used by the packaged app.
import {createInterface} from 'node:readline';
let epoch=0,playing=false,position=0,track=null;
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const state=extra=>send({type:'state',epoch,source:'spotify',playing,position,stopped:false,duration:track?.duration??120,name:track?track.artist+' — '+track.title:null,...track,...extra});
createInterface({input:process.stdin}).on('line',line=>{
  const command=JSON.parse(line);
  switch(command.op){
    case 'spotify-load':epoch++;track=command.track;position=0;playing=true;state({loading:false,discontinuity:true});break;
    case 'pause':playing=false;state();break;
    case 'play':playing=true;state();break;
    case 'seek':epoch++;position=command.position;state({discontinuity:true});break;
    case 'stop':epoch++;position=0;playing=false;state({stopped:true});break;
    case 'spotify-disconnect':epoch++;playing=false;track=null;state({source:'local',name:null,uri:null});break;
    case 'fixture-end':playing=false;state({ended:true});break;
    case 'shutdown':process.exit(0);
  }
});
send({type:'ready'});
setInterval(()=>{
  if(!playing)return;
  const start=position;position+=576/44100;
  const pcm=Array.from({length:1152},(_,i)=>Math.sin((start+(i%576)/44100)*Math.PI*440)*.2);
  send({type:'audio',epoch,source:'spotify',playing,position,duration:track.duration,frame:{time:start,sampleRate:44100,samples:576,pcm}});
},13);
