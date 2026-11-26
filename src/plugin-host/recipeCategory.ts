// src/plugin-host/recipeCategory.ts
export function normalizeRecipeCategory(value: unknown): string | undefined {
	return typeof value === 'string' ? value.trim() || undefined : undefined;
}

export function recipeCategory(
	recipe: { type: string; category?: string },
	typeLabel: (type: string) => string,
): string {
	return normalizeRecipeCategory(recipe.category) ?? typeLabel(recipe.type);
}
