@echo off
rem The Gearshift command line, run with the bundled runtime.
rem Works on a computer that has no Node or npm installed.
"%~dp0runtime\node.exe" "%~dp0plugins\gearshift\bin\gearshift.mjs" %*
