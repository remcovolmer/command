---
name: ccli
description: Control the Command app from inside a Command chat. Use `ccli open <file|url>` to show something to the user — HTML files and URLs (localhost dev servers, external sites) render in Command's browser tab, other files open in the editor; ideal right after generating an HTML report/plan/dashboard or to preview a running dev server. Also: create/link/merge git worktrees, run and read sidecar terminals, send OS notifications, set the chat status/title, and list chats/projects. Available whenever COMMAND_CENTER_* env vars are set in the terminal.
---
<!-- ccli-skill-v3 -->
# ccli — Command Center CLI

You are running inside a **Command** terminal. The `ccli` CLI lets you control the app. Use it when it adds value to the current task — don't be preemptive.

## Worktrees

**Always use `ccli worktree create <name>` instead of `git worktree add`.** This creates the worktree AND upgrades your chat so the sidebar, file explorer, and PR polling all work correctly. After running, `cd` to the path returned in the output.

```bash
ccli worktree create feat-auth              # creates worktree + upgrades chat
ccli worktree create feat-auth --source dev  # branch from dev instead of default
ccli worktree link /path/to/existing         # link a pre-existing worktree (rare)
ccli worktree merge                          # merge the current worktree's PR
```

**Never use `git worktree add` directly** — Command cannot track worktrees it didn't create.

## Files & Browser

Show things to the user with `ccli open`. It routes by target type:

```bash
ccli open src/App.tsx                  # source in the editor
ccli open src/App.tsx --line 42        # editor, scrolled to a line
ccli open report.html                  # HTML rendered in the browser (live-reloads)
ccli open http://localhost:5173        # a running dev server in the browser
```

- **HTML files and URLs** (localhost dev servers, external sites) render in the built-in browser.
- **Every other file** opens as source in the editor; `--line` jumps to a line.
- After generating an HTML deliverable (a report, plan, or dashboard), `ccli open <file>` renders it for the user and live-reloads as you regenerate it.

Reading or editing a file's raw source is done with your normal file tools, not `ccli open`.

## Communication

```bash
ccli title "Auth refactor"             # name this chat based on the task
ccli status "Running test suite..."    # show current activity in the UI
ccli notify "Tests passed"             # OS notification (use for long tasks)
```

## Sidecar Terminals

Run and monitor background processes without interrupting this chat:

```bash
ccli sidecar create                    # create a sidecar terminal
ccli sidecar exec <id> "npm test"      # run a command in it
ccli sidecar read <id>                 # read recent output
ccli sidecar list                      # list active sidecars
```

## Discovery

```bash
ccli chat list                         # see other active sessions
ccli project list                      # list managed projects
ccli project create /path/to/repo      # add a project to Command
```
