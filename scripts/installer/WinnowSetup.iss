; Winnow Windows installer (Inno Setup 6+).
; Build from the repository root (requires Inno Setup on PATH):
;   iscc scripts\installer\WinnowSetup.iss
;
; The installer copies the app tree (excluding heavy folders), then runs
; scripts\setup.ps1 to install Node deps, build dist/, and rebuild node-pty.

#define MyAppName "Winnow"
#define MyAppVersion "1.0.0"
#define RepoRoot "..\.."

[Setup]
AppId={{E3B9C8A1-7F62-4D91-9A1C-2B8E4F6D0A51}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=Winnow
DefaultDirName={localappdata}\Programs\{#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#RepoRoot}\dist-installer
OutputBaseFilename=WinnowSetup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#RepoRoot}\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoRoot}\package-lock.json"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "{#RepoRoot}\tsconfig.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoRoot}\README.md"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "{#RepoRoot}\src\*"; DestDir: "{app}\src"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#RepoRoot}\tests\*"; DestDir: "{app}\tests"; Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist
Source: "{#RepoRoot}\scripts\*"; DestDir: "{app}\scripts"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#RepoRoot}\docs\*"; DestDir: "{app}\docs"; Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist
Source: "{#RepoRoot}\.env.example"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist

[Icons]
Name: "{autoprograms}\{#MyAppName}\Winnow UI"; Filename: "{app}\scripts\winnow-ui.cmd"; WorkingDir: "{app}"
Name: "{autoprograms}\{#MyAppName}\Winnow folder"; Filename: "{app}"

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\setup.ps1"""; WorkingDir: "{app}"; Flags: postinstall waituntilterminated
