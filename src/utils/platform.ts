/** True when running on macOS — used for traffic-light-safe layout padding. */
export function isMac(): boolean {
  return navigator.userAgent.includes('Mac')
}
