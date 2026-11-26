// src/components/common/PasteField.tsx
import type React from 'react';
import { useState } from 'react';

import { t } from '@/i18n';
import { readClipboardText } from '../../utils/platformUtils';
import { PasteIcon } from './Icons';

interface PasteFieldProps {
	value: string;
	onChange: (value: string) => void;
	label?: string;
	id?: string;
	mono?: boolean;
	icon?: React.ReactNode;
	idleLabel?: string;
	pastedLabel?: string;
	errorLabel?: string;
	disabled?: boolean;
	autoComplete?: string;
}

const PasteField: React.FC<PasteFieldProps> = ({
	value,
	onChange,
	label,
	id,
	mono = false,
	icon = <PasteIcon />,
	idleLabel = t('Paste'),
	pastedLabel = t('Pasted!'),
	errorLabel = t('Failed to paste'),
	disabled = false,
	autoComplete,
}) => {
	const [status, setStatus] = useState<'idle' | 'pasted' | 'error'>('idle');

	const handlePaste = async () => {
		try {
			const text = await readClipboardText();
			onChange(text.trim());
			setStatus('pasted');
			setTimeout(() => setStatus('idle'), 2000);
		} catch (error) {
			console.error('Failed to read from clipboard:', error);
			setStatus('error');
			setTimeout(() => setStatus('idle'), 2000);
		}
	};

	const buttonLabel =
		status === 'pasted'
			? pastedLabel
			: status === 'error'
				? errorLabel
				: idleLabel;

	return (
		<div className='ui-field'>
			{label && <label htmlFor={id}>{label}</label>}
			<div className='ui-control-cluster'>
				<input
					id={id}
					type='text'
					value={value}
					onChange={(e) => onChange(e.target.value)}
					className='ui-field-control'
					data-font={mono ? 'mono' : undefined}
					disabled={disabled}
					autoComplete={autoComplete}
				/>
				<button
					type='button'
					onClick={handlePaste}
					className='button'
					data-nowrap='true'
					disabled={disabled}
				>
					{icon}
					<span>{buttonLabel}</span>
				</button>
			</div>
		</div>
	);
};

export default PasteField;
