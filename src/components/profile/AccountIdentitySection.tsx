// src/components/profile/AccountIdentitySection.tsx
import type React from 'react';
import { useEffect, useState } from 'react';

import { t } from '@/i18n';
import { useRoom } from '../../hooks/useRoom';
import CopyField from '../common/CopyField';
import PasteField from '../common/PasteField';

interface AccountIdentitySectionProps {
    isSubmitting: boolean;
    setIsSubmitting: (value: boolean) => void;
    onError: (message: string) => void;
    onSuccess: (message: string) => void;
}

const AccountIdentitySection: React.FC<AccountIdentitySectionProps> = ({
    isSubmitting,
    setIsSubmitting,
    onError,
    onSuccess,
}) => {
    const { username, credentials, updateCredentials } = useRoom();

    const [newUsername, setNewUsername] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [prfHex, setPrfHex] = useState('');

    useEffect(() => {
        setNewUsername(username);
        setPrfHex(credentials?.prfHex ?? '');
    }, [username, credentials]);

    const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!credentials) return;

        if (newPassword && newPassword !== confirmPassword) {
            onError(t('New passwords do not match'));
            return;
        }
        if (!prfHex.trim()) {
            onError(t('Chelys key is required'));
            return;
        }

        setIsSubmitting(true);
        onError('');
        try {
            await updateCredentials({
                username: newUsername,
                password: newPassword || credentials.password,
                prfHex: prfHex.trim().toLowerCase(),
            });
            onSuccess(t('Account updated successfully'));
            setNewPassword('');
            setConfirmPassword('');
        } catch (error) {
            onError(error instanceof Error ? error.message : t('An error occurred'));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className='profile-form'>
            <div className='form-group'>
                <label htmlFor='profile-username'>{t('Username')}</label>
                <input
                    type='text'
                    id='profile-username'
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    disabled={isSubmitting}
                    autoComplete='username'
                />
            </div>

            <h3>{t('Change Password')}</h3>
            <div className='form-group'>
                <label htmlFor='profile-new-password'>{t('New Password')}</label>
                <input
                    type='password'
                    id='profile-new-password'
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={isSubmitting}
                    autoComplete='new-password'
                />
            </div>
            <div className='form-group'>
                <label htmlFor='profile-confirm-password'>
                    {t('Confirm New Password')}
                </label>
                <input
                    type='password'
                    id='profile-confirm-password'
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={isSubmitting}
                    autoComplete='new-password'
                />
            </div>
            <h3>{t('Chelys Key (PRF output)')}</h3>

            <div className='form-group'>
                <PasteField
                    label={t('Replace key')}
                    id='profile-prf'
                    value={prfHex}
                    onChange={setPrfHex}
                    mono
                    disabled={isSubmitting}
                />
            </div>
            <CopyField
                label={t('Current key')}
                id='profile-current-prf'
                value={credentials?.prfHex ?? ''}
                mono
            />
            <div className='warning-message'>
                <p>
                    {t(
                        'Changing your username, password, or Chelys key re-derives your room. Synced data is tied to the derived room, so the new identity will start from the data stored under that room.',
                    )}
                </p>
            </div>

            <div className='modal-actions'>
                <button
                    type='submit'
                    className='button primary'
                    disabled={isSubmitting}
                >
                    {isSubmitting ? t('Saving...') : t('Save Changes')}
                </button>
            </div>
        </form>
    );
};

export default AccountIdentitySection;
