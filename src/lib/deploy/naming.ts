/**
 * Ad naming convention enforcer.
 *
 * Format: {concept}_{format}_{variable}_{date}
 * Example: c17_ghostpin_sara_847ft_0323
 *
 * Rules:
 * - All lowercase
 * - Spaces become underscores
 * - Only [a-z0-9_] allowed
 * - Concept IDs are sequential: c1, c2, ... c17, c18
 * - Date format is MMDD
 * - Total name under 100 chars
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdNameParts {
  conceptId: string;  // e.g. "c17"
  format: string;     // e.g. "ghostpin"
  variable: string;   // e.g. "sara_847ft"
  date: string;       // e.g. "0323" (MMDD)
}

// ---------------------------------------------------------------------------
// Regex
// ---------------------------------------------------------------------------

/**
 * Matches: c{N}_{format}_{variable}_{MMDD}
 *
 * The variable portion can contain underscores, so we match everything
 * between the format and the trailing 4-digit date greedily.
 */
const AD_NAME_REGEX = /^(c\d+)_([a-z0-9]+)_(.+)_(\d{4})$/;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Build a standardized ad name from parts */
export function buildAdName(parts: AdNameParts): string {
  const raw = [
    sanitizeNamePart(parts.conceptId),
    sanitizeNamePart(parts.format),
    sanitizeNamePart(parts.variable),
    sanitizeNamePart(parts.date),
  ].join('_');

  if (raw.length > 100) {
    throw new Error(
      `Ad name exceeds 100 characters (${raw.length}): ${raw}`,
    );
  }

  return raw;
}

/** Parse an ad name into parts (returns null if doesn't match convention) */
export function parseAdName(name: string): AdNameParts | null {
  const match = name.match(AD_NAME_REGEX);
  if (!match) return null;

  return {
    conceptId: match[1],
    format: match[2],
    variable: match[3],
    date: match[4],
  };
}

/** Generate the next concept ID by querying existing ads */
export function nextConceptId(existingNames: string[]): string {
  let maxNum = 0;

  for (const name of existingNames) {
    const parsed = parseAdName(name);
    if (parsed) {
      const num = parseInt(parsed.conceptId.slice(1), 10);
      if (!Number.isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }

  return `c${maxNum + 1}`;
}

/** Validate that a name follows the convention */
export function isValidAdName(name: string): boolean {
  if (name.length > 100) return false;
  return AD_NAME_REGEX.test(name);
}

/** Sanitize a string for use in ad names (lowercase, replace spaces with _, remove special chars) */
export function sanitizeNamePart(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}
