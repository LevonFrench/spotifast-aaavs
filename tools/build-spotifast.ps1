param([switch]$Test,[switch]$NativeOnly,[switch]$SkipPlayerBuild,[string]$OutputDirectory)
# Builds the Windows app: the native host, the sidecar scripts and a frozen renderer.
# AAAVS is a separate project (AAAVS_ROOT, default: the sibling folder ..\aaavs).
$ErrorActionPreference='Stop'
$appRoot=Split-Path -Parent $PSScriptRoot
$aaavsRoot=if($env:AAAVS_ROOT){[IO.Path]::GetFullPath($env:AAAVS_ROOT)}else{[IO.Path]::GetFullPath((Join-Path $appRoot '..\aaavs'))}
$localRoot=if($env:SPOTIFAST_LOCAL){[IO.Path]::GetFullPath($env:SPOTIFAST_LOCAL)}else{Join-Path $appRoot '.local\spotifast-prototype'}
$env:RUSTUP_HOME=Join-Path $localRoot 'toolchain\rustup'
$env:CARGO_HOME=Join-Path $localRoot 'toolchain\cargo'
$env:CARGO_TARGET_DIR=Join-Path $localRoot 'target'
$cargo=Join-Path $env:CARGO_HOME 'bin\cargo.exe'
if(-not(Test-Path -LiteralPath $cargo)){throw "Project-local Rust is missing: $cargo. See $appRoot\docs\SPOTIFAST-LOCAL-PROTOTYPE.md"}
$env:Path="$(Join-Path $env:CARGO_HOME 'bin');$env:Path"
$vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$installation=& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if(-not $installation){throw 'Visual Studio C++ build tools were not found.'}
$vcvars=Join-Path $installation 'VC\Auxiliary\Build\vcvars64.bat'
$verb=if($Test){'test'}else{'build'}
$batch=Join-Path $localRoot 'native-build.cmd'
@"
@echo off
call "$vcvars" >nul
if errorlevel 1 exit /b %errorlevel%
"$cargo" $verb --locked --offline --manifest-path "$appRoot\desktop\spotifast-local\Cargo.toml"
"@ | Set-Content -LiteralPath $batch -Encoding ascii
& $batch
if($LASTEXITCODE -ne 0){throw "Native $verb failed ($LASTEXITCODE)."}
if($Test){exit 0}
if($NativeOnly){Write-Output "Native host: $(Join-Path $env:CARGO_TARGET_DIR 'debug\spotifast-aaavs.exe')";exit 0}
if(-not(Test-Path -LiteralPath (Join-Path $aaavsRoot 'standalone.html'))){throw "AAAVS was not found at $aaavsRoot. Set AAAVS_ROOT."}
$output=if($OutputDirectory){[IO.Path]::GetFullPath($OutputDirectory)}else{Join-Path $localRoot 'app'}
New-Item -ItemType Directory -Path $output -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $env:CARGO_TARGET_DIR 'debug\spotifast-aaavs.exe') -Destination (Join-Path $output 'SpotifastAAAVS.exe')
Copy-Item -LiteralPath (Get-Command node.exe).Source -Destination (Join-Path $output 'node.exe')
# The sidecar ships with the app; the host starts server\spotifast-server.mjs.
$server=Join-Path $output 'server'
New-Item -ItemType Directory -Path $server -Force | Out-Null
foreach($name in 'spotifast-server.mjs','spotifast-spotify.mjs','project-paths.mjs'){Copy-Item -LiteralPath (Join-Path $appRoot "tools\$name") -Destination (Join-Path $server $name)}
# Freeze the renderer so another AAAVS development build cannot replace chunks
# underneath the running app. Presets and all ratings stay in AAAVS.
$renderer=Join-Path $output ('renderer-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff'))
$rendererArgs=@((Join-Path $appRoot 'tools\build-renderer.mjs'),'--out',$renderer)
if($SkipPlayerBuild){$rendererArgs+='--skip-player-build'}
$env:AAAVS_ROOT=$aaavsRoot
& node @rendererArgs
if($LASTEXITCODE -ne 0){throw 'Renderer build failed'}
Set-Content -LiteralPath (Join-Path $output 'renderer-path.txt') -Value $renderer -Encoding utf8
Set-Content -LiteralPath (Join-Path $output 'aaavs-root.txt') -Value $aaavsRoot -Encoding utf8
Copy-Item -LiteralPath (Join-Path $appRoot 'desktop\spotifast-local\vendor\spotifast\LICENSE') -Destination (Join-Path $output 'SPOTIFAST-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $appRoot 'docs\SPOTIFAST-SPOTIFY.md') -Destination (Join-Path $output 'README.md')
Write-Output "Windows app: $output\SpotifastAAAVS.exe"
Write-Output "Shared preset library: $aaavsRoot\avs presets"
