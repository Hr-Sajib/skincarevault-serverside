import { describe, expect, it } from 'vitest';
import {
  displayPhone,
  escapeRegex,
  normaliseBdPhone,
  sanitiseRichText,
  slugify,
} from '../src/utils/text';

describe('slugify', () => {
  it('produces URL-safe slugs', () => {
    expect(slugify('Niacinamide 10% Serum')).toBe('niacinamide-10-serum');
    expect(slugify('  CeraVe!  ')).toBe('cerave');
    expect(slugify('A & B')).toBe('a-b');
  });
});

describe('normaliseBdPhone', () => {
  it('accepts the shapes customers actually type', () => {
    expect(normaliseBdPhone('01712345678')).toBe('+8801712345678');
    expect(normaliseBdPhone('+8801712345678')).toBe('+8801712345678');
    expect(normaliseBdPhone('8801712345678')).toBe('+8801712345678');
    expect(normaliseBdPhone('01712-345678')).toBe('+8801712345678');
    expect(normaliseBdPhone('1712345678')).toBe('+8801712345678');
  });

  it('rejects invalid numbers', () => {
    expect(normaliseBdPhone('0123456789')).toBeNull();
    expect(normaliseBdPhone('017123456')).toBeNull();
    expect(normaliseBdPhone('not a number')).toBeNull();
  });
});

describe('displayPhone', () => {
  it('strips the +88 prefix for display', () => {
    expect(displayPhone('+8801712345678')).toBe('01712345678');
    expect(displayPhone('01712345678')).toBe('01712345678');
  });
});

describe('escapeRegex', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeRegex('a.b*c')).toBe('a\\.b\\*c');
  });
});

describe('sanitiseRichText', () => {
  it('strips script tags while keeping safe markup', () => {
    const out = sanitiseRichText('<script>alert(1)</script><p>Hi</p>');
    expect(out).not.toContain('<script');
    expect(out).toContain('<p>Hi</p>');
  });

  it('forces links to open safely off-site', () => {
    const out = sanitiseRichText('<a href="https://example.com">x</a>');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });
});
