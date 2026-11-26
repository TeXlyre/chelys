// src/components/settings/SettingControl.tsx
import type React from 'react';
import { useId } from 'react';

import { t } from '@/i18n';
import type { Setting } from '../../contexts/SettingsContext';

interface SettingControlProps {
	setting: Setting & {
		label: React.ReactNode;
		description?: React.ReactNode;
	};
	onLocalUpdate?: (value: unknown) => void;
}

const SettingControl: React.FC<SettingControlProps> = ({
	setting,
	onLocalUpdate,
}) => {
	const value =
		setting.value !== undefined ? setting.value : setting.defaultValue;
	const disabled = Boolean(setting.disabled);
	const controlId = useId();

	const handleChange = (newValue: unknown) => {
		if (disabled) return;
		onLocalUpdate?.(newValue);
	};

	const renderControl = () => {
		switch (setting.type) {
			case 'checkbox':
				return (
					<label className='checkbox-control'>
						<input
							type='checkbox'
							checked={Boolean(value)}
							disabled={disabled}
							onChange={(e) => handleChange(e.target.checked)}
						/>
						<span>{setting.label}</span>
					</label>
				);

			case 'select':
				return (
					<div className='select-control ui-field' data-gap='xs'>
						<label htmlFor={controlId}>{setting.label}</label>
						<select
							id={controlId}
							value={String(value)}
							disabled={disabled}
							onChange={(e) => handleChange(e.target.value)}
						>
							{setting.options?.map((option) => (
								<option key={String(option.value)} value={String(option.value)}>
									{option.label}
								</option>
							))}
						</select>
					</div>
				);

			case 'text':
				return (
					<div className='text-control ui-field' data-gap='xs'>
						<label htmlFor={controlId}>{setting.label}</label>
						<input
							id={controlId}
							type='text'
							value={String(value)}
							dir='ltr'
							disabled={disabled}
							onChange={(e) => handleChange(e.target.value)}
						/>
					</div>
				);

			case 'number':
				return (
					<div className='number-control ui-field' data-gap='xs'>
						<label htmlFor={controlId}>{setting.label}</label>
						<input
							id={controlId}
							type='number'
							value={Number(value)}
							min={setting.min}
							max={setting.max}
							step={setting.step}
							disabled={disabled}
							onChange={(e) => handleChange(Number(e.target.value))}
						/>
					</div>
				);

			case 'color':
				return (
					<div className='color-control ui-field' data-gap='xs'>
						<label htmlFor={controlId}>{setting.label}</label>
						<input
							id={controlId}
							type='color'
							value={String(value)}
							disabled={disabled}
							onChange={(e) => handleChange(e.target.value)}
						/>
					</div>
				);

			default:
				return (
					<div>
						{t('Unsupported setting type:')}
						{setting.type}
					</div>
				);
		}
	};

	return (
		<div className={`setting-control${disabled ? ' disabled' : ''}`}>
			{renderControl()}
			{disabled && setting.disabledReason && (
				<div className='setting-dependency-badge'>{setting.disabledReason}</div>
			)}
			{setting.description && (
				<div className='setting-description ui-field-hint'>{setting.description}</div>
			)}
		</div>
	);
};

export default SettingControl;
