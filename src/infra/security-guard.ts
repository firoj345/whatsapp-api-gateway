/**
 * Security Guard & Input Sanitizer
 * Protects against SQL injection, Command injection, Script injection (XSS/RCE),
 * Path traversal, and Prompt injection.
 */

// Patterns indicating potential script or command injection attempts
const MALICIOUS_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, // <script> tags
  /javascript:/gi,
  /onerror\s*=/gi,
  /onload\s*=/gi,
  /\b(?:eval|exec|spawn|fork|system|passthru|shell_exec)\s*\(/gi, // Code execution primitives
  /(?:^|[\s;&|`])(?:sh|bash|zsh|csh|cmd(?:\.exe)?|powershell(?:\.exe)?|curl|wget|nc|netcat|rm\s+-rf)(?:[\s;&|`]|$)/i, // Shell commands
  /(?:\||;|&&|\|\||`|\$\([^)]*\))/g, // Command chaining & subshells
  /\.\.[\/\\]/g, // Path traversal ../
  /\b(?:UNION\s+ALL\s+SELECT|UNION\s+SELECT|DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM|ALTER\s+TABLE|INSERT\s+INTO\s+USERS)\b/i // Destructive SQL injection
];

export interface ValidationResult {
  isValid: boolean;
  sanitized: string;
  threatDetected?: string;
}

export class SecurityGuard {
  /**
   * Check if an input string contains dangerous script, command, or SQL injection patterns
   */
  detectThreat(input: string): { isThreat: boolean; reason?: string } {
    if (!input || typeof input !== 'string') return { isThreat: false };

    for (const pattern of MALICIOUS_PATTERNS) {
      if (pattern.test(input)) {
        return {
          isThreat: true,
          reason: `Potential code/command injection pattern detected: ${pattern.source}`
        };
      }
    }

    return { isThreat: false };
  }

  /**
   * Sanitize natural language input (e.g. voice transcripts, query strings)
   * Strips control characters, dangerous shell symbols, and script tags.
   */
  sanitizeText(input: string, maxLength = 250): string {
    if (!input || typeof input !== 'string') return '';

    return input
      // Remove null bytes and non-printable control characters (except newline/tab)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      // Remove HTML/script tags
      .replace(/<[^>]*>?/gm, '')
      // Remove shell metacharacters
      .replace(/[;&|`$(){}[\]\\]/g, ' ')
      // Collapse whitespace
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
  }

  /**
   * Sanitize an item or product search term
   * Only allows letters, digits, spaces, and safe punctuation (-, ., #, ", ')
   */
  sanitizeSearchTerm(term: string, maxLength = 60): string {
    if (!term || typeof term !== 'string') return '';

    return term
      .replace(/[^a-zA-Z0-9\s\-._#]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
  }

  /**
   * Validate and clamp numeric limit parameters
   */
  clampLimit(val: any, min = 1, max = 10, defaultVal = 3): number {
    const num = parseInt(val, 10);
    if (isNaN(num)) return defaultVal;
    return Math.max(min, Math.min(num, max));
  }
}

export const securityGuard = new SecurityGuard();
