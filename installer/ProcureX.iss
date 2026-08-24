#ifndef MyAppVersion
  #define MyAppVersion "0.3.0"
#endif

#define MyAppName "ProcureX"
#define MyAppPublisher "RE DECOR & MORE"
#define MyAppExeName "launcher\ProcureXLauncher.exe"

[Setup]
AppId={{9C638ABE-CDB3-44EA-8BA8-F32CA5327B5D}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\ProcureX
DefaultGroupName=ProcureX
DisableProgramGroupPage=yes
UninstallDisplayName=ProcureX
UninstallDisplayIcon={app}\launcher\assets\ProcureX.ico
OutputDir=output
OutputBaseFilename=ProcureXSetup
SetupIconFile=..\launcher\assets\ProcureX.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=commandline
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no
UsePreviousAppDir=yes
CreateUninstallRegKey=yes
Uninstallable=yes
VersionInfoVersion={#MyAppVersion}.0
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription=ProcureX Windows Installer
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}
MinVersion=10.0

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: checkedonce

[Files]
Source: "staging\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\ProcureX\ProcureX"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\launcher\assets\ProcureX.ico"; Comment: "Start ProcureX"
Name: "{autoprograms}\ProcureX\Stop ProcureX"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--stop"; WorkingDir: "{app}"; IconFilename: "{app}\launcher\assets\ProcureX.ico"; Comment: "Stop ProcureX services"
Name: "{autoprograms}\ProcureX\Backup ProcureX Data"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\tools\Backup-ProcureX.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\launcher\assets\ProcureX.ico"
Name: "{autoprograms}\ProcureX\Restore ProcureX Data"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\tools\Restore-ProcureX.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\launcher\assets\ProcureX.ico"
Name: "{autoprograms}\ProcureX\Troubleshooting Startup"; Filename: "{app}\start_app.bat"; WorkingDir: "{app}"; IconFilename: "{app}\launcher\assets\ProcureX.ico"
Name: "{autodesktop}\ProcureX"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\launcher\assets\ProcureX.ico"; Tasks: desktopicon; Comment: "Start ProcureX"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch ProcureX"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\{#MyAppExeName}"; Parameters: "--stop --no-dialog"; Flags: runhidden waituntilterminated skipifdoesntexist; RunOnceId: "StopProcureX"

[Code]
var
  DeleteBusinessData: Boolean;

function ProcureXDataDirectory(): String;
begin
  Result := ExpandConstant('{param:DATAROOT|}');
  if Result = '' then
    Result := AddBackslash(ExpandConstant('{localappdata}')) + 'ProcureX';
end;

procedure LogRuntimeDiagnostics();
var
  PythonPath: String;
  NodePath: String;
begin
  PythonPath := FileSearch('python.exe', GetEnv('PATH'));
  if PythonPath = '' then PythonPath := FileSearch('py.exe', GetEnv('PATH'));
  NodePath := FileSearch('node.exe', GetEnv('PATH'));
  if PythonPath = '' then
    Log('System Python: not found (the bundled ProcureX runtime will be used)')
  else
    Log('System Python: ' + PythonPath + ' (not required)');
  if NodePath = '' then
    Log('System Node.js: not found (the prebuilt frontend will be used)')
  else
    Log('System Node.js: ' + NodePath + ' (not required)');
end;

function InitializeSetup(): Boolean;
begin
  LogRuntimeDiagnostics();
  Result := True;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  ExistingLauncher: String;
  ExistingRuntime: String;
  DatabasePath: String;
begin
  Result := '';
  ExistingLauncher := ExpandConstant('{app}\launcher\ProcureXLauncher.exe');
  ExistingRuntime := ExpandConstant('{app}\runtime\ProcureXDesktopHost.exe');
  DatabasePath := AddBackslash(ProcureXDataDirectory()) + 'data\procurement.db';

  if FileExists(ExistingLauncher) then
  begin
    if not Exec(ExistingLauncher, '--stop --no-dialog', '', SW_HIDE,
      ewWaitUntilTerminated, ResultCode) then
    begin
      Result := 'Could not stop the existing ProcureX services. Close ProcureX and retry.';
      exit;
    end;
  end;

  if FileExists(DatabasePath) then
  begin
    if FileExists(ExistingRuntime) then
    begin
      if (not Exec(ExistingRuntime,
        '--backup --label pre-upgrade-{#MyAppVersion} --data-root "' +
        ProcureXDataDirectory() + '"', '', SW_HIDE,
        ewWaitUntilTerminated, ResultCode)) or (ResultCode <> 0) then
      begin
        Result := 'The verified pre-upgrade database backup failed. ' +
          'No application files were replaced.';
        exit;
      end;
    end
    else
    begin
      Log('Preserved ProcureX data found without an installed runtime. ' +
        'Treating this as a reinstall; the application migration layer will ' +
        'create a verified backup before any schema change.');
    end;
  end;
end;

function InitializeUninstall(): Boolean;
var
  DataForm: TSetupForm;
  Explanation: TNewStaticText;
  DeleteCheck: TNewCheckBox;
  ContinueButton: TNewButton;
  CancelButton: TNewButton;
begin
  DeleteBusinessData := False;
  if UninstallSilent then
  begin
    DeleteBusinessData := ExpandConstant('{param:DELETEBUSINESSDATA|0}') = '1';
    Result := True;
    exit;
  end;

  DataForm := CreateCustomForm(ScaleX(440), ScaleY(180), False, False);
  try
    DataForm.Caption := 'Uninstall ProcureX';

    Explanation := TNewStaticText.Create(DataForm);
    Explanation.Parent := DataForm;
    Explanation.Left := ScaleX(16);
    Explanation.Top := ScaleY(16);
    Explanation.Width := ScaleX(408);
    Explanation.Height := ScaleY(55);
    Explanation.AutoSize := False;
    Explanation.WordWrap := True;
    Explanation.Caption :=
      'ProcureX application files will be removed. Business data is preserved by default in:' +
      Chr(13) + Chr(10) + ProcureXDataDirectory();

    DeleteCheck := TNewCheckBox.Create(DataForm);
    DeleteCheck.Parent := DataForm;
    DeleteCheck.Left := ScaleX(16);
    DeleteCheck.Top := ScaleY(84);
    DeleteCheck.Width := ScaleX(408);
    DeleteCheck.Caption := 'Delete ProcureX business data';
    DeleteCheck.Checked := False;

    ContinueButton := TNewButton.Create(DataForm);
    ContinueButton.Parent := DataForm;
    ContinueButton.Caption := 'Continue';
    ContinueButton.ModalResult := mrOk;
    ContinueButton.Default := True;
    ContinueButton.Left := ScaleX(244);
    ContinueButton.Top := ScaleY(130);
    ContinueButton.Width := ScaleX(85);

    CancelButton := TNewButton.Create(DataForm);
    CancelButton.Parent := DataForm;
    CancelButton.Caption := 'Cancel';
    CancelButton.ModalResult := mrCancel;
    CancelButton.Cancel := True;
    CancelButton.Left := ScaleX(339);
    CancelButton.Top := ScaleY(130);
    CancelButton.Width := ScaleX(85);

    Result := DataForm.ShowModal() = mrOk;
    DeleteBusinessData := Result and DeleteCheck.Checked;
  finally
    DataForm.Free();
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDirectory: String;
begin
  if (CurUninstallStep = usPostUninstall) and DeleteBusinessData then
  begin
    DataDirectory := ProcureXDataDirectory();
    if CompareText(ExtractFileName(RemoveBackslashUnlessRoot(DataDirectory)), 'ProcureX') <> 0 then
      RaiseException('Refusing to delete an unexpected business-data path: ' + DataDirectory);
    if DirExists(DataDirectory) and not DelTree(DataDirectory, True, True, True) then
      MsgBox('Some ProcureX business data could not be removed: ' + DataDirectory,
        mbError, MB_OK);
  end;
end;
