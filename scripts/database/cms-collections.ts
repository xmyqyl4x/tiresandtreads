import type { CollectionConfig, Field } from 'payload';

// Storage definitions only. Verified staff authentication and editorial services are later cards.
const denied = () => false;
const access = {
  read: denied,
  create: denied,
  update: denied,
  delete: denied,
  readVersions: denied,
};
const text = (name: string, required = true, maxLength = 200): Field => ({
  name,
  type: 'text',
  required,
  maxLength,
});
const integer = (name: string, defaultValue = 1): Field => ({
  name,
  type: 'number',
  required: true,
  defaultValue,
  min: defaultValue === 0 ? 0 : 1,
});
const json = (name: string): Field => ({ name, type: 'json', required: true });
const common = (): Field[] => [
  text('contentKey'),
  text('locale', true, 35),
  text('market', true, 16),
  integer('revision'),
  integer('schemaVersion'),
  text('title', true, 300),
  {
    name: 'reviewStatus',
    type: 'select',
    required: true,
    defaultValue: 'draft',
    options: ['draft', 'review', 'approved', 'rejected'],
  },
  text('sourceUrl', false, 2048),
  { name: 'reviewer', type: 'relationship', relationTo: 'cms-staff' },
  { name: 'reviewedAt', type: 'date' },
  { name: 'expiresAt', type: 'date' },
];
const editorial = (slug: string, fields: Field[]): CollectionConfig => ({
  slug,
  access,
  admin: { hidden: true },
  versions: { drafts: true, maxPerDoc: 20 },
  indexes: [{ fields: ['contentKey', 'locale', 'market'], unique: true }],
  fields: [...common(), ...fields],
});
const collectionSlugs = [
  'articles',
  'glossary-terms',
  'topics',
  'explanation-templates',
  'media',
  'seo-metadata',
  'redirects',
];

export const editorialCollections: CollectionConfig[] = [
  editorial('articles', [
    json('body'),
    { name: 'topics', type: 'relationship', relationTo: 'topics', hasMany: true },
  ]),
  editorial('glossary-terms', [
    json('definition'),
    { name: 'topics', type: 'relationship', relationTo: 'topics', hasMany: true },
  ]),
  editorial('topics', [
    text('description', true, 2000),
    { name: 'parent', type: 'relationship', relationTo: 'topics' },
  ]),
  editorial('explanation-templates', [text('reasonCode'), json('template')]),
  // Metadata only: private/public object handling and upload sanitation are later services.
  editorial('media', [
    text('objectAssetId', true, 36),
    text('altText', true, 1000),
    json('rights'),
    text('mimeType', true, 100),
  ]),
  editorial('seo-metadata', [
    text('publicPath', true, 500),
    text('canonicalPath', true, 500),
    text('description', true, 500),
    json('structuredData'),
  ]),
  editorial('redirects', [
    text('sourcePath', true, 500),
    text('targetPath', false, 500),
    {
      name: 'redirectCode',
      type: 'select',
      required: true,
      defaultValue: '301',
      options: ['301', '302', '410'],
    },
    integer('priority', 0),
    {
      name: 'redirectStatus',
      type: 'select',
      required: true,
      defaultValue: 'disabled',
      options: ['disabled', 'reviewed', 'active'],
    },
    {
      name: 'validationResult',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: ['pending', 'passed', 'failed'],
    },
  ]),
  {
    slug: 'editorial-reviews',
    access,
    admin: { hidden: true },
    indexes: [
      { fields: ['collectionSlug', 'documentId', 'contentRevision', 'reviewer'], unique: true },
    ],
    fields: [
      { name: 'collectionSlug', type: 'select', required: true, options: collectionSlugs },
      text('documentId', true, 36),
      integer('contentRevision'),
      { name: 'reviewer', type: 'relationship', relationTo: 'cms-staff', required: true },
      { name: 'result', type: 'select', required: true, options: ['approved', 'rejected'] },
      text('reasonCode'),
      { name: 'reviewedAt', type: 'date', required: true },
    ],
  },
  {
    slug: 'publication-work',
    access,
    admin: { hidden: true },
    indexes: [{ fields: ['collectionSlug', 'documentId', 'contentRevision'], unique: true }],
    fields: [
      { name: 'collectionSlug', type: 'select', required: true, options: collectionSlugs },
      text('documentId', true, 36),
      integer('contentRevision'),
      { name: 'eventId', type: 'text', required: true, unique: true, maxLength: 36 },
      json('publicDto'),
      integer('schemaVersion'),
      {
        name: 'state',
        type: 'select',
        required: true,
        defaultValue: 'pending',
        options: ['pending', 'leased', 'published', 'failed', 'cancelled'],
      },
      integer('attempts', 0),
      integer('leaseGeneration', 0),
      text('leaseToken', false, 36),
      { name: 'leaseUntil', type: 'date' },
      { name: 'nextAttemptAt', type: 'date' },
      { name: 'publishedAt', type: 'date' },
      text('lastErrorCode', false, 100),
    ],
  },
];
