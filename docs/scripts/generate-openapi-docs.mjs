import { generateFiles } from 'fumadocs-openapi';
import { createOpenAPI } from 'fumadocs-openapi/server';

const openapi = createOpenAPI({
  input: ['./public/openapi.json'],
});

void generateFiles({
  input: openapi,
  output: './content/api-reference',
  includeDescription: true,
});
