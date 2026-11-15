import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema, i18nSchema } from "@astrojs/starlight/schema";
import { defineCollection } from "astro:content";

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  // English only. Starlight reads this collection for its UI strings; one
  // empty entry keeps the built-in strings without a src/content/i18n folder.
  i18n: defineCollection({ loader: () => [{ id: "en" }], schema: i18nSchema() }),
};
