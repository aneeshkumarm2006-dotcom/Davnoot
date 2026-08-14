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
    logo: 'images/davnoot-logo.png',
    tagline: 'Independent growth agency. Built for revenue.',
  },
  contact: {
    email: 'info@davnoot.com',
    phone: '+1-438-223-7131',
    phoneDisplay: '+1 (438) 223-7131',
    // NAP: this must stay byte-identical to the Google Business Profile listing.
    // The locality is Westmount (the municipality that owns postal code H3Z 1B1),
    // NOT Montreal — an address that disagrees with GBP is worse than no address.
    // Geographic TARGETING (Montreal / Canada / US) lives on areaServed below.
    address: {
      street: '4115 Sherbrooke St W',
      locality: 'Westmount',
      region: 'QC',
      postalCode: 'H3Z 1B1',
      country: 'CA',
    },
  },
  org: {
    description:
      'Davnoot is an independent growth agency. Six disciplines: SEO, paid social, email, AI search, ChatGPT ads, and custom software. Engineered into one revenue engine.',
    foundingDate: '2025',
    priceRange: '$$',
    /* The LOCAL business's service area, in priority order: Montreal first, then
     * Canada, then the US. Stored as {type,name} rather than bare strings so the
     * schema can emit real Place nodes (City / Country) instead of loose text —
     * `"areaServed": "Canada"` is a string a parser has to guess at.
     *
     * This is a DECLARATION of where we sell, not a ranking lever: naming the US
     * here does not make the site rank there. It is deliberately narrower than
     * Organization.areaServed ("Worldwide" — see orgNode in lib/templates.js),
     * which is the entity-level claim the English hreflang decision rests on. */
    areaServed: [
      { type: 'City', name: 'Montreal' },
      { type: 'Country', name: 'Canada' },
      { type: 'Country', name: 'United States' },
    ],
    sameAs: ['https://www.instagram.com/davnootdigital/', 'https://www.linkedin.com/company/davnoot/'],
  },
  defaults: {
    siteUrl: 'https://www.davnoot.com',
    ogImage: 'https://www.davnoot.com/images/davnoot-logo.png',
    twitterCard: 'summary_large_image',
    // The generated square icon, NOT the logo — see FAVICON_TAGS in lib/templates.js
    // for why the logo itself cannot serve as a favicon.
    favicon: 'favicon.ico',
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
