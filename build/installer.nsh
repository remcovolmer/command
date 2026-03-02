!macro customInit
  ; Kill any running Command.exe processes before install/uninstall
  nsExec::ExecToLog 'taskkill /F /IM "Command.exe" /T'
  Sleep 1000
!macroend

!macro customInstall
  ; Register shortcut with explicit icon for taskbar pinning persistence
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_NAME}.exe" "" "$INSTDIR\resources\build\icon.ico" 0
!macroend
