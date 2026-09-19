import sanitizeHtml from 'sanitize-html';

/** URL-safe slug from a title. `"Niacinamide 10% Serum"` -> `"niacinamide-10-serum"`. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // drop punctuation
    .replace(/[\s_-]+/g, '-') // collapse whitespace and underscores
    .replace(/^-+|-+$/g, '');
}

/**
 * Normalises a Bangladeshi mobile number to `+8801XXXXXXXXX`.
 *
 * Accepts the shapes customers actually type: `01712345678`,
 * `+8801712345678`, `8801712345678`, `01712-345678`.
 * Returns null when the input is not a valid BD mobile number.
 */
export function normaliseBdPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');

  let local: string;
  if (digits.length === 11 && digits.startsWith('01')) {
    local = digits;
  } else if (digits.length === 13 && digits.startsWith('8801')) {
    local = digits.slice(2);
  } else if (digits.length === 10 && digits.startsWith('1')) {
    local = `0${digits}`;
  } else {
    return null;
  }

  // Operator prefixes in service: 013 Grameenphone, 014 Banglalink,
  // 015 Teletalk, 016 Airtel, 017 Grameenphone, 018 Robi, 019 Banglalink.
  if (!/^01[3-9]\d{8}$/.test(local)) return null;

  return `+88${local}`;
}

/** The display form of a stored number: `+8801712345678` -> `01712345678`. */
export const displayPhone = (phone: string): string =>
  phone.startsWith('+88') ? phone.slice(3) : phone;

/**
 * Cleans admin-authored rich text before it is stored. Product descriptions
 * are rendered as HTML on the storefront, so this is the boundary that keeps
 * a script tag from ever reaching a customer's browser.
 */
export function sanitiseRichText(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
      'ul', 'ol', 'li',
      'h2', 'h3', 'h4',
      'blockquote', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      // Any link we render points off-site; never leak the referrer or
      // hand the opened page a window.opener handle.
      a: sanitizeHtml.simpleTransform('a', {
        rel: 'noopener noreferrer',
        target: '_blank',
      }),
    },
  });
}

/** Escapes a user string for safe use inside a RegExp. */
export const escapeRegex = (input: string): string =>
  input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
