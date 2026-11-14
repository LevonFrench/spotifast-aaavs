//! Reduce two known librespot 0.8 audio-key errors to fixed reason codes.
//! No formatted provider logs, credentials, track identifiers or keys are read
//! or retained. All other upstream logs are discarded.
use std::sync::atomic::{AtomicU8,Ordering};

static DIAGNOSTICS:KeyDiagnostics=KeyDiagnostics(AtomicU8::new(0));
struct KeyDiagnostics(AtomicU8);

impl log::Log for KeyDiagnostics {
    fn enabled(&self,metadata:&log::Metadata)->bool {
        metadata.target()=="librespot_core::audio_key"&&metadata.level()==log::Level::Error
    }
    fn log(&self,record:&log::Record){
        if !self.enabled(record.metadata()){return;}
        // In pinned librespot 0.8 this target has exactly two error sites:
        // a constant timeout and a formatted server refusal. Never format
        // the latter: the two returned bytes and every other field stay private.
        let code=if record.args().as_str()==Some("Audio key response timeout"){1}else{2};
        self.0.store(code,Ordering::Relaxed);
    }
    fn flush(&self){}
}

pub fn install(){if log::set_logger(&DIAGNOSTICS).is_ok(){log::set_max_level(log::LevelFilter::Error);}}
pub fn reset(){DIAGNOSTICS.0.store(0,Ordering::Relaxed);}
pub fn unavailable_message()->&'static str {message(DIAGNOSTICS.0.load(Ordering::Relaxed))}
fn message(code:u8)->&'static str {
    match code {
        1=>"Spotify's audio-key request timed out. Check the network and try the track again. Library browsing uses a separate connection.",
        2=>"Spotify refused an audio-key request from this playback engine. Library browsing still works, but this engine could not play the track. Reconnecting may not resolve this restriction.",
        _=>"Spotify connected, but its decoder could not load this track. Try another song. If every song fails, playback compatibility needs diagnosis; the library connection alone does not confirm playback.",
    }
}

#[cfg(test)]mod tests{
    use super::*;use log::Log;
    #[test]fn fixed_codes_distinguish_key_timeout_and_refusal_without_formatting_logs(){
        let diagnostics=KeyDiagnostics(AtomicU8::new(0));
        diagnostics.log(&log::Record::builder().target("unrelated").level(log::Level::Error).args(format_args!("ignored")).build());
        assert_eq!(diagnostics.0.load(Ordering::Relaxed),0);
        diagnostics.log(&log::Record::builder().target("librespot_core::audio_key").level(log::Level::Error).args(format_args!("Audio key response timeout")).build());
        assert_eq!(diagnostics.0.load(Ordering::Relaxed),1);assert!(message(1).contains("timed out"));
        struct NeverFormat;impl std::fmt::Display for NeverFormat{fn fmt(&self,_:&mut std::fmt::Formatter<'_>)->std::fmt::Result{panic!("provider fields must never be formatted");}}
        diagnostics.log(&log::Record::builder().target("librespot_core::audio_key").level(log::Level::Error).args(format_args!("error audio key {}",NeverFormat)).build());
        assert_eq!(diagnostics.0.load(Ordering::Relaxed),2);assert!(message(2).contains("refused"));
        assert!(!message(0).contains("incompatible"));
    }
}
