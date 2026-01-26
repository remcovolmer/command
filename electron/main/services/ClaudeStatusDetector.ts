/**
 * ClaudeStatusDetector - Detects Claude Code CLI status from terminal output
 *
 * Analyzes PTY output to determine Claude's current state:
 * - busy: Claude is actively working (spinner, "esc to interrupt")
 * - question: Claude is asking the user a question (disabled for now - too many false positives)
 * - permission: Claude needs permission for a tool/command
 * - ready: Claude is waiting for user input
 */

export type ClaudeStatus = 'busy' | 'question' | 'permission' | 'ready' | null;

export class ClaudeStatusDetector {
  // Buffer to accumulate recent output for pattern matching
  private buffer: string = '';
  private readonly maxBufferSize = 2000;

  // Track last detected state to avoid flickering
  private lastState: ClaudeStatus = null;
  private lastStateTime: number = 0;
  private readonly stateDebounceMs = 300; // Minimum time between state changes

  // ANSI escape code stripper pattern
  private readonly ansiPattern = /\x1B(?:\[[0-9;]*[a-zA-Z]|\][^\x07]*\x07|[()][AB012]|\[[\?]?[0-9;]*[hlm]|[=>]|\[[0-9]*[ABCDEFGJKST])/g;

  // Spinner characters used by Claude Code (Braille patterns and stars)
  private readonly spinnerChars = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✳✶✽⣾⣽⣻⢿⡿⣟⣯⣷]/;

  // Pattern for "busy" state - Claude is working
  private readonly busyPatterns = [
    /\(esc to interrupt/i,
    /tokens/i,  // Token count in status line
  ];

  // Pattern for "permission" state - Claude needs approval
  // Very specific: numbered list with Yes as first option
  private readonly permissionPatterns = [
    /1\.\s*Yes\s*\r?\n\s*2\.\s*(Yes,? and don't ask|No)/i,
  ];

  /**
   * Strip ANSI escape codes from text
   */
  private stripAnsi(text: string): string {
    return text.replace(this.ansiPattern, '');
  }

  /**
   * Check if enough time has passed to change state (debouncing)
   */
  private canChangeState(): boolean {
    return Date.now() - this.lastStateTime >= this.stateDebounceMs;
  }

  /**
   * Check if the buffer ends with Claude's input prompt
   */
  private endsWithPrompt(text: string): boolean {
    // Claude's prompt is "❯" (U+276F) not ">"
    // The prompt line looks like "❯  " or just "❯"
    const trimmed = text.trimEnd();

    // Check the last few lines (sometimes there are empty lines)
    const lines = trimmed.split('\n');

    // Check last 3 lines for the prompt
    for (let i = Math.max(0, lines.length - 3); i < lines.length; i++) {
      const line = lines[i]?.trim() || '';
      // Claude's prompt is "❯" possibly with trailing spaces
      // Also check for regular ">" just in case
      if (line === '❯' || line === '>' || line.startsWith('❯ ') || line.startsWith('> ')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Analyze terminal output and detect Claude's status
   *
   * @param data - Raw terminal output data
   * @returns Detected status or null if no clear status detected
   */
  analyzeOutput(data: string): ClaudeStatus {
    // Add to buffer
    this.buffer += data;

    // Trim buffer if too large (keep last N chars)
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer = this.buffer.slice(-this.maxBufferSize);
    }

    // Strip ANSI codes for pattern matching
    const cleanData = this.stripAnsi(data);
    const cleanBuffer = this.stripAnsi(this.buffer);

    let detectedState: ClaudeStatus = null;
    let reason = '';

    // Priority 1: Check for ready prompt FIRST
    // This is the most important check - if Claude shows the prompt, we're ready
    const promptCheck = this.endsWithPrompt(cleanBuffer);
    if (promptCheck) {
      detectedState = 'ready';
      reason = 'prompt detected at end of buffer';
    }

    // Priority 2: Check for permission prompt in buffer
    if (!detectedState) {
      const lastChunk = cleanBuffer.slice(-800);
      for (const pattern of this.permissionPatterns) {
        if (pattern.test(lastChunk)) {
          detectedState = 'permission';
          reason = 'permission pattern matched';
          break;
        }
      }
    }

    // Priority 3: Check for busy indicators in current data chunk
    // ONLY if we didn't detect ready or permission
    if (!detectedState) {
      // Status line update (carriage return without newline) = busy
      if (data.includes('\r') && !data.includes('\n')) {
        detectedState = 'busy';
        reason = 'status line update (\\r without \\n)';
      }
      // Spinner characters in current output = busy
      else if (this.spinnerChars.test(cleanData)) {
        detectedState = 'busy';
        reason = 'spinner chars detected';
      }
    }

    // Apply debouncing - don't change state too quickly
    if (detectedState !== null && detectedState !== this.lastState) {
      console.log(`[Detector] State change: ${this.lastState} -> ${detectedState}, canChange: ${this.canChangeState()}, reason: ${reason}`)
      if (this.canChangeState()) {
        this.lastState = detectedState;
        this.lastStateTime = Date.now();
        return detectedState;
      }
    }

    // Return null if no state change
    return null;
  }

  /**
   * Force set busy state (call when user types input)
   */
  setUserInput(): void {
    this.lastState = 'busy';
    this.lastStateTime = Date.now();
    this.buffer = '';
  }

  /**
   * Clear the buffer (call when terminal is reset or closed)
   */
  clearBuffer(): void {
    this.buffer = '';
    this.lastState = null;
    this.lastStateTime = 0;
  }

  /**
   * Get the last detected state (for debugging)
   */
  getLastState(): ClaudeStatus {
    return this.lastState;
  }
}
