// src/hooks/useThemeVariant.ts
import { useEffect, useState } from 'react';

import { type ThemeVariant } from '../theme/themeVariant';

const appliedVariant = (): ThemeVariant =>
	document.documentElement.getAttribute('data-theme-mode') === 'dark'
		? 'dark'
		: 'light';

export function useThemeVariant(): ThemeVariant {
	const [variant, setVariant] = useState<ThemeVariant>(() => {
		return appliedVariant();
	});

	useEffect(() => {
		const root = document.documentElement;
		const update = () => setVariant(appliedVariant());
		const observer = new MutationObserver(update);

		observer.observe(root, {
			attributes: true,
			attributeFilter: ['data-theme', 'data-theme-mode'],
		});
		update();

		return () => observer.disconnect();
	}, []);

	return variant;
}
