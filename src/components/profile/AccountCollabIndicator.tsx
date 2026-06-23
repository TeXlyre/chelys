// src/components/profile/AccountCollabIndicator.tsx
import type React from 'react';
import { useEffect, useState } from 'react';
import type { Awareness } from 'y-protocols/awareness';

import { collabService } from '@texlyre/services/CollabService';
import { useRoom } from '../../hooks/useRoom';
import CollaboratorAvatars from '../common/CollaboratorAvatars';

const COLLECTION_NAME = 'chelys_account';

const AccountCollabIndicator: React.FC = () => {
    const { identity } = useRoom();
    const [awareness, setAwareness] = useState<Awareness | null>(null);

    useEffect(() => {
        if (!identity) {
            setAwareness(null);
            return;
        }

        let cancelled = false;
        let intervalId: ReturnType<typeof setInterval> | null = null;

        const resolve = () => {
            const next = collabService.getAwareness(identity.roomId, COLLECTION_NAME);
            if (next && !cancelled) {
                setAwareness(next);
                if (intervalId) clearInterval(intervalId);
                intervalId = null;
            }
        };

        resolve();
        if (!awareness) intervalId = setInterval(resolve, 1000);
        window.addEventListener('chelys-account-changed', resolve);

        return () => {
            cancelled = true;
            if (intervalId) clearInterval(intervalId);
            window.removeEventListener('chelys-account-changed', resolve);
        };
    }, [identity]);

    if (!awareness) return null;
    return <CollaboratorAvatars awareness={awareness} maxVisible={4} />;
};

export default AccountCollabIndicator;