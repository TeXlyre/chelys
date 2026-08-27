// src/plugin-host/recipeIcon.ts
import type { Recipe } from './types';

const scopePrefix = (markup: string): string => {
	let hash = 0x811c9dc5;
	for (let index = 0; index < markup.length; index++) {
		hash ^= markup.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return `i${(hash >>> 0).toString(36)}`;
};

const scopeIds = (root: DocumentFragment, prefix: string): void => {
	const ids = new Map<string, string>();

	for (const element of root.querySelectorAll('[id]')) {
		const id = element.getAttribute('id');
		if (!id) continue;
		ids.set(id, `${prefix}-${id}`);
		element.setAttribute('id', `${prefix}-${id}`);
	}

	if (ids.size === 0) return;

	for (const element of root.querySelectorAll('*')) {
		for (const attribute of Array.from(element.attributes)) {
			if (attribute.name === 'id') continue;

			const direct = attribute.value.startsWith('#')
				? ids.get(attribute.value.slice(1))
				: undefined;

			const value = direct
				? `#${direct}`
				: attribute.value.replace(
						/url\(\s*#([^)\s'"]+)\s*\)/g,
						(match, id: string) =>
							ids.has(id) ? `url(#${ids.get(id)})` : match,
					);

			if (value !== attribute.value)
				element.setAttribute(attribute.name, value);
		}
	}
};

export function sanitizeIconMarkup(markup: string): string {
	const template = document.createElement('template');
	template.innerHTML = markup;

	for (const element of template.content.querySelectorAll('style, script')) {
		element.remove();
	}

	for (const element of template.content.querySelectorAll('*')) {
		for (const attribute of Array.from(element.attributes)) {
			if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
		}
	}

	scopeIds(template.content, scopePrefix(markup));

	const svg = template.content.querySelector('svg');
	if (svg && !svg.hasAttribute('fill')) {
		svg.setAttribute('fill', 'currentColor');
	}

	return template.innerHTML;
}

export function withSanitizedIcon(recipe: Recipe): Recipe {
	return recipe.icon
		? { ...recipe, icon: sanitizeIconMarkup(recipe.icon) }
		: recipe;
}
