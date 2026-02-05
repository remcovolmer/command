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
      const stateData = {
        session_id: data.session_id,
        cwd: data.cwd,
        state: state,
        timestamp: Date.now(),
        hook_event: hookEvent
      };

      // Read-merge-write pattern for multi-session support
      let allStates = {};
      try {
        const existing = fs.readFileSync(stateFile, 'utf-8');
        allStates = JSON.parse(existing);
        // Handle legacy single-session format (migrate to multi-session)
        if (allStates.session_id && !allStates[allStates.session_id]) {
          allStates = {};
        }
      } catch (e) {
        // Start fresh if file doesn't exist or is invalid
      }

      // Write this session's state keyed by session_id
      allStates[data.session_id] = stateData;

      // Cleanup stale sessions (older than 1 hour)
      const ONE_HOUR = 60 * 60 * 1000;
      const now = Date.now();
      for (const sid in allStates) {
        if (allStates[sid].timestamp && now - allStates[sid].timestamp > ONE_HOUR) {
          delete allStates[sid];
        }
      }

      fs.writeFileSync(stateFile, JSON.stringify(allStates, null, 2));
    }
  } catch (e) {
    // Silent fail - don't interfere with Claude Code
  }
});
