Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
If MsgBox("Uninstall Gearshift Desktop? Encrypted settings and credentials remain in your local Gearshift data folder. Disconnect first to remove the saved API key.", 36, "Gearshift") = 6 Then shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File " & Chr(34) & root & "\Uninstall.ps1" & Chr(34), 0, True
