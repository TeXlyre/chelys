// src/components/profile/ProfileModal.tsx
import type React from 'react';
import { useState } from 'react';

import { t } from '@/i18n';
import { useRoom } from '../../hooks/useRoom';
import Modal from '../common/Modal';
import { UserIcon } from '../common/Icons';
import AccountIdentitySection from './AccountIdentitySection';
import LocalStorageDataSection from './LocalStorageDataSection';

interface ProfileModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const ProfileModal: React.FC<ProfileModalProps> = ({ isOpen, onClose }) => {
    const { identity } = useRoom();
    const [tab, setTab] = useState<'account' | 'data'>('account');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={t('Account Settings')}
            icon={UserIcon}
            size='large'
        >
            <div className='view-tabs'>
                <button
                    className={`tab-button ${tab === 'account' ? 'active' : ''}`}
                    onClick={() => setTab('account')}
                >
                    {t('Account')}
                </button>
                <button
                    className={`tab-button ${tab === 'data' ? 'active' : ''}`}
                    onClick={() => setTab('data')}
                >
                    {t('Data')}
                </button>

            </div>

            <br />

            {error && <div className='error-message'>{error}</div>}
            {success && <div className='success-message'>{success}</div>}

            {tab === 'account' ? (
                <AccountIdentitySection
                    isSubmitting={isSubmitting}
                    setIsSubmitting={setIsSubmitting}
                    onError={setError}
                    onSuccess={setSuccess}
                />
            ) : (
                identity && (
                    <LocalStorageDataSection
                        userId={identity.roomId}
                        isSubmitting={isSubmitting}
                        setIsSubmitting={setIsSubmitting}
                        onError={setError}
                        onSuccess={setSuccess}
                    />
                )
            )}
        </Modal>
    );
};

export default ProfileModal;
