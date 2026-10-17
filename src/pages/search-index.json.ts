import { getCollection } from 'astro:content';

export const prerender = true;

export async function GET() {
	const posts = await getCollection('blog', ({ data }) => !data.draft);
	const searchIndex = posts.map((post) => {
		const heroImg = post.data.heroImage;
		let heroImageUrl = '';
		if (heroImg) {
			if (typeof heroImg === 'string') {
				heroImageUrl = heroImg;
			} else if (typeof heroImg === 'object' && heroImg.src) {
				heroImageUrl = heroImg.src;
			}
		}

		return {
			id: post.id,
			title: post.data.title,
			description: post.data.description || '',
			categories: post.data.categories || [],
			pubDate: post.data.pubDate ? new Date(post.data.pubDate).toISOString().split('T')[0] : '',
			heroImage: heroImageUrl,
			url: `/blog/${post.id}/`,
		};
	});

	return new Response(JSON.stringify(searchIndex), {
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
		},
	});
}