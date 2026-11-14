#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod engine;
mod local_audio;
mod spotify_diagnostics;
mod spotify;
#[path = "../vendor/spotifast/resample.rs"]
mod resample;
#[path = "../vendor/spotifast/sink.rs"]
mod sink;

use std::{io::{BufRead, BufReader, Write}, path::PathBuf, process::{Child, Command, Stdio}};
use tao::{event::{Event, WindowEvent}, event_loop::{ControlFlow, EventLoopBuilder}, window::WindowBuilder};
use wry::WebViewBuilder;

enum UserEvent { Pick, Files(Vec<PathBuf>), Close }

struct Server(Child);
impl Server {
    fn stop(&mut self) {
        if let Some(input) = self.0.stdin.as_mut() { let _ = input.write_all(b"shutdown\n"); }
        for _ in 0..120 {
            if self.0.try_wait().ok().flatten().is_some() { return; }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        let _ = self.0.kill(); let _ = self.0.wait();
    }
}
impl Drop for Server { fn drop(&mut self) { self.stop(); } }

fn desktop() -> Result<(), Box<dyn std::error::Error>> {
    let exe = std::env::current_exe()?;
    let folder = exe.parent().ok_or("Missing application folder")?;
    let root = std::env::var_os("AAAVS_ROOT").map(PathBuf::from)
        .or_else(|| std::fs::read_to_string(folder.join("aaavs-root.txt")).ok().map(|s| PathBuf::from(s.trim())))
        .ok_or("AAAVS_ROOT or aaavs-root.txt must point to the current AAAVS installation")?;
    let node = folder.join("node.exe");
    let mut command = Command::new(if node.exists() { node } else { PathBuf::from("node.exe") });
    // The sidecar ships beside the executable; AAAVS itself stays where aaavs-root.txt points.
    let sidecar = std::env::var_os("SPOTIFAST_SERVER").map(PathBuf::from)
        .unwrap_or_else(|| folder.join("server").join("spotifast-server.mjs"));
    if !sidecar.exists() { return Err(format!("The Spotifast server script is missing: {}", sidecar.display()).into()); }
    command.arg(&sidecar).arg("--root").arg(&root).env("AAAVS_ROOT", &root)
        .arg("--engine").arg(&exe).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit());
    if let Ok(path) = std::fs::read_to_string(folder.join("renderer-path.txt")) {
        command.arg("--renderer").arg(path.trim());
    }
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    let mut server = Server(command.spawn()?);
    let stdout = server.0.stdout.take().ok_or("Missing server pipe")?;
    let mut reader = BufReader::new(stdout);
    let mut ready = String::new(); reader.read_line(&mut ready)?;
    let value: serde_json::Value = serde_json::from_str(&ready)?;
    let url = value["url"].as_str().ok_or("AAAVS server did not start")?.to_owned();
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let window = WindowBuilder::new().with_title("Spotifast + AAAVS Player")
        .with_inner_size(tao::dpi::LogicalSize::new(1280.0, 800.0))
        .with_min_inner_size(tao::dpi::LogicalSize::new(700.0, 480.0)).build(&event_loop)?;
    let proxy = event_loop.create_proxy();
    let origin = url.split('#').next().unwrap_or(&url).to_owned();
    let nav_origin = origin.clone();
    let mut web_context = wry::WebContext::new(Some(folder.join("webview-data")));
    let _webview = WebViewBuilder::new_with_web_context(&mut web_context).with_url(&url)
        .with_navigation_handler(move |target| target.starts_with(&nav_origin))
        .with_new_window_req_handler(|_, _| wry::NewWindowResponse::Deny)
        .with_ipc_handler(move |request| { match request.body().as_str() {
            "pick-files" => { let _ = proxy.send_event(UserEvent::Pick); }
            "close-player" => { let _ = proxy.send_event(UserEvent::Close); }
            _ => {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(request.body()) {
                    if value["op"] == "open-spotify" {
                        if let Some(url) = value["url"].as_str().filter(|url| url.starts_with("https://accounts.spotify.com/authorize?") || *url == "https://developer.spotify.com/dashboard" || url.strip_prefix("https://open.spotify.com/track/").is_some_and(|id|id.len()==22&&id.bytes().all(|b|b.is_ascii_alphanumeric()))) {
                            let _ = open::that_detached(url);
                        }
                    }
                }
            }
        } })
        .build(&window)?;
    let picker_proxy = event_loop.create_proxy();
    event_loop.run(move |event, _, flow| {
        *flow = ControlFlow::Wait;
        match event {
            Event::UserEvent(UserEvent::Pick) => {
                let proxy = picker_proxy.clone();
                let dialog = rfd::FileDialog::new().set_parent(&window).set_title("Open local audio")
                    .add_filter("Audio", &["wav","mp3","flac","ogg","opus","m4a","aac"]);
                std::thread::spawn(move || {
                    if let Some(paths) = dialog.pick_files() {
                        let _ = proxy.send_event(UserEvent::Files(paths));
                    }
                });
            }
            Event::UserEvent(UserEvent::Files(paths)) => {
                if let Ok(json) = serde_json::to_string(&paths) {
                    let _ = _webview.evaluate_script(&format!("window.dispatchEvent(new CustomEvent('aaavs-files',{{detail:{json}}}))"));
                }
            }
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } | Event::UserEvent(UserEvent::Close) => { server.stop(); *flow = ControlFlow::Exit; }
            Event::LoopDestroyed => { if let Some(input) = server.0.stdin.as_mut() { let _ = input.write_all(b"shutdown\n"); } }
            _ => {}
        }
    });
}

fn main() {
    if std::env::args().any(|a| a == "--engine") { engine::run(); return; }
    if let Err(error) = desktop() {
        let _ = std::fs::write(std::env::current_exe().unwrap_or_default().with_file_name("startup-error.txt"), error.to_string());
        rfd::MessageDialog::new().set_title("Spotifast + AAAVS could not start")
            .set_description(error.to_string()).set_level(rfd::MessageLevel::Error).show();
    }
}
