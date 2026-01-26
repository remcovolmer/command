<p align="center">
  <img src="build/icon.svg" alt="Command Logo" width="120" height="120">
</p>

<h1 align="center">Command</h1>

<p align="center">
  <strong>Mission control for Claude Code</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows-blue" alt="Platform">
  <img src="https://img.shields.io/github/license/remcovolmer/command" alt="License">
</p>

---

## Why Command?

**You're deep in flow.** Claude is refactoring your authentication module. Then Slack pings — the payment bug is back. You open another terminal, start Claude on that project. Now you're Alt-Tabbing between six windows, losing context, forgetting which Claude asked you a question three minutes ago.

Sound familiar?

**Command is mission control for Claude Code.**

One window. All your projects in a sidebar. Every terminal visible at a glance. An orange dot tells you exactly which Claude needs your attention. `Ctrl+↑` to switch projects. Done.

It's the difference between juggling and conducting.

<p align="center">
  <img src="screenshot.png" alt="Command Screenshot" width="800">
</p>

---

## Features

- **Multi-project sidebar** — All your projects in one place, drag to reorder
- **Attention indicator** — Orange dot shows which Claude needs your input
- **Multiple terminals** — Up to 3 Claude sessions per project
- **File explorer** — Browse files and see git status without leaving the app
- **Keyboard-first** — Switch projects and terminals without touching the mouse
- **Dark & light themes** — Easy on the eyes, day or night

---

## Installation

**[Download for Windows →](https://github.com/remcovolmer/command/releases)**

Requires [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) to be installed.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl + ↑/↓` | Switch between projects |
| `Ctrl + ←/→` | Switch between terminals |
| `Ctrl + T` | New terminal in current project |
| `Ctrl + Alt + B` | Toggle file explorer |

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

<details>
<summary><strong>For developers</strong></summary>

### Build from source

```bash
git clone https://github.com/remcovolmer/command.git
cd command
npm install
npm run rebuild   # Required for node-pty (needs VS Build Tools)
npm run dev       # Development mode
npm run build     # Production build
```

### Tech stack

Electron 34 • React 18 • TypeScript • Tailwind CSS • Zustand • xterm.js • node-pty

### Contributing

1. Fork the repo
2. Create a feature branch
3. Open a Pull Request

</details>

---

<p align="center">
  Built with Claude Code
</p>
