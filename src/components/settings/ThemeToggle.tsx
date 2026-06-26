// src/components/app/ThemeToggle.tsx
import type React from "react";
import { useState } from "react";

import { t } from "@/i18n";
import { MoonIcon, SunIcon } from "../common/Icons";
import {
	type ThemeVariant,
	getInitialVariant,
	setThemeVariant,
} from "../../theme/themeVariant";

interface ThemeToggleProps {
	className?: string;
}

const ThemeToggle: React.FC<ThemeToggleProps> = ({ className = "" }) => {
	const [variant, setVariant] = useState<ThemeVariant>(getInitialVariant());
	const isDark = variant === "dark";

	const toggle = () => {
		const next: ThemeVariant = isDark ? "light" : "dark";
		setVariant(next);
		setThemeVariant(next);
	};

	return (
		<button
			className={className}
			onClick={toggle}
			title={t("Switch to {theme}", {
				theme: isDark ? t("Light Theme") : t("Dark Theme"),
			})}
		>
			{isDark ? <MoonIcon /> : <SunIcon />}
		</button>
	);
};

export default ThemeToggle;