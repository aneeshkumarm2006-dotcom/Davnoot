/* Today's hardcoded site chrome, as a committed constant.
 *
 * These mirror the values currently baked into lib/templates.js. The settings
 * screen edits a DIFF over these defaults, stored in db.settings (_id:'site').
 * No settings document -> these exact values -> byte-identical output. The
 * settings document is a diff, exactly like a page document.
 */
export const SITE_DEFAULTS = {
  brand: {
    name: 'Davnoot',
    wordmark: 'Davnoot Digital',
    logo: 'images/Firefly.png',
    tagline: 'Independent growth agency. Built for revenue.',
  },
  contact: {
    email: 'info@davnoot.com',
    phone: '+1-438-223-7131',
    phoneDisplay: '+1 (438) 223-7131',
    address: { locality: 'Montreal', region: 'QC', country: 'CA' },
  },
  org: {
    description:
      'Davnoot is an independent growth agency. Six disciplines — SEO, paid social, email, AI search, ChatGPT ads, and custom software — engineered into one revenue engine.',
    foundingDate: '2025',
    priceRange: '$$',
    areaServed: ['Montreal', 'Canada', 'Worldwide'],
    sameAs: [],
  },
  defaults: {
    siteUrl: 'https://www.davnoot.com',
    ogImage: 'https://www.davnoot.com/images/Firefly.png',
    twitterCard: 'summary_large_image',
    favicon: 'images/Firefly.png',
  },
  // Content rescued out of script.js so the CMS can edit it (see Phase 0).
  content: {
    rotatorWords: ['revenue', 'ROAS', 'growth', 'demand', 'pipeline', 'advantage'],
    bookingSlots: ['10:00 AM', '11:00 AM', '12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM'],
  },
};

/** Deep-merge a stored settings diff over the defaults. */
export function mergeSettings(stored) {
  return deepMerge(SITE_DEFAULTS, stored || {});
}

function deepMerge(base, over) {
  if (Array.isArray(over)) return over;
  if (over && typeof over === 'object' && base && typeof base === 'object' && !Array.isArray(base)) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over)) out[k] = deepMerge(base[k], v);
    return out;
  }
  return over === undefined ? base : over;
}
