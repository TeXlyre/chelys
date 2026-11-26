// src/components/profile/InfrastructureSharingSection.tsx
import { useEffect, useState } from 'react';
import { localCommand } from '../../control/localClient';
import type { ShareMode } from '../../control/sharing';

interface Field {
	id: string;
	label: string;
	sensitivity: 'low' | 'medium' | 'high';
}
interface ShareInfo {
	id: string;
	mode: ShareMode;
	fields: string[];
	availableFields: Field[];
}
interface InspectableRecipe {
	id: string;
	name: string;
	inspectable?: boolean;
}

export default function InfrastructureSharingSection() {
	const [recipes, setRecipes] = useState<InspectableRecipe[]>([]);
	const [selected, setSelected] = useState('');
	const [share, setShare] = useState<ShareInfo | null>(null);
	const [mode, setMode] = useState<ShareMode>('disabled');
	const [fields, setFields] = useState<string[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [message, setMessage] = useState('');

	useEffect(() => {
		let alive = true;
		void localCommand('recipes.list')
			.then((items) => {
				if (!alive) return;
				const available = (items as InspectableRecipe[]).filter(
					(item) => item.inspectable,
				);
				setRecipes(available);
				setSelected((previous) => previous || available[0]?.id || '');
			})
			.catch((caught) => {
				if (alive) setError(String(caught));
			});
		return () => {
			alive = false;
		};
	}, []);
	useEffect(() => {
		if (!selected) {
			setShare(null);
			return;
		}
		let alive = true;
		void localCommand('recipes.share.show', { id: selected })
			.then((result) => {
				if (!alive) return;
				const value = result as ShareInfo;
				setShare(value);
				setMode(value.mode);
				setFields(value.fields);
				setMessage('');
			})
			.catch((caught) => {
				if (alive) setError(String(caught));
			});
		return () => {
			alive = false;
		};
	}, [selected]);
	const save = async () => {
		setBusy(true);
		setError('');
		setMessage('');
		try {
			await localCommand('recipes.share.set', { id: selected, mode, fields });
			setMessage('Sharing policy saved');
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(false);
		}
	};

	return (
		<section className='control-sharing ui-stack' data-gap='sm'>
			<h3>Infrastructure inspection sharing</h3>
			<p className='field-hint'>
				All telemetry stays private until you explicitly allow specific
				categories. These settings control information leaving this instance;
				they do not grant permission to install, run or edit infrastructure
				recipes. Energy sensors and process details may disclose sensitive
				machine information.
			</p>
			{recipes.length === 0 ? (
				<p className='field-hint'>No recipes currently support inspection.</p>
			) : (
				<>
					<div className='form-group ui-field'>
						<label htmlFor='chelys-inspection-recipe'>Recipe</label>
						<select
							id='chelys-inspection-recipe'
							value={selected}
							onChange={(event) => setSelected(event.target.value)}
						>
							{recipes.map((recipe) => (
								<option key={recipe.id} value={recipe.id}>
									{recipe.name}
								</option>
							))}
						</select>
					</div>
					{share && (
						<>
							<fieldset className='control-access-modes'>
								<legend>Who can inspect these metrics?</legend>
								{(
									[
										[
											'disabled',
											'Only this instance',
											'No telemetry leaves this instance.',
										],
										[
											'peers',
											'Verified account peers',
											'Requires incoming access mode “All connected peers”.',
										],
										[
											'keys',
											'API keys only',
											'Requires incoming API-key mode and recipes.telemetry.read permission.',
										],
									] as const
								).map(([value, label, hint]) => (
									<label key={value} className='control-access-mode'>
										<input
											type='radio'
											name='inspection-share-mode'
											checked={mode === value}
											disabled={busy}
											onChange={() => setMode(value)}
										/>
										<span>
											<strong>{label}</strong>
											<small>{hint}</small>
										</span>
									</label>
								))}
							</fieldset>
							<fieldset className='control-access-permissions'>
								<legend>Allowed measurement categories</legend>
								{share.availableFields.map((field) => (
									<label key={field.id}>
										<input
											type='checkbox'
											checked={fields.includes(field.id)}
											disabled={busy}
											onChange={(event) =>
												setFields((current) =>
													event.target.checked
														? [...current, field.id]
														: current.filter((id) => id !== field.id),
												)
											}
										/>
										<span>
											{field.label}{' '}
											<small>({field.sensitivity} sensitivity)</small>
										</span>
									</label>
								))}
							</fieldset>
							<div className='modal-actions'>
								<button
									className='button primary'
									type='button'
									disabled={
										busy || (mode !== 'disabled' && fields.length === 0)
									}
									onClick={() => void save()}
								>
									Save sharing policy
								</button>
							</div>
						</>
					)}
				</>
			)}
			{error && (
				<p className='error-message' role='alert'>
					{error}
				</p>
			)}
			{message && (
				<p className='success-message' role='status'>
					{message}
				</p>
			)}
		</section>
	);
}
