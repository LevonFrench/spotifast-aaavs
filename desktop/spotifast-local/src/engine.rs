use std::{io::{self, BufRead, BufReader, Write}, path::Path, sync::{Arc, Mutex, atomic::{AtomicU32, AtomicU64, Ordering}, mpsc}, time::Duration};
use librespot_playback::{audio_backend::Sink, convert::Converter, decoder::AudioPacket, mixer::VolumeGetter};
use serde_json::{Value, json};
use crate::{local_audio::AudioFile, sink::{AudioControl, RodioSink}};

const RATE: u32 = 44100;
const HOP: usize = 576;

pub(crate) struct Volume(pub Arc<AtomicU32>);
impl VolumeGetter for Volume { fn attenuation_factor(&self) -> f64 { f32::from_bits(self.0.load(Ordering::Relaxed)) as f64 } }

pub(crate) fn planar(samples: &[f32]) -> Vec<f32> {
    let mut pcm = vec![0.0; HOP*2];
    for (i, frame) in samples.chunks_exact(2).take(HOP).enumerate() { pcm[i]=frame[0];pcm[HOP+i]=frame[1]; }
    pcm
}

pub fn run() {
    crate::spotify_diagnostics::install();
    let (commands, rx) = mpsc::sync_channel::<Value>(32);
    std::thread::spawn(move || {
        for line in BufReader::new(io::stdin()).lines() {
            let Ok(line) = line else { break; }; if line.len()>65536 { continue; }
            if let Ok(value) = serde_json::from_str(&line) { if commands.send(value).is_err() { return; } }
        }
        let _ = commands.send(json!({"op":"shutdown"}));
    });
    let (out, messages) = mpsc::sync_channel::<Value>(32);
    std::thread::spawn(move || {
        let stdout=io::stdout(); let mut writer=stdout.lock();
        while let Ok(value)=messages.recv() { if serde_json::to_writer(&mut writer,&value).is_err() || writer.write_all(b"\n").is_err() || writer.flush().is_err() { break; } }
    });
    let control = AudioControl::new(100); let volume = Arc::new(AtomicU32::new(0.6f32.to_bits()));
    let on_error = { let out=out.clone(); Arc::new(move |e:String| { let _=out.try_send(json!({"type":"error","message":e})); }) };
    let sink=Arc::new(Mutex::new(RodioSink::new(None,on_error,Box::new(Volume(volume.clone())),100,control.clone())));
    let mut converter=Converter::new(None);
    let mut audio: Option<AudioFile>=None; let mut index=0usize; let mut epoch=0u64; let mut playing=false;
    let mut gap=true; let mut position=0.0f64;
    let current_epoch=Arc::new(AtomicU64::new(0));
    let spotify=crate::spotify::SpotifyPlayer::new(current_epoch.clone(),volume.clone(),out.clone(),sink.clone(),control.clone());
    let mut spotify_active=false;
    let mut spotify_track=Value::Null;
    let _=out.send(json!({"type":"ready","engine":"Spotifast output","sampleRate":RATE}));
    loop {
        let command = if playing { rx.try_recv().ok() } else { rx.recv_timeout(Duration::from_millis(100)).ok() };
        if let Some(command)=command {
            let operation=command["op"].as_str().unwrap_or("").to_owned();
            if operation=="spotify-load" {
                current_epoch.fetch_add(1,Ordering::SeqCst);epoch=current_epoch.load(Ordering::SeqCst);
                control.interrupt();control.track_changed();let _=sink.lock().unwrap_or_else(|p|p.into_inner()).stop();playing=false;audio=None;spotify_active=true;
                spotify_track=command["track"].clone();let _=out.send(crate::spotify::track_state(&spotify_track,epoch,0.0,false,true));
                let mut next=command;next["epoch"]=json!(epoch);
                if !spotify.send(next){let _=out.try_send(json!({"type":"error","epoch":epoch,"message":"Spotify playback is busy. Try again."}));}
                continue;
            }
            if operation=="spotify-disconnect" {
                current_epoch.fetch_add(1,Ordering::SeqCst);epoch=current_epoch.load(Ordering::SeqCst);spotify.interrupt();let _=sink.lock().unwrap_or_else(|p|p.into_inner()).stop();spotify.stop();spotify_active=false;playing=false;audio=None;
                let _=out.send(json!({"type":"state","source":"local","epoch":epoch,"playing":false,"position":0,"duration":0,"name":null,"title":null,"artist":null,"album":null,"cover":null,"url":null,"uri":null,"loading":false,"discontinuity":true}));continue;
            }
            if spotify_active&&operation=="stop" {
                current_epoch.fetch_add(1,Ordering::SeqCst);epoch=current_epoch.load(Ordering::SeqCst);spotify.interrupt();let _=sink.lock().unwrap_or_else(|p|p.into_inner()).stop();spotify.stop();
                let mut state=crate::spotify::track_state(&spotify_track,epoch,0.0,false,false);state["stopped"]=json!(true);let _=out.send(state);continue;
            }
            if spotify_active&&["play","pause","seek"].contains(&operation.as_str()) {
                let mut next=command;
                if operation=="seek"{current_epoch.fetch_add(1,Ordering::SeqCst);epoch=current_epoch.load(Ordering::SeqCst);spotify.interrupt();next["epoch"]=json!(epoch);let _=out.send(crate::spotify::track_state(&spotify_track,epoch,next["position"].as_f64().unwrap_or(0.0),false,true));}
                let _=spotify.send(next);continue;
            }
            match command["op"].as_str().unwrap_or("") {
                "shutdown" => {current_epoch.fetch_add(1,Ordering::SeqCst);spotify.stop();let _=sink.lock().unwrap_or_else(|p|p.into_inner()).stop(); break; }
                "load" => {
                    current_epoch.fetch_add(1,Ordering::SeqCst);epoch=current_epoch.load(Ordering::SeqCst);spotify.stop();spotify_active=false;
                    control.interrupt(); control.track_changed(); let _=sink.lock().unwrap_or_else(|p|p.into_inner()).stop();
                    playing=false;index=0;position=0.0;gap=true;audio=None;
                    let _=out.send(json!({"type":"state","source":"local","epoch":epoch,"playing":false,"position":0,"duration":0,"name":null,"title":null,"artist":null,"album":null,"cover":null,"url":null,"uri":null,"stopped":false,"loading":true,"discontinuity":true}));
                    let path=command["path"].as_str().unwrap_or("");
                    match AudioFile::open(Path::new(path)) {
                        Ok(file) => {
                            audio=Some(file);playing=command["play"].as_bool().unwrap_or(true);
                            if playing { let _=sink.lock().unwrap_or_else(|p|p.into_inner()).start(); }
                        }
                        Err(error) => { let _=out.send(json!({"type":"error","message":error})); }
                    }
                }
                "play" => {
                    playing=audio.is_some();gap=true;
                    // A write resumes the device, but rodio's queue stays paused
                    // until start(). Keep the local transport on the same sink
                    // lifecycle that librespot uses for Spotify.
                    if playing { let _=sink.lock().unwrap_or_else(|p|p.into_inner()).start(); }
                }
                "pause" => { let _=sink.lock().unwrap_or_else(|p|p.into_inner()).stop();playing=false;position=index as f64/(RATE as f64*2.0);gap=true; }
                "stop" => {
                    current_epoch.fetch_add(1,Ordering::SeqCst);epoch=current_epoch.load(Ordering::SeqCst);control.interrupt();control.track_changed();let _=sink.lock().unwrap_or_else(|p|p.into_inner()).stop();playing=false;position=0.0;index=0;gap=true;
                    if let Some(file)=audio.as_mut(){if let Err(message)=file.seek(0.0){let _=out.send(json!({"type":"error","epoch":epoch,"message":message}));}}
                }
                "seek" => {
                    if let Some(file)=audio.as_mut() {
                        if let Some(seconds)=command["position"].as_f64().filter(|x| x.is_finite()) {
                            control.interrupt();control.track_changed();let _=sink.lock().unwrap_or_else(|p|p.into_inner()).stop();
                            current_epoch.fetch_add(1,Ordering::SeqCst);epoch=current_epoch.load(Ordering::SeqCst);gap=true;
                            match file.seek(seconds.max(0.0)){
                                Ok(at)=>{index=(at*RATE as f64) as usize*2;position=at;}
                                Err(message)=>{playing=false;let _=out.send(json!({"type":"error","epoch":epoch,"message":message}));}
                            }
                            if playing { let _=sink.lock().unwrap_or_else(|p|p.into_inner()).start(); }
                        }
                    }
                }
                "volume" => { if let Some(v)=command["volume"].as_f64().filter(|x| x.is_finite()) {volume.store((v.clamp(0.0,1.0) as f32).to_bits(),Ordering::Relaxed);} }
                _ => {}
            }
            if spotify_active {continue;}
            let duration=audio.as_ref().map_or(0.0,|f|f.duration);
            let _=out.send(json!({"type":"state","epoch":epoch,"playing":playing,"position":position,"duration":duration,"name":audio.as_ref().map(|f| &f.name),"discontinuity":gap,"loading":false}));
        }
        if !playing { continue; }
        let Some(file)=audio.as_mut() else {playing=false;continue;};
        let samples=match file.next_hop(){
            Ok(samples)=>samples,
            Err(message)=>{let _=sink.lock().unwrap_or_else(|p|p.into_inner()).stop();playing=false;let _=out.send(json!({"type":"error","epoch":epoch,"message":message}));continue;},
        };
        if samples.is_empty() {
            let _=sink.lock().unwrap_or_else(|p|p.into_inner()).stop();playing=false;position=index as f64/(RATE as f64*2.0);
            let _=out.send(json!({"type":"state","epoch":epoch,"playing":false,"ended":true,"position":position,"duration":position}));continue;
        }
        if sink.lock().unwrap_or_else(|p|p.into_inner()).write(AudioPacket::Samples(samples.iter().map(|v| *v as f64).collect()),&mut converter).is_err() {
            playing=false;let _=out.send(json!({"type":"state","epoch":epoch,"playing":false,"position":position,"discontinuity":true}));continue;
        }
        let start=index as f64/(RATE as f64*2.0);index+=samples.len();
        position=(index as f64/(RATE as f64*2.0)-sink.lock().unwrap_or_else(|p|p.into_inner()).queued_seconds()-0.1).max(position).max(0.0);
        let frame=json!({"type":"audio","epoch":epoch,"playing":true,"position":position,"duration":file.duration,"frame":{"time":start,"sampleRate":RATE,"samples":samples.len()/2,"pcm":planar(&samples)},"discontinuity":gap});
        gap=out.try_send(frame).is_err();
    }
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn stereo_hops_are_planar_and_partial_tails_are_zero_filled() { let p=planar(&[0.2,-0.4,0.3,-0.5]);assert_eq!(&p[..3],&[0.2,0.3,0.0]);assert_eq!(&p[576..579],&[-0.4,-0.5,0.0]); }
}
