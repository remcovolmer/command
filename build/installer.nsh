!macro customInit
  ; Kill any running Command.exe processes before install/uninstall
  nsExec::ExecToLog 'taskkill /F /IM "Command.exe" /T'
  Sleep 1000
!macroend
