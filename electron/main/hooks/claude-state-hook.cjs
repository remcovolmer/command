#!/usr/bin/env node
/**
 * Claude Code Hook Script for Command
 *
 * This script receives hook events from Claude Code via stdin (JSON)
 * and writes the state to a file that the Electron app watches.
 */
const fs = require('fs');
const path = require('path');

// Configuration constants
const STALE_SESSION_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Read hook input from stdin
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', async () => {
  try {
    const data = JSON.parse(input);

    // Validate session_id format to prevent prototype pollution
    if (!data.session_id || !UUID_REGEX.test(data.session_id)) {
      return; // Invalid session ID, skip
    }

    const stateFile = path.join(
      process.env.HOME || process.env.USERPROFILE,
      '.claude',
      'command-center-state.json'
    );

    // Map hook event to state
    let state = null;
    const hookEvent = data.hook_event_name;

    switch (hookEvent) {
      case 'PreToolUse':
        // Check if Claude is asking a question
        if (data.tool_name === 'AskUserQuestion') {
          // Question asked = question (orange)
          state = 'question';
        } else {
          // Working with tools = busy (blue)
          state = 'busy';
        }
        break;
      case 'SessionStart':
        // Starting = busy (blue)
        state = 'busy';
        break;
      case 'Stop':
        // Finished responding = done (green)
        state = 'done';
        break;
      case 'SessionEnd':
        // Session ended = done (green)
        state = 'done';
        break;
      case 'Notification':
        switch (data.notification_type) {
          case 'permission_prompt':
            // Permission needed = permission (orange)
            state = 'permission';
            break;
          case 'idle_prompt':
            // Claude waiting 60+ seconds for user input = done (green)
            state = 'done';
            break;
          // auth_success and other types don't change state
        }
        break;
      case 'UserPromptSubmit':
        // User submitted a prompt = busy (blue)
        state = 'busy';
        break;
      case 'PermissionRequest':
        // Permission requested = permission (orange)
        state = 'permission';
        break;
    }

    if (state) {
      // Skip redundant busy writes from PreToolUse — reduces process spawning by ~80%
      // during active Claude work (PreToolUse fires for every tool call)
      if (hookEvent === 'PreToolUse' && state === 'busy') {
        try {
          const existing = await fs.promises.readFile(stateFile, 'utf-8');
          const parsed = JSON.parse(existing);
          if (parsed[data.session_id]?.state === 'busy') {
            process.exit(0); // Already busy, skip write
          }
        } catch (e) {
          // File doesn't exist or can't parse, proceed with write
        }
      }

      const stateData = {
        session_id: data.session_id,
        cwd: data.cwd,
        state: state,
        timestamp: Date.now(),
        hook_event: hookEvent
      };

      // Read-merge-write pattern for multi-session support.
      // NOTE: With async hooks, concurrent writes are possible (e.g. rapid PreToolUse events).
      // Last-writer-wins race is acceptable here because state is self-healing —
      // the next hook event will overwrite with fresh state within milliseconds.
      // Use Object.create(null) to prevent prototype pollution
      let allStates = Object.create(null);
      try {
        const existing = await fs.promises.readFile(stateFile, 'utf-8');
        const parsed = JSON.parse(existing);
        allStates = Object.assign(Object.create(null), parsed);
      } catch (e) {
        // Start fresh if file doesn't exist or is invalid
      }

      // Write this session's state keyed by session_id
      allStates[data.session_id] = stateData;

      // Cleanup stale sessions
      const now = Date.now();
      for (const sid in allStates) {
        if (allStates[sid].timestamp && now - allStates[sid].timestamp > STALE_SESSION_TIMEOUT_MS) {
          delete allStates[sid];
        }
      }

      // Atomic write: temp file + rename to avoid TOCTOU race conditions
      const tempFile = stateFile + '.tmp.' + process.pid;
      try {
        await fs.promises.writeFile(tempFile, JSON.stringify(allStates));
        await fs.promises.rename(tempFile, stateFile);
      } catch (writeErr) {
        // Cleanup temp file on error
        try { await fs.promises.unlink(tempFile); } catch (e) {}
      }
    }
  } catch (e) {
    // Silent fail - don't interfere with Claude Code
  }

  // Ensure prompt exit — avoids lingering process blocking Claude Code
  process.exit(0);
});
