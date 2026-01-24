// Get the electronAPI - returns the real API
export const getElectronAPI = (): typeof window.electronAPI => {
  if (!window.electronAPI) {
    throw new Error('electronAPI not available - are you running in Electron?')
  }
  return window.electronAPI
}
