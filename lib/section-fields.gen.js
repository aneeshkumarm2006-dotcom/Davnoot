/* Field schemas for the section library.
 *
 * For each reusable section type: its non-repeating fields and its repeating-item
 * fields, each with a KIND. Two consumers, and they MUST agree:
 *   1. The admin form (lib/section-fields is browser-safe: no deps) renders the right
 *      control per kind.
 *   2. The WRITE path (lib/page-model.js sanitizeContentFields) sanitizes each field
 *      by kind. For a composed page tpl is null, so without this map every field would
 *      be sanitized as 'inline' — too strict for a richtext body, and it would strip an
 *      author's intended markup. This map is the composed page's equivalent of a
 *      compiled template's slots.
 *
 * kind ∈ text | inline | richtext | url | image | bool.
 */
export const SECTION_FIELDS = {
  hero: {
    label: 'Hero',
    fields: [
      { key: 'badge', kind: 'inline', label: 'Badge' },
      { key: 'title', kind: 'inline', label: 'Title' },
      { key: 'sub', kind: 'inline', label: 'Subtitle' },
      { key: 'ctaHref', kind: 'url', label: 'Button link' },
      { key: 'ctaLabel', kind: 'inline', label: 'Button label' },
    ],
    item: null,
  },
  capabilities: {
    label: 'Capabilities',
    fields: headerFields(),
    item: { label: 'Card', fields: [
      { key: 'num', kind: 'text', label: 'Number' },
      { key: 'title', kind: 'inline', label: 'Title' },
      { key: 'desc', kind: 'inline', label: 'Description' },
    ] },
  },
  deliverables: {
    label: "What's included",
    fields: [...headerFields(), { key: 'intro1', kind: 'inline', label: 'Intro paragraph 1' }, { key: 'intro2', kind: 'inline', label: 'Intro paragraph 2' }],
    item: { label: 'Deliverable', fields: [
      { key: 'title', kind: 'inline', label: 'Title' },
      { key: 'desc', kind: 'inline', label: 'Description' },
      { key: 'freq', kind: 'text', label: 'Cadence' },
    ] },
  },
  approach: {
    label: 'Approach',
    fields: headerFields(),
    item: { label: 'Step', fields: [
      { key: 'num', kind: 'text', label: 'Number' },
      { key: 'label', kind: 'inline', label: 'Label' },
      { key: 'title', kind: 'inline', label: 'Title' },
      { key: 'desc', kind: 'inline', label: 'Description' },
    ] },
  },
  tiers: {
    label: 'Pricing',
    fields: headerFields(),
    item: { label: 'Tier', fields: [
      { key: 'featured', kind: 'bool', label: 'Highlighted' },
      { key: 'name', kind: 'inline', label: 'Name' },
      { key: 'tagline', kind: 'inline', label: 'Tagline' },
      { key: 'for', kind: 'inline', label: 'For' },
      { key: 'timeline', kind: 'inline', label: 'Timeline' },
      { key: 'includes', kind: 'inline-list', label: 'Includes (one per line)' },
      { key: 'ctaHref', kind: 'url', label: 'Button link' },
      { key: 'ctaLabel', kind: 'inline', label: 'Button label' },
    ] },
  },
  testimonials: {
    label: 'Testimonials',
    fields: headerFields(),
    item: { label: 'Quote', fields: [
      { key: 'quote', kind: 'inline', label: 'Quote' },
      { key: 'avatar', kind: 'text', label: 'Avatar initials' },
      { key: 'name', kind: 'inline', label: 'Name' },
      { key: 'role', kind: 'inline', label: 'Role' },
    ] },
  },
  faq: {
    label: 'FAQ',
    fields: headerFields(),
    item: { label: 'Question', fields: [
      { key: 'q', kind: 'inline', label: 'Question' },
      { key: 'a', kind: 'inline', label: 'Answer' },
    ] },
  },
  finalCta: {
    label: 'Final CTA',
    fields: [
      { key: 'eyebrow', kind: 'inline', label: 'Eyebrow' },
      { key: 'title', kind: 'inline', label: 'Title' },
      { key: 'sub', kind: 'inline', label: 'Subtitle' },
      { key: 'ctaHref', kind: 'url', label: 'Button link' },
      { key: 'ctaLabel', kind: 'inline', label: 'Button label' },
    ],
    item: null,
  },
};

function headerFields() {
  return [
    { key: 'eyebrow', kind: 'inline', label: 'Eyebrow' },
    { key: 'title', kind: 'inline', label: 'Title' },
    { key: 'sub', kind: 'inline', label: 'Subtitle' },
  ];
}

/** kind lookup for a composed page: (sectionType, fieldKey) -> kind. Used by the write
 *  path so a composed page's fields are sanitized by their real kind, not defaulted. */
export function composedFieldKind(sectionType, fieldKey) {
  const spec = SECTION_FIELDS[sectionType];
  if (!spec) return 'inline';
  const inFields = spec.fields.find((f) => f.key === fieldKey);
  if (inFields) return inFields.kind;
  const inItem = spec.item?.fields.find((f) => f.key === fieldKey);
  return inItem ? inItem.kind : 'inline';
}
