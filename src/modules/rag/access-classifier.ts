/**
 * Sensitive Information & Permission-Aware Access Control Classifier
 * 
 * Classifies knowledge chunks into hierarchical security access levels:
 * Level 1 - PUBLIC: Safe for all external WhatsApp users / public retrieval
 * Level 2 - INTERNAL: Internal operations, SOPs, general workflows
 * Level 3 - CONFIDENTIAL: Customer PII, Employee HR/Salaries, Financials, Business Strategy, Legal, Contracts
 * Level 4 - RESTRICTED: Credentials, API Keys, Passwords, Secrets, Cloud Keys, DB Dumps, IPs, Vulns, Source Code
 */

export enum AccessLevel {
  PUBLIC = 1,
  INTERNAL = 2,
  CONFIDENTIAL = 3,
  RESTRICTED = 4
}

export interface AccessClassificationResult {
  accessLevel: AccessLevel;
  accessLevelName: 'public' | 'internal' | 'confidential' | 'restricted';
  sensitivityFlags: string[];
  detectedReasons: string[];
}

interface SensitivityRule {
  category: string;
  minLevel: AccessLevel;
  patterns: RegExp[];
  keywords: string[];
}

export const SENSITIVITY_RULES: SensitivityRule[] = [
  // 1. Level 4 - RESTRICTED: Credentials, Secrets, Tokens, Keys
  {
    category: 'Credentials & Secrets',
    minLevel: AccessLevel.RESTRICTED,
    patterns: [
      // API Keys, JWT, AWS/GCP/Azure, Private Keys, DB Passwords, Hashes
      /(?:api[_-]?key|apikey|secret[_-]?key|jwt[_-]?secret|auth[_-]?token|bearer\s+[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/i,
      /AKIA[0-9A-Z]{16}/, // AWS Access Key ID
      /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}/, // GitHub Token
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
      /(?:postgres|postgresql|mongodb|mysql|redis):\/\/[^\s:]+:[^\s@]+@/i, // Connection string with credentials
      /password\s*[:=]\s*['"][^\s'"]{4,}['"]/i,
      /\.env\b|JWT_SECRET|AWS_SECRET_ACCESS_KEY|AZURE_CLIENT_SECRET|PRIVATE_KEY/i
    ],
    keywords: [
      'api key', 'jwt secret', 'aws credentials', 'azure credentials', 'gcp credentials',
      'database password', 'private ssh key', 'tls certificate', 'github token', 'bitbucket token',
      'ci/cd secret', 'signing certificate', 'private key', 'root password', 'master key'
    ]
  },

  // 2. Level 4 - RESTRICTED: Database Dumps & Connection Details
  {
    category: 'Database Information & Dumps',
    minLevel: AccessLevel.RESTRICTED,
    patterns: [
      /(?:pg_dump|mysqldump|mongoexport|dump\.sql|backup\.sql)/i,
      /(?:INSERT INTO `?[a-zA-Z0-9_]+`? VALUES \()/i
    ],
    keywords: [
      'production database dump', 'database dump', 'db connection string', 'production db password',
      'schema credentials', 'table dump'
    ]
  },

  // 3. Level 4 - RESTRICTED: Security Vulnerabilities & Incidents
  {
    category: 'Security Vulnerabilities',
    minLevel: AccessLevel.RESTRICTED,
    patterns: [
      /CVE-\d{4}-\d{4,7}/i,
      /(?:zero-day|remote code execution|sql injection exploit|buffer overflow|privilege escalation exploit)/i
    ],
    keywords: [
      'security vulnerability', 'penetration-test report', 'pentest report', 'security incident',
      'exploit code', 'unpatched vulnerability', 'incident-response procedure'
    ]
  },

  // 4. Level 4 - RESTRICTED: Infrastructure, VPN & Internal IPs
  {
    category: 'Infrastructure & Internal Network',
    minLevel: AccessLevel.RESTRICTED,
    patterns: [
      // Private IP ranges (10.x.x.x, 172.16-31.x.x, 192.168.x.x, 100.64-127.x.x)
      /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
      /\b172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}\b/,
      /\b192\.168\.\d{1,3}\.\d{1,3}\b/,
      /\b(?:vpn\.internal|bastion\.|prod-db\.|staging-k8s\.)/i
    ],
    keywords: [
      'internal vpn', 'internal ip address', 'internal infrastructure diagram', 'network topology',
      'internal service architecture', 'security architecture', 'bastion host', 'ssh tunnel'
    ]
  },

  // 5. Level 4 - RESTRICTED: Proprietary Source Code & Algorithms
  {
    category: 'Source Code & Proprietary Algorithms',
    minLevel: AccessLevel.RESTRICTED,
    patterns: [
      /(?:function\s+[a-zA-Z0-9_]+\s*\(|class\s+[a-zA-Z0-9_]+\s*\{)/,
      /(?:const|let|var)\s+[a-zA-Z0-9_]+\s*=\s*(?:require|\(\))\s*=>/
    ],
    keywords: [
      'proprietary source code', 'unreleased product code', 'proprietary algorithm',
      'private repository', 'internal library source', 'model weights', 'model checkpoints'
    ]
  },

  // 6. Level 4 - RESTRICTED: AI/ML Proprietary Weights & Internal Architecture
  {
    category: 'AI/ML Architecture & Weights',
    minLevel: AccessLevel.RESTRICTED,
    patterns: [
      /(?:\.safetensors|\.ckpt|\.pt|\.bin)\b/i
    ],
    keywords: [
      'model weights', 'private dataset', 'proprietary model', 'internal ai architecture',
      'system prompt secret', 'evaluation data proprietary'
    ]
  },

  // 7. Level 3 - CONFIDENTIAL: Customer Data & PII
  {
    category: 'Customer PII & Account Data',
    minLevel: AccessLevel.CONFIDENTIAL,
    patterns: [
      // Credit card formats
      /\b(?:\d{4}[ -]?){3}\d{4}\b/,
      // Aadhaar / SSN format (3-2-4 or 4-4-4)
      /\b\d{3}-\d{2}-\d{4}\b/,
      /\b\d{4}\s\d{4}\s\d{4}\b/
    ],
    keywords: [
      'customer pii', 'customer ssn', 'customer passport', 'customer bank account',
      'customer contracts', 'account information confidential', 'customer usage record'
    ]
  },

  // 8. Level 3 - CONFIDENTIAL: Employee Data & HR
  {
    category: 'Employee Data & HR',
    minLevel: AccessLevel.CONFIDENTIAL,
    patterns: [
      /(?:annual\s+salary|base\s+pay|monthly\s+salary|ctc\s*[:=]|compensation\s*[:=])/i
    ],
    keywords: [
      'employee salary', 'employee pii', 'performance review', 'disciplinary matter',
      'hr record', 'employee personal details', 'background verification report'
    ]
  },

  // 9. Level 3 - CONFIDENTIAL: Financial Information
  {
    category: 'Financial Information',
    minLevel: AccessLevel.CONFIDENTIAL,
    patterns: [
      /(?:profit\s+margin|net\s+profit|gross\s+margin|ebitda|bank\s+balance|unreleased\s+revenue)/i
    ],
    keywords: [
      'internal revenue', 'internal costs', 'company budget', 'financial forecast',
      'bank account details', 'unreleased financial results', 'investor term sheet'
    ]
  },

  // 10. Level 3 - CONFIDENTIAL: Business Strategy & Product Roadmap
  {
    category: 'Business Strategy & Roadmap',
    minLevel: AccessLevel.CONFIDENTIAL,
    patterns: [
      /(?:acquisition\s+plan|merger\s+strategy|confidential\s+roadmap|q[1-4]\s+confidential)/i
    ],
    keywords: [
      'product roadmap', 'expansion plan', 'pricing strategy internal', 'market strategy',
      'acquisition plan', 'unreleased feature', 'unreleased design', 'internal prototype'
    ]
  },

  // 11. Level 3 - CONFIDENTIAL: Legal & Non-Public Contracts
  {
    category: 'Legal Information & Contracts',
    minLevel: AccessLevel.CONFIDENTIAL,
    patterns: [
      /(?:attorney-client\s+privileged|non-disclosure\s+agreement|settlement\s+agreement)/i
    ],
    keywords: [
      'litigation strategy', 'legal advice', 'settlement negotiation', 'confidential contract',
      'non-public agreement', 'vendor terms confidential', 'licensing terms'
    ]
  },

  // 12. Level 3 - CONFIDENTIAL: Intellectual Property & Trade Secrets
  {
    category: 'Intellectual Property',
    minLevel: AccessLevel.CONFIDENTIAL,
    patterns: [
      /(?:patent\s+pending\s+confidential|trade\s+secret|proprietary\s+formula)/i
    ],
    keywords: [
      'trade secret', 'patent before filing', 'proprietary formula', 'invention disclosure'
    ]
  },

  // 13. Level 3 - CONFIDENTIAL: Sales Pipeline & Negotiations
  {
    category: 'Sales Pipeline & Commercials',
    minLevel: AccessLevel.CONFIDENTIAL,
    patterns: [
      /(?:deal\s+negotiation|custom\s+discount\s+rate|commission\s+structure)/i
    ],
    keywords: [
      'sales pipeline', 'deal negotiation', 'special discount', 'sales forecast', 'commission structure'
    ]
  },

  // 14. Level 3 - CONFIDENTIAL: Internal Communications
  {
    category: 'Internal Communications',
    minLevel: AccessLevel.CONFIDENTIAL,
    patterns: [
      /(?:executive\s+sync|board\s+meeting\s+minutes|management\s+discussion)/i
    ],
    keywords: [
      'board meeting minutes', 'management discussion', 'internal investigation',
      'sensitive email discussion', 'leadership minutes'
    ]
  },

  // 15. Level 2 - INTERNAL: Internal Operations & SOPs
  {
    category: 'Internal Operations & SOPs',
    minLevel: AccessLevel.INTERNAL,
    patterns: [
      /(?:standard\s+operating\s+procedure|internal\s+sop|internal\s+runbook|team\s+process)/i
    ],
    keywords: [
      'sop', 'standard operating procedure', 'internal process', 'operational procedure',
      'team checklist', 'internal runbook', 'shift handover', 'escalation matrix'
    ]
  }
];

export class AccessClassifier {
  /**
   * Classifies a chunk or document text, identifying any sensitive content.
   * If a baseLevel is provided (e.g. from document ingestion settings),
   * the final level is at least baseLevel, but elevated if more sensitive content is detected.
   */
  classify(text: string, baseLevel: AccessLevel = AccessLevel.PUBLIC): AccessClassificationResult {
    let highestLevel: AccessLevel = baseLevel;
    const flags = new Set<string>();
    const reasons = new Set<string>();

    const lower = text.toLowerCase();

    for (const rule of SENSITIVITY_RULES) {
      let matched = false;

      // Check keywords
      for (const kw of rule.keywords) {
        if (lower.includes(kw)) {
          matched = true;
          reasons.add(`Keyword matched: "${kw}" (${rule.category})`);
          break;
        }
      }

      // Check regex patterns
      if (!matched) {
        for (const pattern of rule.patterns) {
          if (pattern.test(text)) {
            matched = true;
            reasons.add(`Pattern matched: ${rule.category}`);
            break;
          }
        }
      }

      if (matched) {
        flags.add(rule.category);
        if (rule.minLevel > highestLevel) {
          highestLevel = rule.minLevel;
        }
      }
    }

    return {
      accessLevel: highestLevel,
      accessLevelName: this.getLevelName(highestLevel),
      sensitivityFlags: Array.from(flags),
      detectedReasons: Array.from(reasons)
    };
  }

  /**
   * Returns human-readable access level name
   */
  getLevelName(level: AccessLevel): 'public' | 'internal' | 'confidential' | 'restricted' {
    switch (level) {
      case AccessLevel.RESTRICTED:
        return 'restricted';
      case AccessLevel.CONFIDENTIAL:
        return 'confidential';
      case AccessLevel.INTERNAL:
        return 'internal';
      case AccessLevel.PUBLIC:
      default:
        return 'public';
    }
  }

  /**
   * Parses string or number to valid AccessLevel enum
   */
  parseLevel(input: any, defaultLevel: AccessLevel = AccessLevel.PUBLIC): AccessLevel {
    if (typeof input === 'number') {
      if (input in AccessLevel) return input as AccessLevel;
      return defaultLevel;
    }
    if (typeof input === 'string') {
      const lower = input.toLowerCase().trim();
      if (lower === 'restricted' || lower === 'secret' || lower === '4') return AccessLevel.RESTRICTED;
      if (lower === 'confidential' || lower === '3') return AccessLevel.CONFIDENTIAL;
      if (lower === 'internal' || lower === '2') return AccessLevel.INTERNAL;
      if (lower === 'public' || lower === '1') return AccessLevel.PUBLIC;
    }
    return defaultLevel;
  }

  /**
   * Core Access Gate:
   * Returns true if and only if the chunk's accessLevel is less than or equal to user's accessLevel.
   * If chunk level is higher than user level, returns false (chunk will NEVER reach LLM prompt).
   */
  isAuthorized(chunkLevel: number, userAccessLevel: number): boolean {
    return chunkLevel <= userAccessLevel;
  }
}

export const accessClassifier = new AccessClassifier();
