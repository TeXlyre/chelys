import type React from 'react';
import { t } from '@/i18n';
import { getActiveAccountId } from '../../plugin-host/activeAccount';
import { useSettings } from '../../hooks/useSettings';
import { useThemeVariant } from '../../hooks/useThemeVariant';
import { nextThemeVariant, setThemeVariant } from '../../theme/themeVariant';
import { MoonIcon, SunIcon } from '../common/Icons';

const ThemeToggle: React.FC<{ className?: string }> = ({ className = '' }) => {
	const mode = useThemeVariant();
	const { getSetting, updateSetting } = useSettings();
	const next = nextThemeVariant(mode);
	const toggle = () => {
		if (getActiveAccountId() && getSetting('themeVariant')) {
			updateSetting('themeVariant', next);
		} else {
			setThemeVariant(next);
		}
	};
	const title = t('Switch to {theme}', { theme: next.replaceAll('_', ' ') });
	return (
		<button
			type='button'
			className={`${className} ui-icon-button`}
			data-variant='subtle'
			onClick={toggle}
			title={title}
			aria-label={title}
		>
			{mode === 'dark' ? <SunIcon /> : <MoonIcon />}
		</button>
	);
};
export default ThemeToggle;
