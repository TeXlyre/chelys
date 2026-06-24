import type React from 'react';
import { useEffect, useRef, useState } from 'react';

import { t } from '@/i18n';
import { UserIcon, EditIcon, LogoutIcon } from '../common/Icons';

interface UserDropdownProps {
    username: string;
    onLogout: () => void;
    onOpenProfile: () => void;
}

const UserDropdown: React.FC<UserDropdownProps> = ({
    username,
    onLogout,
    onOpenProfile,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(event.target as Node)
            ) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    return (
        <div className='user-dropdown-container' ref={dropdownRef}>
            <button
                className='user-dropdown-button'
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
                aria-haspopup='true'
            >
                <UserIcon />
                <span>{username}</span>
            </button>

            {isOpen && (
                <div className='user-dropdown-menu'>
                    <button
                        className='dropdown-item'
                        onClick={() => {
                            setIsOpen(false);
                            onOpenProfile();
                        }}
                    >
                        <EditIcon />
                        {t('Account Settings')}
                    </button>
                    <div className='dropdown-separator' />
                    <button
                        className='dropdown-item'
                        onClick={() => {
                            setIsOpen(false);
                            onLogout();
                        }}
                    >
                        <LogoutIcon />
                        <span>{t('Logout')}</span>
                    </button>
                </div>
            )}
        </div>
    );
};

export default UserDropdown;