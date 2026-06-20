// src/components/auth/ChelysLogin.tsx
import type React from 'react';
import { useState } from 'react';

import { t } from '@/i18n';
import { useRoom } from '../../hooks/useRoom';
import PasteField from '../common/PasteField';
import ThemeToggle from '../settings/ThemeToggle';
import { openExternalUrl } from '../../utils/platformUtils';

function handleExternalLink(event: React.MouseEvent<HTMLAnchorElement>) {
	event.preventDefault();
	openExternalUrl(event.currentTarget.href);
}

const ChelysLogin: React.FC = () => {
	const { login } = useRoom();
	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	const [prfHex, setPrfHex] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);

	const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
		e.preventDefault();
		if (!username || !password || !prfHex) {
			setError(t('Please enter username, password, and Chelys key'));
			return;
		}
		setError(null);
		setIsLoading(true);
		try {
			await login(username, password, prfHex);
		} catch (error) {
			setError(error instanceof Error ? error.message : t('Login failed'));
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className='auth-container'>
			<div className='auth-box'>
				<div className='auth-header'>
					<div className='auth-logo-wrapper'>
						<img src='/chelys-logo.svg' className='auth-logo' alt={t('Chelys logo')} />
					</div>
					<h1>{t('Chelys')}</h1>
					<div className='auth-header-controls'>
						<ThemeToggle className='auth-theme-toggle' />
					</div>
				</div>

				<div className='auth-form-container'>
					<h2>{t('Log in to Chelys')}</h2>
					{error && <div className='auth-error'>{error}</div>}
					<form onSubmit={handleSubmit} className='auth-form'>
						<div className='form-group'>
							<label htmlFor='username'>{t('Username')}</label>
							<input
								type='text'
								id='username'
								value={username}
								onChange={(e) => setUsername(e.target.value)}
								disabled={isLoading}
								autoComplete='username'
							/>
						</div>
						<div className='form-group'>
							<label htmlFor='password'>{t('Password')}</label>
							<input
								type='password'
								id='password'
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								disabled={isLoading}
								autoComplete='current-password'
							/>
						</div>
						<div className='form-group'>
							<PasteField
								label={t('Chelys key (PRF output)')}
								id='prf'
								value={prfHex}
								onChange={setPrfHex}
								mono
								disabled={isLoading}
							/>
						</div>
						<button
							type='submit'
							className={`auth-button ${isLoading ? 'loading' : ''}`}
							disabled={isLoading}
						>
							{isLoading ? t('Logging in...') : t('Log in')}
						</button>
					</form>
				</div>
			</div >

			<footer>
				<p className='texlyre-info'>
					<span className='footer-links'>
						<a href='https://texlyre.org' onClick={handleExternalLink}>
							{t('TeXlyre')}
						</a>{' '}
						•{' '}
						<a
							href='https://github.com/TeXlyre/chelys'
							onClick={handleExternalLink}
						>
							{t('Source Code')}
						</a>{' '}
						•{' '}
						<a
							href='https://github.com/TeXlyre/chelys/releases'
							onClick={handleExternalLink}
						>
							{t('Chelys Releases')}
						</a>{' '}
						{`v${__APP_VERSION__}`}
					</span>
				</p>
			</footer>
		</div >
	);
};

export default ChelysLogin;
