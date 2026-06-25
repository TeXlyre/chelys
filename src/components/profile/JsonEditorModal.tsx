// src/components/profile/JsonEditorModal.tsx
import type React from 'react';
import { useEffect, useRef, useState } from 'react';

import { t } from '@/i18n';
import {
    type UserDataType,
    getUserData,
    setUserData,
} from '@texlyre/utils/userDataUtils';
import { chelysAccountSyncService } from '@texlyre/services/ChelysAccountSyncService';
import Modal from '../common/Modal';
import { EditIcon } from '../common/Icons';

type EditableType = Exclude<UserDataType, 'all'>;
const VERSIONED: EditableType[] = ['settings', 'properties'];

interface JsonEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    userId: string;
    type: EditableType;
    onSaved: (message: string) => void;
    onError: (message: string) => void;
}

const JsonEditorModal: React.FC<JsonEditorModalProps> = ({
    isOpen,
    onClose,
    userId,
    type,
    onSaved,
    onError,
}) => {
    const [text, setText] = useState('');
    const [parseError, setParseError] = useState<string | null>(null);
    const versionRef = useRef<unknown>(undefined);
    const dirtyRef = useRef(false);

    useEffect(() => {
        if (!isOpen) return;

        const load = () => {
            const data = getUserData<Record<string, unknown>>(userId, type) ?? {};
            const { _version, ...rest } = data as Record<string, unknown>;
            versionRef.current = _version;
            setText(JSON.stringify(rest, null, 2));
        };

        dirtyRef.current = false;
        load();
        setParseError(null);

        const handler = (event: Event) => {
            const detail = (event as CustomEvent).detail;
            if (dirtyRef.current) return;
            if (!detail || detail.store === type) load();
        };

        window.addEventListener('chelys-account-store-changed', handler);
        return () =>
            window.removeEventListener('chelys-account-store-changed', handler);
    }, [isOpen, userId, type]);

    const handleChange = (value: string) => {
        dirtyRef.current = true;
        setText(value);
    };

    const handleSave = () => {
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch (error) {
            setParseError(
                error instanceof Error ? error.message : t('Invalid JSON'),
            );
            return;
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            setParseError(t('Top-level value must be a JSON object'));
            return;
        }
        try {
            const payload = VERSIONED.includes(type)
                ? { ...(parsed as Record<string, unknown>), _version: versionRef.current }
                : parsed;
            setUserData(userId, type, payload);
            dirtyRef.current = false;
            void chelysAccountSyncService.reconnect();
            onSaved(t('Saved {type}', { type }));
            onClose();
        } catch (error) {
            onError(
                error instanceof Error ? error.message : t('Failed to save data'),
            );
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={t('Edit {type}', { type })}
            icon={EditIcon}
            size='wide'
        >
            <div className='json-editor'>
                {parseError && <div className='error-message'>{parseError}</div>}
                <textarea
                    className='json-editor-textarea mono'
                    value={text}
                    onChange={(e) => handleChange(e.target.value)}
                    spellCheck={false}
                    rows={20}
                />
                <div className='modal-actions'>
                    <button type='button' className='button secondary' onClick={onClose}>
                        {t('Cancel')}
                    </button>
                    <button type='button' className='button primary' onClick={handleSave}>
                        {t('Save')}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

export default JsonEditorModal;
