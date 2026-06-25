// src/components/profile/LocalStorageDataSection.tsx
import type React from 'react';
import { useState } from 'react';

import { t } from '@/i18n';
import {
    type UserDataType,
    downloadUserData,
    clearUserData,
    importFromFile,
} from '@texlyre/utils/userDataUtils';
import Modal from '../common/Modal';
import {
    TrashIcon,
    DownloadIcon,
    ImportIcon,
    EditIcon,
} from '../common/Icons';
import JsonEditorModal from './JsonEditorModal';

type ClearType = 'settings' | 'properties' | 'secrets' | 'records' | 'all';
type EditableType = Exclude<UserDataType, 'all'>;

interface LocalStorageDataSectionProps {
    userId: string;
    isSubmitting: boolean;
    setIsSubmitting: (value: boolean) => void;
    onError: (message: string) => void;
    onSuccess: (message: string) => void;
}

const STORES: Array<{
    type: EditableType;
    title: string;
    description: string;
}> = [
        {
            type: 'settings',
            title: t('Settings'),
            description: t('All your application settings and preferences'),
        },
        {
            type: 'properties',
            title: t('Properties'),
            description: t('All stored property values'),
        },
        {
            type: 'secrets',
            title: t('Encrypted Secrets'),
            description: t('All saved API keys and encrypted credentials'),
        },
        {
            type: 'records',
            title: t('Records and Logs'),
            description: t('All records, logs, and notifications'),
        },
    ];

const LocalStorageDataSection: React.FC<LocalStorageDataSectionProps> = ({
    userId,
    isSubmitting,
    setIsSubmitting,
    onError,
    onSuccess,
}) => {
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deleteType, setDeleteType] = useState<ClearType | null>(null);
    const [editType, setEditType] = useState<EditableType | null>(null);
    const [fileInputRef, setFileInputRef] = useState<HTMLInputElement | null>(
        null,
    );

    const handleDownloadData = async (type: UserDataType) => {
        try {
            const saved = await downloadUserData(userId, type);
            if (!saved) return;
            onSuccess(
                type === 'all'
                    ? t('Downloaded all data')
                    : t('Downloaded {type}', { type }),
            );
        } catch (error) {
            onError(
                error instanceof Error ? error.message : t('Failed to download data'),
            );
        }
    };

    const handleConfirmDelete = async () => {
        if (!deleteType) return;
        try {
            setIsSubmitting(true);
            clearUserData(userId, deleteType);
            onSuccess(
                deleteType === 'all'
                    ? t('Successfully cleared all data')
                    : t('Successfully cleared {type}', { type: deleteType }),
            );
            setShowDeleteModal(false);
            setDeleteType(null);
            // setTimeout(() => window.location.reload(), 1500);
        } catch (error) {
            onError(
                error instanceof Error ? error.message : t('Failed to clear data'),
            );
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleImportData = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.[0]) return;
        const file = e.target.files[0];
        if (!file.name.endsWith('.json')) {
            onError(t('Please select a valid JSON file'));
            return;
        }
        try {
            setIsSubmitting(true);
            await importFromFile(userId, file);
            onSuccess(t('Successfully imported user data'));
            // setTimeout(() => window.location.reload(), 1500);
        } catch (error) {
            onError(
                error instanceof Error ? error.message : t('Failed to import data'),
            );
        } finally {
            setIsSubmitting(false);
            e.target.value = '';
        }
    };

    return (
        <>
            <h3 style={{ paddingTop: '1rem' }}>{t('Local Storage Data (synced)')}</h3>

            <div className='warning-message'>
                <h3>{t('\u26A0\uFE0F Warning: This action cannot be undone')}</h3>
                <p>
                    {t(
                        'Clearing or uploading local storage data is permanent and cannot be undone. Make sure to export your data before clearing if you want to keep it.',
                    )}
                </p>
            </div>

            <div className='local-storage-actions'>
                {STORES.map(({ type, title, description }) => (
                    <div className='storage-action-group' key={type}>
                        <div className='storage-action-info'>
                            <strong>{title}</strong>
                            <p>{description}</p>
                        </div>
                        <div className='storage-action-buttons'>
                            <button
                                type='button'
                                className='button secondary smaller icon-only'
                                onClick={() => setEditType(type)}
                                disabled={isSubmitting}
                                title={t('Preview and edit {type}', { type })}
                            >
                                <EditIcon />
                            </button>
                            <button
                                type='button'
                                className='button secondary smaller icon-only'
                                onClick={() => handleDownloadData(type)}
                                disabled={isSubmitting}
                                title={t('Download {type} data', { type })}
                            >
                                <DownloadIcon />
                            </button>
                            <button
                                type='button'
                                className='button danger smaller icon-only'
                                onClick={() => {
                                    setDeleteType(type);
                                    setShowDeleteModal(true);
                                }}
                                disabled={isSubmitting}
                                title={t('Clear {type}', { type })}
                            >
                                <TrashIcon />
                            </button>
                        </div>
                    </div>
                ))}

                <div className='storage-action-group danger-zone'>
                    <div className='storage-action-info'>
                        <strong>{t('All Local Storage Data')}</strong>
                        <p>
                            {t('All settings, properties, secrets, records, and logs at once')}
                        </p>
                    </div>
                    <div className='storage-action-buttons'>
                        <button
                            type='button'
                            className='button primary smaller icon-only'
                            onClick={() => fileInputRef?.click()}
                            disabled={isSubmitting}
                            title={t('Import all data')}
                        >
                            <ImportIcon />
                        </button>
                        <input
                            ref={setFileInputRef}
                            type='file'
                            accept='.json'
                            onChange={handleImportData}
                            style={{ display: 'none' }}
                            disabled={isSubmitting}
                        />
                        <button
                            type='button'
                            className='button secondary smaller icon-only'
                            onClick={() => handleDownloadData('all')}
                            disabled={isSubmitting}
                            title={t('Download all data')}
                        >
                            <DownloadIcon />
                        </button>
                        <button
                            type='button'
                            className='button danger icon-only'
                            onClick={() => {
                                setDeleteType('all');
                                setShowDeleteModal(true);
                            }}
                            disabled={isSubmitting}
                            title={t('Clear all data')}
                        >
                            <TrashIcon />
                        </button>
                    </div>
                </div>
            </div>

            <Modal
                isOpen={showDeleteModal}
                onClose={() => {
                    setShowDeleteModal(false);
                    setDeleteType(null);
                }}
                title={t('Clear {data}', {
                    data: deleteType === 'all' ? t('All Data') : t(deleteType ?? ''),
                })}
                icon={TrashIcon}
                size='medium'
            >
                <div className='clear-storage-modal'>
                    <div className='warning-message'>
                        <p>{t('This action cannot be undone.')}</p>
                    </div>
                    <div className='modal-actions'>
                        <button
                            type='button'
                            className='button secondary'
                            onClick={() => {
                                setShowDeleteModal(false);
                                setDeleteType(null);
                            }}
                            disabled={isSubmitting}
                        >
                            {t('Cancel')}
                        </button>
                        <button
                            type='button'
                            className='button danger'
                            onClick={handleConfirmDelete}
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? t('Clearing...') : t('Clear')}
                        </button>
                    </div>
                </div>
            </Modal>

            <JsonEditorModal
                isOpen={editType !== null}
                onClose={() => setEditType(null)}
                userId={userId}
                type={editType ?? 'settings'}
                onSaved={onSuccess}
                onError={onError}
            />
        </>
    );
};

export default LocalStorageDataSection;
