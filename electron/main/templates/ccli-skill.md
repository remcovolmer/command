<!-- ccli-skill-v1 -->
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

## Files & Diffs

Show files and diffs to the user in Command's editor:

```bash
ccli open src/App.tsx                  # open file in editor
ccli open src/App.tsx --line 42        # open at specific line
ccli diff src/App.tsx                  # show git diff for file
```

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
