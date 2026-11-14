param([string]$Engine)
$ErrorActionPreference='Stop'
$appRoot=Split-Path -Parent $PSScriptRoot
$localRoot=if($env:SPOTIFAST_LOCAL){[IO.Path]::GetFullPath($env:SPOTIFAST_LOCAL)}else{Join-Path $appRoot '.local\spotifast-prototype'}
$vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$installation=& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if(-not $installation){throw 'Visual Studio C++ build tools are required for the read-only Windows output meter.'}
$vcvars=Join-Path $installation 'VC\Auxiliary\Build\vcvars64.bat'
$batch=Join-Path $localRoot 'compile-audio-meter.cmd'
@"
@echo off
call "$vcvars" >nul
if errorlevel 1 exit /b %errorlevel%
cl /nologo /EHsc "$appRoot\tools\test-support\windows-audio-meter.cpp" /Fe:"$localRoot\audio-meter.exe" /Fo:"$localRoot\audio-meter.obj" ole32.lib
"@ | Set-Content -LiteralPath $batch -Encoding ascii
& $batch
if($LASTEXITCODE -ne 0){throw 'Windows output meter build failed.'}
if($Engine){$env:AAAVS_SPOTIFAST_ENGINE=[IO.Path]::GetFullPath($Engine)}
& node (Join-Path $appRoot 'tools\check-spotifast-output.mjs')
if($LASTEXITCODE -ne 0){throw 'Windows output meter test failed.'}
