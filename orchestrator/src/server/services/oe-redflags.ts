export interface RedFlag {
  id: string;
  severity: "high" | "medium" | "low";
  snippet: string;
}

interface FlagRule {
  id: string;
  severity: "high" | "medium" | "low";
  patterns: RegExp[];
}

const RULES: FlagRule[] = [
  {
    id: "exclusivity",
    severity: "high",
    patterns: [
      /exclusive employment/i,
      /no other employment/i,
      /moonlighting/i,
      /outside work prohibited/i,
      /outside employment/i,
    ],
  },
  {
    id: "non_compete",
    severity: "high",
    patterns: [
      /non[\s-]compete/i,
      /restrictive covenant/i,
    ],
  },
  {
    id: "surveillance_tool",
    severity: "high",
    patterns: [
      /\bHubstaff\b/i,
      /\bTime Doctor\b/i,
      /\bActivTrak\b/i,
      /\bTeramind\b/i,
      /\bInterGuard\b/i,
      /screen recording/i,
      /keystroke monitoring/i,
      /biometric monitoring/i,
    ],
  },
  {
    id: "employer_device_required",
    severity: "high",
    patterns: [
      /company[\s-]issued device/i,
      /employer[\s-]provided laptop/i,
      /no personal devices/i,
    ],
  },
  {
    id: "core_hours",
    severity: "medium",
    patterns: [
      /core hours/i,
      /9[\s-]to[\s-][56]/i,
      /must be online \d{1,2}/i,
      /available between \d{1,2}:\d{2} and \d{1,2}:\d{2}/i,
    ],
  },
  {
    id: "on_call_rotation",
    severity: "medium",
    patterns: [
      /on[\s-]call rotation/i,
      /\bpager[\s-]?duty\b/i,
      /after[\s-]hours support/i,
    ],
  },
  {
    id: "mandatory_camera",
    severity: "medium",
    patterns: [
      /camera on\b/i,
      /camera required/i,
      /video on for all meetings/i,
    ],
  },
  {
    id: "in_person_offsite",
    severity: "low",
    patterns: [
      /quarterly offsite/i,
      /annual retreat/i,
      /in[\s-]person summit/i,
    ],
  },
  {
    id: "bg_check_deep",
    severity: "medium",
    patterns: [
      /\bpolygraph\b/i,
      /credit check/i,
      /biometric background/i,
    ],
  },
];

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSnippet(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - 60);
  const end = Math.min(text.length, match.index + match[0].length + 60);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

export function scan(description: string): RedFlag[] {
  const clean = stripHtml(description);
  const flags: RedFlag[] = [];
  const seen = new Set<string>();

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const regex = new RegExp(pattern.source, pattern.flags);
      const match = regex.exec(clean);
      if (match && !seen.has(rule.id)) {
        seen.add(rule.id);
        flags.push({
          id: rule.id,
          severity: rule.severity,
          snippet: extractSnippet(clean, match),
        });
        break;
      }
    }
  }

  return flags;
}
