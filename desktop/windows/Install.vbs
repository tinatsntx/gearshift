Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
result = shell.Run("powershell.exe -NoProfile -ExecutionPolicy Bypass -File " & Chr(34) & root & "\Install.ps1" & Chr(34), 0, True)
' 2 means the installer already explained the failure itself.
If result <> 0 And result <> 2 Then MsgBox "Gearshift installation failed. Details are in " & shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\.gearshift\install.log", 16, "Gearshift"
