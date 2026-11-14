//! Bounded local-file decoding. Opening a long mix reads its headers and the
//! next packet, rather than decoding the entire track before playback starts.
use std::{collections::VecDeque,fs::File,io,path::Path};
use symphonia::core::{audio::{SampleBuffer,SignalSpec},codecs::{Decoder,DecoderOptions},formats::{FormatOptions,FormatReader,SeekMode,SeekTo},io::MediaSourceStream,meta::MetadataOptions,probe::Hint,units::{Time,TimeBase}};
use crate::resample::Resampler;
const RATE:u32=44100;
const HOP:usize=576;

pub struct AudioFile {
    pub name:String,pub duration:f64,
    format:Box<dyn FormatReader>,decoder:Box<dyn Decoder>,track:u32,time_base:Option<TimeBase>,
    conversion:Option<Resampler>,spec:Option<SignalSpec>,pending:VecDeque<f32>,eof:bool,seek_target:Option<f64>,
}
impl AudioFile {
    pub fn open(path:&Path)->Result<Self,String>{
        let file=File::open(path).map_err(|_|"Cannot open that audio file")?;
        let mut hint=Hint::new();if let Some(ext)=path.extension().and_then(|x|x.to_str()){hint.with_extension(ext);}
        let probed=symphonia::default::get_probe().format(&hint,MediaSourceStream::new(Box::new(file),Default::default()),&FormatOptions::default(),&MetadataOptions::default()).map_err(|_|"Unsupported or unreadable audio file")?;
        let format=probed.format;let track=format.default_track().ok_or("No audio track")?;
        let decoder=symphonia::default::get_codecs().make(&track.codec_params,&DecoderOptions::default()).map_err(|_|"Unsupported audio codec")?;
        let time_base=track.codec_params.time_base.or_else(||track.codec_params.sample_rate.map(|r|TimeBase::new(1,r)));
        let duration=track.codec_params.n_frames.and_then(|n|time_base.map(|base|seconds(base.calc_time(n)))).unwrap_or(0.0);
        Ok(Self{name:path.file_name().unwrap_or_default().to_string_lossy().into_owned(),duration,track:track.id,time_base,format,decoder,conversion:None,spec:None,pending:VecDeque::new(),eof:false,seek_target:None})
    }
    pub fn seek(&mut self,position:f64)->Result<f64,String>{
        let position=if self.duration>0.0{position.clamp(0.0,self.duration)}else{position.max(0.0)};
        if self.duration>0.0&&position>=self.duration{self.pending.clear();self.eof=true;return Ok(position);}
        self.format.seek(SeekMode::Accurate,SeekTo::Time{time:Time::new(position.floor() as u64,position.fract()),track_id:Some(self.track)}).map_err(|_|"This audio file could not seek to that position")?;
        self.decoder.reset();self.pending.clear();self.conversion=None;self.spec=None;self.eof=false;self.seek_target=Some(position);Ok(position)
    }
    pub fn next_hop(&mut self)->Result<Vec<f32>,String>{
        let mut damaged=0;
        while self.pending.len()<HOP*2&&!self.eof{
            let packet=match self.format.next_packet(){
                Ok(p)=>p,
                Err(symphonia::core::errors::Error::IoError(e))if e.kind()==io::ErrorKind::UnexpectedEof=>{self.eof=true;break;},
                Err(_)=>return Err("Audio file ended with a decoding error".into()),
            };
            if packet.track_id()!=self.track{continue;}
            let packet_time=self.time_base.map(|base|seconds(base.calc_time(packet.ts())));
            let decoded=match self.decoder.decode(&packet){
                Ok(decoded)=>decoded,
                // MP3 reservoir preroll after a seek can legitimately need a
                // few packets. Bound recovery so damaged files cannot spin.
                Err(symphonia::core::errors::Error::DecodeError(_))if damaged<64=>{damaged+=1;continue;},
                Err(_)=>return Err("Audio decoder rejected a packet".into()),
            };
            let spec=*decoded.spec();let channels=spec.channels.count();
            if !(channels==1||channels==2)||!(8000..=192000).contains(&spec.rate){return Err("Prototype supports mono/stereo audio at 8–192 kHz".into());}
            if self.spec!=Some(spec){self.spec=Some(spec);self.conversion=Resampler::new(spec.rate,RATE,2);}
            let mut buffer=SampleBuffer::<f32>::new(decoded.capacity() as u64,spec);buffer.copy_interleaved_ref(decoded);
            let skip=match(self.seek_target,packet_time){(Some(target),Some(start))=>((target-start).max(0.0)*spec.rate as f64).round() as usize,_=>0};
            let samples=buffer.samples();let skip=skip.min(samples.len()/channels)*channels;
            if skip==samples.len(){continue;}
            self.seek_target=None;
            let stereo:Vec<f32>=if channels==1{samples[skip..].iter().flat_map(|v|[*v,*v]).collect()}else{samples[skip..].to_vec()};
            let stereo=if let Some(converter)=self.conversion.as_mut(){converter.process(&stereo)}else{stereo};
            self.pending.extend(stereo.into_iter().map(|v|if v.is_finite(){v.clamp(-1.0,1.0)}else{0.0}));
        }
        Ok(self.pending.drain(..(HOP*2).min(self.pending.len())).collect())
    }
}
fn seconds(time:Time)->f64{time.seconds as f64+time.frac}

#[cfg(test)]mod tests{use super::*;
    #[test]fn missing_file_returns_a_readable_error(){assert!(AudioFile::open(Path::new("__no_such_aaavs_audio.wav")).is_err());}
    #[test]fn long_files_decode_a_bounded_window_and_seek_past_ten_minutes(){
        use std::io::Write;
        let path=std::env::temp_dir().join(format!("aaavs-stream-{}-{}.wav",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let rate=8000u32;let data=rate*660*2;let mut header=Vec::new();
        header.extend(b"RIFF");header.extend((data+36).to_le_bytes());header.extend(b"WAVEfmt ");header.extend(16u32.to_le_bytes());header.extend(1u16.to_le_bytes());header.extend(1u16.to_le_bytes());header.extend(rate.to_le_bytes());header.extend((rate*2).to_le_bytes());header.extend(2u16.to_le_bytes());header.extend(16u16.to_le_bytes());header.extend(b"data");header.extend(data.to_le_bytes());
        let mut fixture=File::create(&path).unwrap();fixture.write_all(&header).unwrap();fixture.set_len(u64::from(data)+44).unwrap();drop(fixture);
        let mut audio=AudioFile::open(&path).unwrap();assert!((audio.duration-660.0).abs()<0.01);
        assert_eq!(audio.next_hop().unwrap().len(),HOP*2);assert!(audio.pending.len()<RATE as usize*2,"only a small decoded window is retained");
        assert_eq!(audio.seek(650.0).unwrap(),650.0);assert_eq!(audio.next_hop().unwrap().len(),HOP*2);
        audio.seek(0.0).unwrap();assert_eq!(audio.next_hop().unwrap().len(),HOP*2);
        drop(audio);std::fs::remove_file(path).unwrap();
    }
}
