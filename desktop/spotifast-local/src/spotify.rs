//! Optional Spotify decoder. It is created without an account connection;
//! only a user-selected Spotify track supplies a session access token.
use std::sync::{Arc, Mutex, atomic::{AtomicU32, AtomicU64, Ordering}, mpsc::SyncSender};
use std::time::Duration;
use librespot_core::{authentication::Credentials, config::SessionConfig, session::Session, SpotifyUri};
use librespot_playback::{audio_backend::{Sink,SinkResult}, config::{Bitrate,PlayerConfig}, convert::Converter, decoder::AudioPacket, player::{Player,PlayerEvent}};
use serde_json::{Value,json};
use crate::{engine::Volume,sink::{AudioControl,RodioSink}};

const RATE:f64=44100.0;
const HOP:usize=576;

pub struct SpotifyPlayer {
    tx:tokio::sync::mpsc::Sender<Value>,
    control:Arc<AudioControl>,
}
impl SpotifyPlayer {
    pub fn new(current:Arc<AtomicU64>,volume:Arc<AtomicU32>,out:SyncSender<Value>,output:Arc<Mutex<RodioSink>>,control:Arc<AudioControl>)->Self {
        let (tx,mut rx)=tokio::sync::mpsc::channel::<Value>(16);
        std::thread::spawn(move || {
            let Ok(runtime)=tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build() else {return;};
            runtime.block_on(async move {
                let mut session:Option<Session>=None;let mut player:Option<Arc<Player>>=None;
                let mut last:Option<Value>=None;let mut is_playing=false;
                while let Some(mut command)=rx.recv().await {
                    match command["op"].as_str().unwrap_or("") {
                        "stop" => {
                            if let Some(old)=player.take(){old.stop();}last=None;is_playing=false;
                            if let Some(old)=session.take(){old.shutdown();}
                            continue;
                        }
                        "play" => {if let Some(p)=&player{p.play();is_playing=true;}continue;}
                        "pause" => {if let Some(p)=&player{p.pause();is_playing=false;}continue;}
                        "seek" => {
                            let Some(mut saved)=last.clone() else {continue;};
                            saved["position"]=command["position"].clone();saved["epoch"]=command["epoch"].clone();saved["play"]=json!(is_playing);command=saved;
                        }
                        "spotify-load" => {}
                        _ => continue,
                    }
                    let epoch=command["epoch"].as_u64().unwrap_or(0);
                    if current.load(Ordering::SeqCst)!=epoch {continue;}
                    let Some(uri)=command["track"]["uri"].as_str().and_then(|s| SpotifyUri::from_uri(s).ok()) else {continue;};
                    let Some(token)=command["accessToken"].as_str().filter(|s| !s.is_empty()) else {continue;};
                    let Some(client)=command["clientId"].as_str().filter(|s| s.len()==32&&s.bytes().all(|c|c.is_ascii_hexdigit())) else {continue;};
                    if let Some(old)=player.take(){old.stop();}
                    let start=command["position"].as_f64().filter(|x|x.is_finite()).unwrap_or(0.0).clamp(0.0,86400.0);
                    let track=command["track"].clone();
                    let _=out.try_send(track_state(&track,epoch,start,false,true));
                    if session.is_none() {
                        crate::spotify_diagnostics::reset();
                        let config=SessionConfig{client_id:client.to_owned(),autoplay:Some(false),..SessionConfig::default()};
                        let fresh=Session::new(config,None);
                        let connected=tokio::select! {
                            result=tokio::time::timeout(Duration::from_secs(25),fresh.connect(Credentials::with_access_token(token),false))=>Some(result),
                            _=async {while current.load(Ordering::SeqCst)==epoch {tokio::time::sleep(Duration::from_millis(50)).await;}}=>None,
                        };
                        match connected {
                            Some(Ok(Ok(())))=>session=Some(fresh),
                            None=>{fresh.shutdown();continue;},
                            _=>{fresh.shutdown();if current.load(Ordering::SeqCst)==epoch{let _=out.try_send(json!({"type":"error","epoch":epoch,"message":"Spotify playback could not connect. Reconnect Spotify and check your Premium subscription."}));}continue;}
                        }
                    }
                    if current.load(Ordering::SeqCst)!=epoch {continue;}
                    let sink_current=current.clone();let sink_output=output.clone();let sink_out=out.clone();let sink_track=track.clone();
                    let config=PlayerConfig{bitrate:Bitrate::Bitrate320,normalisation:false,..PlayerConfig::default()};
                    let next=Player::new(config,session.as_ref().unwrap().clone(),Box::new(Volume(volume.clone())),move || {
                        Box::new(SpotifyTap::new(sink_output,sink_current,sink_out,sink_track,epoch,start))
                    });
                    let mut events=next.get_player_event_channel();
                    let event_out=out.clone();let event_current=current.clone();let event_track=track.clone();
                    tokio::spawn(async move {
                        while let Some(event)=events.recv().await {
                            if event_current.load(Ordering::SeqCst)!=epoch {break;}
                            match event {
                                PlayerEvent::Playing{position_ms,..}=>{let _=event_out.try_send(track_state(&event_track,epoch,position_ms as f64/1000.0,true,false));}
                                PlayerEvent::Paused{position_ms,..}=>{let _=event_out.try_send(track_state(&event_track,epoch,position_ms as f64/1000.0,false,false));}
                                PlayerEvent::Unavailable{..}=>{let _=event_out.try_send(json!({"type":"error","epoch":epoch,"message":crate::spotify_diagnostics::unavailable_message()}));}
                                PlayerEvent::EndOfTrack{..}=>{
                                    tokio::time::sleep(Duration::from_millis(350)).await;
                                    if event_current.load(Ordering::SeqCst)==epoch {let mut state=track_state(&event_track,epoch,event_track["duration"].as_f64().unwrap_or(0.0),false,false);state["ended"]=json!(true);let _=event_out.try_send(state);}
                                }
                                _=>{}
                            }
                        }
                    });
                    is_playing=command["play"].as_bool().unwrap_or(true);
                    next.load(uri,is_playing,(start*1000.0) as u32);last=Some(command);player=Some(next);
                }
                if let Some(p)=player {p.stop();}if let Some(s)=session{s.shutdown();}
            });
        });
        Self{tx,control}
    }
    pub fn send(&self,value:Value)->bool {self.tx.try_send(value).is_ok()}
    pub fn interrupt(&self){self.control.interrupt();self.control.track_changed();}
    pub fn stop(&self){let _=self.send(json!({"op":"stop"}));}
}

pub(crate) fn track_state(track:&Value,epoch:u64,position:f64,playing:bool,loading:bool)->Value {
    let title=track["title"].as_str().unwrap_or("Spotify track");let artist=track["artist"].as_str().unwrap_or("");
    json!({"type":"state","source":"spotify","epoch":epoch,"position":position,"duration":track["duration"],"playing":playing,"loading":loading,"stopped":false,"name":if artist.is_empty(){title.to_owned()}else{format!("{artist} — {title}")},"title":title,"artist":artist,"album":track["album"],"cover":track["cover"],"url":track["url"],"uri":track["uri"],"discontinuity":true})
}

struct SpotifyTap {
    inner:Arc<Mutex<RodioSink>>,current:Arc<AtomicU64>,out:SyncSender<Value>,track:Value,epoch:u64,
    pending:Vec<f32>,submitted:f64,emitted:f64,position:f64,gap:bool,
}
impl SpotifyTap {
    fn new(inner:Arc<Mutex<RodioSink>>,current:Arc<AtomicU64>,out:SyncSender<Value>,track:Value,epoch:u64,start:f64)->Self {
        Self{inner,current,out,track,epoch,pending:Vec::new(),submitted:start*RATE,emitted:start*RATE,position:start,gap:true}
    }
    fn active(&self)->bool{self.current.load(Ordering::SeqCst)==self.epoch}
}
impl Sink for SpotifyTap {
    fn start(&mut self)->SinkResult<()>{let mut inner=self.inner.lock().unwrap_or_else(|p|p.into_inner());if self.active(){inner.start()}else{Ok(())}}
    fn stop(&mut self)->SinkResult<()>{self.pending.clear();let mut inner=self.inner.lock().unwrap_or_else(|p|p.into_inner());if self.active(){inner.stop()}else{Ok(())}}
    fn write(&mut self,packet:AudioPacket,converter:&mut Converter)->SinkResult<()> {
        if !self.active(){return Ok(());}
        let samples=packet.samples().map(|s|s.iter().map(|v|if v.is_finite(){v.clamp(-1.0,1.0) as f32}else{0.0}).collect::<Vec<_>>()).unwrap_or_default();
        let queued={let mut inner=self.inner.lock().unwrap_or_else(|p|p.into_inner());if !self.active(){return Ok(());}inner.write(packet,converter)?;inner.queued_seconds()};
        if !self.active(){return Ok(());}
        self.submitted+=samples.len() as f64/2.0;self.pending.extend(samples);
        self.position=(self.submitted/RATE-queued-0.1).max(self.position);
        while self.pending.len()>=HOP*2 {
            let interleaved:Vec<f32>=self.pending.drain(..HOP*2).collect();
            let pcm=crate::engine::planar(&interleaved);let time=self.emitted/RATE;self.emitted+=HOP as f64;
            self.gap=self.out.try_send(json!({"type":"audio","source":"spotify","epoch":self.epoch,"playing":true,"loading":false,"position":self.position,"duration":self.track["duration"],"discontinuity":self.gap,"frame":{"time":time,"sampleRate":44100,"samples":HOP,"pcm":pcm}})).is_err();
        }
        Ok(())
    }
}

#[cfg(test)] mod tests {
    use super::*;
    #[test]fn spotify_track_state_keeps_metadata_and_source(){let s=track_state(&json!({"title":"Track","artist":"Artist","duration":180,"uri":"spotify:track:123"}),7,12.5,true,false);assert_eq!(s["name"],"Artist — Track");assert_eq!(s["epoch"],7);assert_eq!(s["source"],"spotify");assert_eq!(s["position"],12.5);}
    #[test]fn epoch_gates_discard_previous_sources(){let current=Arc::new(AtomicU64::new(8));let (out,_)=std::sync::mpsc::sync_channel(2);let inner=Arc::new(Mutex::new(RodioSink::new(None,Arc::new(|_|{}),Box::new(Volume(Arc::new(AtomicU32::new(0f32.to_bits())))),100,AudioControl::new(100))));let tap=SpotifyTap::new(inner,current.clone(),out,json!({}),8,0.0);assert!(tap.active());current.store(9,Ordering::SeqCst);assert!(!tap.active());}
}
