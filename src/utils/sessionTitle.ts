// Renderer re-export. The implementation lives in shared/ so the main-process
// SessionIndexService can clean titles at the source (every consumer — sidebar,
// notch, breadcrumb, overview — then sees clean text).
export { cleanSessionTitle } from '@shared/sessionTitle'
