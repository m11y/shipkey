import { parse } from "dotenv";
import { expand } from "dotenv-expand";
import type { ShipkeyDirective } from "../types";

export interface ParsedVar {
  key: string;
  value: string;
  directive?: ShipkeyDirective;
}

const SHIPKEY_DIRECTIVE_RE = /^#\s*shipkey\s*:\s*(.+)$/i;
const ENV_ASSIGNMENT_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

function parseDirectiveValue(raw: string): boolean | string {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return raw.trim();
}

function parseShipkeyDirective(raw: string): ShipkeyDirective {
  const directive: ShipkeyDirective = {};

  for (const part of raw.split(",")) {
    const token = part.trim();
    if (!token) continue;

    const eqIndex = token.indexOf("=");
    if (eqIndex === -1) {
      directive[token] = true;
      continue;
    }

    const key = token.slice(0, eqIndex).trim();
    const value = token.slice(eqIndex + 1).trim();
    if (!key) continue;
    directive[key] = parseDirectiveValue(value);
  }

  return directive;
}

function extractInlineDirective(line: string): ShipkeyDirective | undefined {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = inDoubleQuote;
      continue;
    }

    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (ch !== "#" || inSingleQuote || inDoubleQuote) continue;

    const directiveMatch = line.slice(i).trim().match(SHIPKEY_DIRECTIVE_RE);
    if (!directiveMatch) return undefined;

    const directive = parseShipkeyDirective(directiveMatch[1]);
    return Object.keys(directive).length > 0 ? directive : undefined;
  }

  return undefined;
}

export function parseDotenv(content: string): ParsedVar[] {
  const parsed = parse(content);
  const { parsed: expanded } = expand({ parsed, processEnv: {} });
  const values = expanded ?? parsed;
  const directives = new Map<string, ShipkeyDirective>();
  let pendingDirective: ShipkeyDirective | undefined;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed) {
      pendingDirective = undefined;
      continue;
    }

    const directiveMatch = trimmed.match(SHIPKEY_DIRECTIVE_RE);
    if (directiveMatch) {
      const directive = parseShipkeyDirective(directiveMatch[1]);
      pendingDirective = Object.keys(directive).length > 0 ? directive : undefined;
      continue;
    }

    const assignmentMatch = line.match(ENV_ASSIGNMENT_RE);
    if (assignmentMatch) {
      const key = assignmentMatch[1];
      const inlineDirective = extractInlineDirective(line);
      const directive = inlineDirective ?? pendingDirective;
      if (directive) directives.set(key, directive);
      pendingDirective = undefined;
      continue;
    }

    pendingDirective = undefined;
  }

  return Object.entries(values).map(([key, value]) => ({
    key,
    value: value ?? "",
    ...(directives.has(key) && { directive: directives.get(key)! }),
  }));
}
