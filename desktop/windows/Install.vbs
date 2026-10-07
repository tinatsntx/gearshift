Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
result = shell.Run("powershell.exe -NoProfile -ExecutionPolicy Bypass -File " & Chr(34) & root & "\Install.ps1" & Chr(34), 0, True)
If result <> 0 Then MsgBox "Gearshift installation failed. See the installation log in your local Gearshift data folder.", 16, "Gearshift"
