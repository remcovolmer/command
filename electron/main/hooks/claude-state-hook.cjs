#!/usr/bin/env node
/**
 * Claude Code Hook Script for Command
 *
 * This script receives hook events from Claude Code via stdin (JSON)
 * and writes the state to a file that the Electron app watches.
 */
const fs = require('fs');
const path = require('path');

// Read hook input from stdin
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
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
      case 'SessionEnd':
        // Session ended = stopped (red)
        state = 'stopped';
        break;
    }

    if (state) {
      const stateData = {
        session_id: data.session_id,
        cwd: data.cwd,
        state: state,
        timestamp: Date.now(),
        hook_event: hookEvent
      };
      fs.writeFileSync(stateFile, JSON.stringify(stateData, null, 2));
    }
  } catch (e) {
    // Silent fail - don't interfere with Claude Code
  }
});
