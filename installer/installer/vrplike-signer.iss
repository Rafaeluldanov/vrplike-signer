; vrplike Signer — Windows installer (Inno Setup 6)
;
; Goal:
; - Normal installed app UX (AnyDesk/Kaspersky style):
;   setup.exe → Next→Next→Finish → tray icon appears → deeplink works
;
; Build inputs (prepared by CI / Windows build machine):
; - installer\build\vrplike-signer.exe
; - installer\build\vrplike-signer-tray.exe
; - installer\build\tray.ico
;
; Build command:
; - iscc installer\vrplike-signer.iss /DAppVersion=0.1.0
;
; Output:
; - installer\dist\vrplike-signer-setup.exe

#ifndef AppVersion
#define AppVersion "0.1.0"
#endif

[Setup]
AppId={{7B8B3B8C-1C5D-4E8E-A8B5-4B2C97F3A0A2}
AppName=vrplike Signer
AppVersion={#AppVersion}
AppPublisher=vrplike

DefaultDirName={localappdata}\vrplike-signer
PrivilegesRequired=lowest
DisableProgramGroupPage=yes

WizardStyle=modern
OutputDir=dist
OutputBaseFilename=vrplike-signer-setup
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64

; Placeholder for future code signing (CI):
; SignTool=signtool
; SignedUninstaller=yes

[Files]
Source: "build\vrplike-signer.exe"; DestDir: "{app}"; DestName: "vrplike-signer.exe"; Flags: ignoreversion
Source: "build\vrplike-signer-tray.exe"; DestDir: "{app}"; DestName: "vrplike-signer-tray.exe"; Flags: ignoreversion
Source: "build\tray.ico"; DestDir: "{app}"; DestName: "tray.ico"; Flags: ignoreversion

[Registry]
; Autostart (per-user): start tray-host, it will start the agent when needed.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "vrplike-signer"; ValueData: """{app}\vrplike-signer-tray.exe"""; Flags: uninsdeletevalue

; Deeplink protocol handler (per-user, no admin): vrplike-signer://...
; IMPORTANT: use tray-host (WinExe) to avoid console flash.
Root: HKCU; Subkey: "Software\Classes\vrplike-signer"; ValueType: string; ValueName: ""; ValueData: "URL:vrplike Signer"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\vrplike-signer"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\vrplike-signer\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\tray.ico"
Root: HKCU; Subkey: "Software\Classes\vrplike-signer\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\vrplike-signer-tray.exe"" ""%1"""

[Run]
; After install: start tray-host (shows tray icon)
Filename: "{app}\vrplike-signer-tray.exe"; Description: "Запустить vrplike Signer"; Flags: postinstall nowait runhidden skipifsilent
; After install: start agent (background, no console)
Filename: "{app}\vrplike-signer.exe"; Parameters: "--installed"; Flags: postinstall nowait runhidden skipifsilent

