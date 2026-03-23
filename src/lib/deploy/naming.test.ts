import { describe, it, expect } from 'vitest';
import {
  buildAdName,
  parseAdName,
  isValidAdName,
  nextConceptId,
  sanitizeNamePart,
} from './naming';

describe('buildAdName', () => {
  it('builds correct name from parts', () => {
    const result = buildAdName({
      conceptId: 'c17',
      format: 'ghostpin',
      variable: 'sara_847ft',
      date: '0323',
    });
    expect(result).toBe('c17_ghostpin_sara_847ft_0323');
  });

  it('lowercases everything', () => {
    const result = buildAdName({
      conceptId: 'C17',
      format: 'GhostPin',
      variable: 'Sara_847FT',
      date: '0323',
    });
    expect(result).toBe('c17_ghostpin_sara_847ft_0323');
  });
});

describe('parseAdName', () => {
  it('parses a valid name back into parts', () => {
    const result = parseAdName('c17_ghostpin_sara_847ft_0323');
    expect(result).toEqual({
      conceptId: 'c17',
      format: 'ghostpin',
      variable: 'sara_847ft',
      date: '0323',
    });
  });

  it('returns null for names that do not match convention', () => {
    expect(parseAdName('invalid-name')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseAdName('')).toBeNull();
  });
});

describe('isValidAdName', () => {
  it('returns true for valid names', () => {
    expect(isValidAdName('c17_ghostpin_sara_847ft_0323')).toBe(true);
  });

  it('returns false for names with uppercase', () => {
    expect(isValidAdName('C17_ghostpin_sara_847ft_0323')).toBe(false);
  });

  it('returns false for names with spaces', () => {
    expect(isValidAdName('c17 ghostpin sara 0323')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidAdName('')).toBe(false);
  });
});

describe('nextConceptId', () => {
  it('returns "c1" when no existing names', () => {
    expect(nextConceptId([])).toBe('c1');
  });

  it('returns "c18" when existing names include c1-c17', () => {
    const names = Array.from({ length: 17 }, (_, i) =>
      `c${i + 1}_ghostpin_test_0323`,
    );
    expect(nextConceptId(names)).toBe('c18');
  });

  it('handles non-sequential existing IDs (skips gaps)', () => {
    const names = [
      'c1_ghostpin_test_0323',
      'c5_ghostpin_test_0323',
      'c10_ghostpin_test_0323',
    ];
    expect(nextConceptId(names)).toBe('c11');
  });

  it('ignores names that do not have concept IDs', () => {
    const names = [
      'c3_ghostpin_test_0323',
      'not_a_valid_name',
      'random_string',
    ];
    expect(nextConceptId(names)).toBe('c4');
  });
});

describe('sanitizeNamePart', () => {
  it('converts spaces to underscores', () => {
    expect(sanitizeNamePart('hello world')).toBe('hello_world');
  });

  it('removes special characters', () => {
    expect(sanitizeNamePart('test@#$%name')).toBe('testname');
  });

  it('lowercases', () => {
    expect(sanitizeNamePart('HelloWorld')).toBe('helloworld');
  });
});
