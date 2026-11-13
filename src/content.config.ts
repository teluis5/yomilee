import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
	// Load Markdown and MDX files in the `src/content/blog/` directory.
	loader: glob({ base: './src/content/blog', pattern: [
		'**/*.{md,mdx}',
		'!2026-11-11-open-web-yahoo-06b6bb/**',
		'!2026-11-11-open-yahoo-810192/**',
		'!2026-11-11-open-miranest-cafe-dcc31d/**',
		'!2026-11-11-open-store-0f4222/**',
		'!2026-11-11-open-cearvol-liberte-d28ffd/**',
		'!2026-11-13-open-tokyo-bay-popup-af1ba2/**',
		'!2026-11-13-open-new-open-new-541c5b/**',
	] }),
	// Type-check frontmatter using a schema
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			description: z.string(),
			// Transform string to Date object
			pubDate: z.coerce.date(),
			updatedDate: z.coerce.date().optional(),
			heroImage: z.optional(image()),
			categories: z.array(z.string()).optional(),
			draft: z.boolean().optional(),
		}),
});

export const collections = { blog };
