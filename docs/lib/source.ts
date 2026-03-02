import { docs, apiDocs } from 'fumadocs-mdx:collections/server';
import { loader } from 'fumadocs-core/source';
import { openapiPlugin } from 'fumadocs-openapi/server';

export const docsSource = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
});

export const apiSource = loader({
  baseUrl: '/api-reference',
  source: apiDocs.toFumadocsSource(),
  plugins: [openapiPlugin()],
});
