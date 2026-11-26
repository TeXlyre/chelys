// src/components/profile/UserDropdown.tsx
import type React from 'react';
import { useState } from 'react';

import PositionedDropdown from '@texlyre/components/common/PositionedDropdown';
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
	const [anchor, setAnchor] = useState<HTMLElement | null>(null);

	return (
		<div className='user-dropdown-container'>
			<button
				type='button'
				className='user-dropdown-button'
				onClick={(event) => { setAnchor(event.currentTarget); setIsOpen(!isOpen); }}
				aria-expanded={isOpen}
				aria-haspopup='true'
			>
				<UserIcon />
				<span>{username}</span>
			</button>

			<PositionedDropdown isOpen={isOpen} triggerElement={anchor} onClose={() => setIsOpen(false)}>
					<button
						type='button'
						className='dropdown-item ui-menu-item'
						onClick={() => {
							setIsOpen(false);
							onOpenProfile();
						}}
					>
						<EditIcon />
						{t('Account Settings')}
					</button>
					<div className='dropdown-separator ui-menu-divider' />
					<button
						type='button'
						className='dropdown-item ui-menu-item'
						onClick={() => {
							setIsOpen(false);
							onLogout();
						}}
					>
						<LogoutIcon />
						<span>{t('Logout')}</span>
					</button>
			</PositionedDropdown>
		</div>
	);
};

export default UserDropdown;
