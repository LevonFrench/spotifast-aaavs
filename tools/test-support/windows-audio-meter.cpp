// Read-only Windows output meter, filtered to the test engine's process ID.
// It neither captures audio nor changes any session or endpoint controls.
#include <windows.h>
#include <mmdeviceapi.h>
#include <audiopolicy.h>
#include <endpointvolume.h>
#include <cstdio>
#include <cstdlib>
int main(int argc,char**argv){
 if(argc<2)return 2;DWORD target=std::strtoul(argv[1],nullptr,10);
 CoInitializeEx(nullptr,COINIT_MULTITHREADED);IMMDeviceEnumerator*en=nullptr;
 if(FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator),nullptr,CLSCTX_ALL,IID_PPV_ARGS(&en))))return 3;
 float maximum=0,volume=-1,master=-1;BOOL muted=FALSE,masterMuted=FALSE;bool found=false;
 for(int round=0;round<15;round++){
  IMMDeviceCollection*devices=nullptr;en->EnumAudioEndpoints(eRender,DEVICE_STATE_ACTIVE,&devices);UINT count=0;devices->GetCount(&count);
  for(UINT d=0;d<count;d++){
   IMMDevice*device=nullptr;devices->Item(d,&device);IAudioSessionManager2*manager=nullptr;
   if(SUCCEEDED(device->Activate(__uuidof(IAudioSessionManager2),CLSCTX_ALL,nullptr,(void**)&manager))){
    IAudioSessionEnumerator*sessions=nullptr;manager->GetSessionEnumerator(&sessions);int n=0;sessions->GetCount(&n);
    for(int i=0;i<n;i++){
     IAudioSessionControl*s=nullptr;sessions->GetSession(i,&s);IAudioSessionControl2*s2=nullptr;
     if(SUCCEEDED(s->QueryInterface(IID_PPV_ARGS(&s2)))){DWORD pid=0;s2->GetProcessId(&pid);
      if(pid==target){found=true;IAudioMeterInformation*m=nullptr;if(SUCCEEDED(s->QueryInterface(IID_PPV_ARGS(&m)))){float p=0;m->GetPeakValue(&p);if(p>maximum)maximum=p;m->Release();}
       ISimpleAudioVolume*v=nullptr;if(SUCCEEDED(s->QueryInterface(IID_PPV_ARGS(&v)))){v->GetMasterVolume(&volume);v->GetMute(&muted);v->Release();}
       IAudioEndpointVolume*e=nullptr;if(SUCCEEDED(device->Activate(__uuidof(IAudioEndpointVolume),CLSCTX_ALL,nullptr,(void**)&e))){e->GetMasterVolumeLevelScalar(&master);e->GetMute(&masterMuted);e->Release();}
      }s2->Release();}s->Release();
    }sessions->Release();manager->Release();
   }device->Release();
  }devices->Release();Sleep(40);
 }
 std::printf("{\"found\":%s,\"peak\":%.8f,\"sessionVolume\":%.4f,\"sessionMuted\":%s,\"endpointVolume\":%.4f,\"endpointMuted\":%s}\n",found?"true":"false",maximum,volume,muted?"true":"false",master,masterMuted?"true":"false");en->Release();CoUninitialize();
}
