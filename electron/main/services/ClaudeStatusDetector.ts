/**
 * ClaudeStatusDetector - Detects Claude Code CLI status from terminal output
 *
 * Analyzes PTY output to determine Claude's current state:
 * - busy: Claude is actively working (spinner, "esc to interrupt")
 * - question: Claude is asking the user a question
 * - permission: Claude needs permission for a tool/command
 * - ready: Claude is waiting for user input
 */

export type ClaudeStatus = 'busy' | 'question' | 'permission' | 'ready' | null;

export class ClaudeStatusDetector {
  // Buffer to accumulate recent output for pattern matching
  private buffer: string = '';
  private readonly maxBufferSize = 2000;

  // ANSI escape code stripper pattern
  private readonly ansiPattern = /\x1B\[[0-9;]*[a-zA-Z]|\x1B\][^\x07]*\x07|\x1B[()][AB012]|\x1B\[[\?]?[0-9;]*[hlm]/g;

  // Spinner characters used by Claude Code (Braille patterns and stars)
  private readonly spinnerChars = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✳✶✽]/;

  // Pattern for "busy" state - Claude is working
  // Matches: "(esc to interrupt" in status line
  private readonly busyPattern = /\(esc to interrupt/i;

  // Pattern for "permission" state - Claude needs approval
  // Matches numbered options with "Yes", "Allow", "Approve" etc.
  // Example: "> 1. Yes" or "1. Allow"
  private readonly permissionPatterns = [
    /^\s*>\s*1\.\s*(Yes|Allow|Approve)/im,
    /Do you want to proceed\?/i,
    /Allow this action\?/i,
    /1\.\s*Yes\s*\n\s*2\.\s*(Yes,? and don't ask|No)/i,
  ];

  // Pattern for "question" state - Claude is asking a question
  // Matches question format with numbered options
  private readonly questionPatterns = [
    /\?\s*["']?\s*$/m,  // Ends with question mark
    /Which .*\?\s*$/im,
    /What .*\?\s*$/im,
    /How .*\?\s*$/im,
    /Do you .*\?\s*$/im,
    /Would you .*\?\s*$/im,
  ];

  // Pattern for "ready" state - Claude waiting for input
  // Matches the ">" prompt at the start of a line
  private readonly readyPatterns = [
    /^>\s*$/m,           // Just ">" prompt
    /\n>\s*$/,           // Newline followed by ">" prompt
  ];

  /**
   * Strip ANSI escape codes from text
   */
  private stripAnsi(text: string): string {
    return text.replace(this.ansiPattern, '');
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

    // Check for carriage return (status line update) - indicates busy
    if (data.includes('\r') && !data.includes('\n')) {
      // Status line update without newline = still working
      if (this.spinnerChars.test(cleanData) || this.busyPattern.test(cleanData)) {
        return 'busy';
      }
    }

    // Check for permission prompt (highest priority for input states)
    for (const pattern of this.permissionPatterns) {
      if (pattern.test(cleanBuffer)) {
        return 'permission';
      }
    }

    // Check for question (second priority)
    // Only if we have numbered options indicating a choice
    const hasNumberedOptions = /^\s*[1-4]\.\s+\w+/m.test(cleanBuffer);
    if (hasNumberedOptions) {
      for (const pattern of this.questionPatterns) {
        if (pattern.test(cleanBuffer)) {
          return 'question';
        }
      }
    }

    // Check for ready prompt
    for (const pattern of this.readyPatterns) {
      if (pattern.test(cleanBuffer)) {
        return 'ready';
      }
    }

    // Check for busy indicators
    if (this.spinnerChars.test(cleanData) || this.busyPattern.test(cleanData)) {
      return 'busy';
    }

    // No clear status detected
    return null;
  }

  /**
   * Clear the buffer (call when terminal is reset or closed)
   */
  clearBuffer(): void {
    this.buffer = '';
  }

  /**
   * Get the current buffer content (for debugging)
   */
  getBuffer(): string {
    return this.buffer;
  }
}
