import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

// Configure Monaco to use local package instead of CDN
// This is required for Electron's Content Security Policy
loader.config({ monaco })
