#!/usr/bin/env node
/**
 * ccli — Command Center CLI
 *
 * Standalone CLI for controlling Command from within Claude Code terminals.
 * Reads env vars set by TerminalManager, makes HTTP requests to CommandServer.
 *
 * Node builtins only — no external dependencies.
 */

const http = require('http')
const path = require('path')

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

const VERSION = '0.1.0'

// ---------------------------------------------------------------------------
// Env vars
// ---------------------------------------------------------------------------

function getEnv() {
  const port = process.env.COMMAND_CENTER_PORT
  const terminalId = process.env.COMMAND_CENTER_TERMINAL_ID
  const token = process.env.COMMAND_CENTER_TOKEN

  const missing = []
  if (!port) missing.push('COMMAND_CENTER_PORT')
  if (!terminalId) missing.push('COMMAND_CENTER_TERMINAL_ID')
  if (!token) missing.push('COMMAND_CENTER_TOKEN')

  if (missing.length > 0) {
    process.stderr.write(
      'Error: ccli must be run inside a Command terminal.\n' +
      'Missing environment variables: ' + missing.join(', ') + '\n'
    )
    process.exit(1)
  }

  return { port: Number(port), terminalId, token }
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

function httpRequest(method, urlPath, body, env) {
  return new Promise((resolve, reject) => {
    const headers = {
      'Authorization': 'Bearer ' + env.token,
      'X-Terminal-ID': env.terminalId,
      'Content-Type': 'application/json',
    }

    const bodyStr = body != null ? JSON.stringify(body) : undefined

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: env.port,
        path: urlPath,
        method: method,
        headers: headers,
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8')
          let parsed
          try {
            parsed = JSON.parse(raw)
          } catch (_e) {
            parsed = { ok: false, error: 'Invalid response from server: ' + raw }
          }
          resolve({ statusCode: res.statusCode, body: parsed })
        })
      }
    )

    req.on('error', (err) => {
      reject(new Error('Failed to connect to Command server: ' + err.message))
    })

    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

// ---------------------------------------------------------------------------
// Argv parsing helpers
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  // argv = process.argv.slice(2)
  const positional = []
  const flags = {}

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      // Check if next arg is a value (not another flag) or if it's a boolean flag
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        flags[key] = argv[i + 1]
        i++
      } else {
        flags[key] = true
      }
    } else {
      positional.push(arg)
    }
  }

  return { positional, flags }
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function formatPretty(data) {
  if (data == null) return ''

  if (Array.isArray(data)) {
    return data.map((item, i) => {
      if (typeof item === 'object' && item !== null) {
        const lines = Object.entries(item)
          .map(([k, v]) => '  ' + k + ': ' + String(v))
          .join('\n')
        return (i + 1) + '.\n' + lines
      }
      return '  ' + String(item)
    }).join('\n\n')
  }

  if (typeof data === 'object') {
    return Object.entries(data)
      .map(([k, v]) => {
        if (Array.isArray(v)) {
          return k + ':\n' + formatPretty(v)
        }
        return k + ': ' + String(v)
      })
      .join('\n')
  }

  return String(data)
}

function output(result, pretty) {
  if (pretty) {
    if (!result.ok) {
      process.stderr.write('Error: ' + (result.error || 'Unknown error') + '\n')
    } else if (result.data != null) {
      process.stdout.write(formatPretty(result.data) + '\n')
    } else {
      process.stdout.write('OK\n')
    }
  } else {
    process.stdout.write(JSON.stringify(result) + '\n')
  }
}

// ---------------------------------------------------------------------------
// Route mapping
// ---------------------------------------------------------------------------

function buildRoute(positional, flags) {
  const group = positional[0]
  const action = positional[1]

  switch (group) {
    case 'worktree': {
      switch (action) {
        case 'create': {
          const name = positional[2]
          if (!name) return { error: 'Usage: ccli worktree create <name> [--branch <branch>] [--source <sourceBranch>]' }
          const body = { name }
          if (flags.branch) body.branch = flags.branch
          if (flags.source) body.sourceBranch = flags.source
          return { method: 'POST', path: '/worktree/create', body }
        }
        case 'link': {
          const linkPath = positional[2]
          if (!linkPath) return { error: 'Usage: ccli worktree link <path>' }
          return { method: 'POST', path: '/worktree/link', body: { path: path.resolve(linkPath) } }
        }
        case 'merge':
          return { method: 'POST', path: '/worktree/merge', body: {} }
        default:
          return { error: 'Unknown worktree action: ' + action + '\nAvailable: create, link, merge' }
      }
    }

    case 'open': {
      const file = positional[1]
      if (!file) return { error: 'Usage: ccli open <file> [--line <n>]' }
      const body = { file: path.resolve(file) }
      if (flags.line) body.line = Number(flags.line)
      return { method: 'POST', path: '/open', body }
    }

    case 'diff': {
      const file = positional[1]
      if (!file) return { error: 'Usage: ccli diff <file>' }
      return { method: 'POST', path: '/diff', body: { file: path.resolve(file) } }
    }

    case 'chat': {
      switch (action) {
        case 'list':
          return { method: 'GET', path: '/chat/list' }
        case 'info': {
          const id = positional[2]
          const qp = id ? '?id=' + encodeURIComponent(id) : ''
          return { method: 'GET', path: '/chat/info' + qp }
        }
        default:
          return { error: 'Unknown chat action: ' + action + '\nAvailable: list, info' }
      }
    }

    case 'project': {
      switch (action) {
        case 'list':
          return { method: 'GET', path: '/project/list' }
        case 'create': {
          const projPath = positional[2]
          if (!projPath) return { error: 'Usage: ccli project create <path> [--name <name>]' }
          const body = { path: path.resolve(projPath) }
          if (flags.name) body.name = flags.name
          return { method: 'POST', path: '/project/create', body }
        }
        case 'info': {
          const id = positional[2]
          const qp = id ? '?id=' + encodeURIComponent(id) : ''
          return { method: 'GET', path: '/project/info' + qp }
        }
        default:
          return { error: 'Unknown project action: ' + action + '\nAvailable: list, create, info' }
      }
    }

    case 'sidecar': {
      switch (action) {
        case 'create': {
          const body = {}
          if (flags.title) body.title = flags.title
          return { method: 'POST', path: '/sidecar/create', body }
        }
        case 'list':
          return { method: 'GET', path: '/sidecar/list' }
        case 'read': {
          const id = positional[2]
          if (!id) return { error: 'Usage: ccli sidecar read <id> [--lines <n>]' }
          const qp = '?id=' + encodeURIComponent(id) + (flags.lines ? '&lines=' + encodeURIComponent(flags.lines) : '')
          return { method: 'GET', path: '/sidecar/read' + qp }
        }
        case 'exec': {
          const id = positional[2]
          const command = positional.slice(3).join(' ')
          if (!id || !command) return { error: 'Usage: ccli sidecar exec <id> <command>' }
          return { method: 'POST', path: '/sidecar/exec', body: { id, command } }
        }
        default:
          return { error: 'Unknown sidecar action: ' + action + '\nAvailable: create, list, read, exec' }
      }
    }

    case 'notify': {
      const message = positional[1]
      if (!message) return { error: 'Usage: ccli notify <message> [--title <title>]' }
      const body = { message }
      if (flags.title) body.title = flags.title
      return { method: 'POST', path: '/notify', body }
    }

    case 'status': {
      const message = positional[1]
      if (!message) return { error: 'Usage: ccli status <message>' }
      return { method: 'POST', path: '/status', body: { message } }
    }

    case 'title': {
      const title = positional[1]
      if (!title) return { error: 'Usage: ccli title <title>' }
      return { method: 'POST', path: '/title', body: { title } }
    }

    default:
      return { error: 'Unknown command: ' + group + '\nRun ccli --help for usage.' }
  }
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const HELP_TEXT = `ccli v${VERSION} — Command Center CLI

Usage: ccli <command> [args] [--flags]

Commands:
  worktree create <name> [--branch <b>] [--source <s>]   Create a git worktree and upgrade chat
  worktree link <path>                                    Link existing worktree to current chat
  worktree merge                                          Merge the current worktree's PR

  open <file> [--line <n>]                                Open a file in the editor
  diff <file>                                             Open a file diff in the editor

  chat list                                               List chats in the current project
  chat info [id]                                          Show chat details (default: current)

  project list                                            List all projects
  project create <path> [--name <n>]                      Add a new project
  project info [id]                                       Show project details (default: current)

  sidecar create [--title <name>]                         Create a sidecar terminal
  sidecar list                                            List sidecar terminals
  sidecar read <id> [--lines <n>]                         Read sidecar output
  sidecar exec <id> <command>                             Execute command in sidecar

  notify <message> [--title <title>]                      Show OS notification
  status <message>                                        Set terminal status message
  title <title>                                           Rename the current chat

Flags:
  --pretty                                                Human-readable output
  --version                                               Show version
  --help                                                  Show this help

Environment:
  COMMAND_CENTER_PORT          Server port (set automatically)
  COMMAND_CENTER_TERMINAL_ID   Terminal ID (set automatically)
  COMMAND_CENTER_TOKEN         Auth token (set automatically)
`

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2)
  const { positional, flags } = parseArgs(argv)
  const pretty = flags.pretty === true

  // Top-level flags
  if (flags.version || (positional.length === 0 && argv.length === 0)) {
    process.stdout.write('ccli v' + VERSION + '\n')
    process.exit(0)
  }

  if (flags.help) {
    process.stdout.write(HELP_TEXT)
    process.exit(0)
  }

  if (positional.length === 0) {
    process.stdout.write(HELP_TEXT)
    process.exit(0)
  }

  // Build route from positional args and flags
  const route = buildRoute(positional, flags)

  if (route.error) {
    process.stderr.write('Error: ' + route.error + '\n')
    process.exit(1)
  }

  // Read env vars (exits on missing)
  const env = getEnv()

  // Make HTTP request
  let result
  try {
    const response = await httpRequest(route.method, route.path, route.body, env)
    result = response.body

    if (!result.ok) {
      output(result, pretty)
      process.exit(1)
    }
  } catch (err) {
    process.stderr.write('Error: ' + err.message + '\n')
    process.exit(1)
  }

  output(result, pretty)
  process.exit(0)
}

// Export internals for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseArgs, buildRoute, formatPretty, httpRequest, VERSION, HELP_TEXT }
}

// Run main only when executed directly (not when required for testing)
if (require.main === module) {
  main()
}
