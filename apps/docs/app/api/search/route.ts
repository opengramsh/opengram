import { docsSource, apiSource } from '@/lib/source';
import { createSearchAPI } from 'fumadocs-core/search/server';
import type { StructuredData } from 'fumadocs-core/mdx-plugins';

const emptyStructuredData: StructuredData = {
  headings: [],
  contents: [],
};

async function getStructuredData(page: {
  data: {
    structuredData?: StructuredData;
    load?: () => Promise<{ structuredData?: StructuredData }>;
  };
}): Promise<StructuredData> {
  if (page.data.structuredData) {
    return page.data.structuredData;
  }

  if (typeof page.data.load === 'function') {
    const loaded = await page.data.load();
    if (loaded?.structuredData) {
      return loaded.structuredData;
    }
  }

  return emptyStructuredData;
}

export const { GET } = createSearchAPI('advanced', {
  indexes: async () =>
    Promise.all(
      [...docsSource.getPages(), ...apiSource.getPages()].map(async (page) => ({
        title: page.data.title,
        description: page.data.description,
        url: page.url,
        id: page.url,
        structuredData: await getStructuredData(page),
      })),
    ),
});
