// Maps an Electron `did-fail-load` failure into a short, human-readable reason
// for the in-app error page. Kept pure so the mapping is unit-testable.

export interface LoadFailure {
  url: string
  errorCode: number
  errorDescription: string
}

// -3 is ERR_ABORTED: the load was cancelled (stop(), live-reload, or a fast
// re-navigation), not a real failure. Callers use isAbort() to suppress the
// error overlay for these.
export const ERR_ABORTED = -3

export function isAbort(errorCode: number): boolean {
  return errorCode === ERR_ABORTED
}

/** A short, human-readable reason (nl) for a failed load. */
export function describeLoadError(failure: LoadFailure): string {
  switch (failure.errorDescription) {
    case 'ERR_CONNECTION_REFUSED':
      return 'Verbinding geweigerd — draait de dev-server op dit adres?'
    case 'ERR_NAME_NOT_RESOLVED':
      return 'Adres niet gevonden — controleer de URL.'
    case 'ERR_CONNECTION_TIMED_OUT':
    case 'ERR_TIMED_OUT':
      return 'De verbinding verliep (timeout).'
    case 'ERR_INTERNET_DISCONNECTED':
      return 'Geen netwerkverbinding.'
    case 'ERR_CONNECTION_RESET':
      return 'De verbinding werd verbroken.'
    case 'ERR_FILE_NOT_FOUND':
      return 'Bestand niet gevonden.'
    default:
      if (failure.errorDescription.includes('CERT')) {
        return 'Certificaatprobleem — de beveiligde verbinding kon niet worden vertrouwd.'
      }
      return failure.errorDescription || 'De pagina kon niet worden geladen.'
  }
}
