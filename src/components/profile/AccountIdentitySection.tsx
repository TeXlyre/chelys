// src/components/profile/AccountIdentitySection.tsx
import type React from 'react';
import { useEffect, useState } from 'react';
import { toHex } from '@chelys/protocol';

import { t } from '@/i18n';
import { useRoom } from '../../hooks/useRoom';
import CopyField from '../common/CopyField';
import PasteField from '../common/PasteField';
import { getStoredSetting } from '../../config';

interface AccountIdentitySectionProps {
    isSubmitting: boolean;
    setIsSubmitting: (value: boolean) => void;
    onError: (message: string) => void;
    onSuccess: (message: string) => void;
}

const buildTexlyreLink = (prfHex: string): string => {
    const base = getStoredSetting<string>('texlyreBaseUrl').replace(/\/+$/, '');
    return `${base}/#tempPrf:${prfHex}`;
};

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
    const [rotatedKey, setRotatedKey] = useState(false);

    useEffect(() => {
        setNewUsername(username);
        setPrfHex(credentials?.prfHex ?? '');
        setRotatedKey(false);
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
            setRotatedKey(false);
        } catch (error) {
            onError(error instanceof Error ? error.message : t('An error occurred'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const rotateKey = () => {
        const key = crypto.getRandomValues(new Uint8Array(32));
        setPrfHex(toHex(key));
        setRotatedKey(true);
    };

    const savedPrfHex = credentials?.prfHex ?? '';
    const pendingPrfHex = prfHex.trim().toLowerCase();
    const keyChanged = pendingPrfHex !== savedPrfHex;

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

            <h3>{t('Connect TeXlyre')}</h3>
            <p className='field-hint'>
                {t('Open this link in a TeXlyre browser tab and log in with the same username and password to join this room. The link should be kept secret.')}
            </p>
            <CopyField
                label={t('TeXlyre session link')}
                id='texlyre-session-link'
                value={buildTexlyreLink(savedPrfHex)}
                mono
            />

            <h3>{t('Chelys Key (PRF output)')}</h3>
            <p className='field-hint'>
                {t('Your key selects which room you sync with. Keep it to stay in the same room, paste a key to match another account, or generate new key to create a temporary session.')}
            </p>
            <div className='form-group'>
                <PasteField
                    label={t('Replace key')}
                    id='profile-prf'
                    value={prfHex}
                    onChange={(value) => {
                        setPrfHex(value);
                        setRotatedKey(false);
                    }}
                    mono
                    disabled={isSubmitting}
                />
            </div>
            <div className='form-group'>
                <button
                    type='button'
                    className='button secondary'
                    onClick={rotateKey}
                    disabled={isSubmitting}
                >
                    {t('Generate New Key')}
                </button>
            </div>

            {keyChanged && (
                <div className='warning-message'>
                    <p>
                        {rotatedKey
                            ? t('A new key was generated but not saved yet. Saving switches you to an empty new room and leaves your current room the same.')
                            : t('This key differs from your current one. Saving re-derives your room, so synced data will start from whatever is stored under the new room.')}
                    </p>
                    <CopyField
                        label={t('New TeXlyre link (after saving)')}
                        id='texlyre-session-link-pending'
                        value={buildTexlyreLink(pendingPrfHex)}
                        mono
                    />
                </div>
            )}

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
