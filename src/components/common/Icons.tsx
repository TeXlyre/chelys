// src/components/common/Icons.tsx
import type React from 'react';

export const SettingsIcon: React.FC = () => (
	<svg
		xmlns='http://www.w3.org/2000/svg'
		width='16'
		height='16'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<circle cx='12' cy='12' r='3' />
		<path d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z' />
	</svg>
);

export const SunIcon: React.FC = () => (
	<svg
		xmlns='http://www.w3.org/2000/svg'
		width='16'
		height='16'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<circle cx='12' cy='12' r='5' />
		<line x1='12' y1='1' x2='12' y2='3' />
		<line x1='12' y1='21' x2='12' y2='23' />
		<line x1='4.22' y1='4.22' x2='5.64' y2='5.64' />
		<line x1='18.36' y1='18.36' x2='19.78' y2='19.78' />
		<line x1='1' y1='12' x2='3' y2='12' />
		<line x1='21' y1='12' x2='23' y2='12' />
		<line x1='4.22' y1='19.78' x2='5.64' y2='18.36' />
		<line x1='18.36' y1='5.64' x2='19.78' y2='4.22' />
	</svg>
);

export const MoonIcon: React.FC = () => (
	<svg
		xmlns='http://www.w3.org/2000/svg'
		width='16'
		height='16'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<path d='M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z' />
	</svg>
);

export const CloseIcon: React.FC = () => (
	<svg
		xmlns='http://www.w3.org/2000/svg'
		width='24'
		height='24'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<line x1='18' y1='6' x2='6' y2='18' />
		<line x1='6' y1='6' x2='18' y2='18' />
	</svg>
);

export const UserIcon: React.FC = () => (
	<svg
		xmlns='http://www.w3.org/2000/svg'
		width='16'
		height='16'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' />
		<circle cx='12' cy='7' r='4' />
	</svg>
);

export const LogoutIcon: React.FC = () => (
	<svg
		xmlns='http://www.w3.org/2000/svg'
		width='16'
		height='16'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<path d='M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' />
		<polyline points='16 17 21 12 16 7' />
		<line x1='21' y1='12' x2='9' y2='12' />
	</svg>
);

export const TrashIcon: React.FC = () => (
	<svg
		xmlns='http://www.w3.org/2000/svg'
		width='16'
		height='16'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<polyline points='3 6 5 6 21 6' />
		<path d='M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' />
	</svg>
);

export const DownloadIcon: React.FC = () => (
	<svg
		xmlns='http://www.w3.org/2000/svg'
		width='16'
		height='16'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<rect x='3' y='3' width='18' height='18' rx='4' ry='4' />
		<polyline points='8 13 12 17 16 13' />
		<line x1='12' y1='7' x2='12' y2='17' />
	</svg>
);

export const UploadIcon: React.FC = () => (
	<svg
		xmlns='http://www.w3.org/2000/svg'
		width='16'
		height='16'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<rect x='3' y='3' width='18' height='18' rx='4' ry='4' />
		<polyline points='16 11 12 7 8 11' />
		<line x1='12' y1='17' x2='12' y2='7' />
	</svg>
);

export const ExportIcon: React.FC = () => (
	<svg
		xmlns='http://www.w3.org/2000/svg'
		width='16'
		height='16'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' />
		<polyline points='7 10 12 15 17 10' />
		<line x1='12' y1='15' x2='12' y2='3' />
	</svg>
);

export const ImportIcon: React.FC = () => (
	<svg
		xmlns='http://www.w3.org/2000/svg'
		width='16'
		height='16'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<path d='M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7' />
		<polyline points='7 9 12 4 17 9' />
		<line x1='12' y1='4' x2='12' y2='16' />
	</svg>
);

export const UrlIcon: React.FC = () => (
	<svg
		xmlns='http://www.w3.org/2000/svg'
		width='16'
		height='16'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<rect x='2' y='5' width='20' height='14' rx='2' />
		<line x1='2' y1='9' x2='22' y2='9' />
		<text
			x='12'
			y='16.2'
			textAnchor='middle'
			fontSize='7'
			fontWeight='500'
			stroke='none'
			fill='currentColor'
		>
			www
		</text>
	</svg>
);

export const CopyUrlIcon: React.FC = () => (
	<svg
		xmlns='http://www.w3.org/2000/svg'
		width='16'
		height='16'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<rect x='9' y='9' width='13' height='13' rx='2' ry='2' />
		<path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' />
		<line x1='12' y1='15' x2='18' y2='15' />
		<line x1='15' y1='12' x2='15' y2='18' />
	</svg>
);

export const CopyIcon: React.FC = () => (
	<svg
		xmlns='http://www.w3.org/2000/svg'
		width='16'
		height='16'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<rect x='9' y='9' width='13' height='13' rx='2' ry='2' />
		<path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' />
	</svg>
);

export const PasteIcon: React.FC = () => (
	<svg
		xmlns='http://www.w3.org/2000/svg'
		width='16'
		height='16'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<path d='M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' />
		<rect x='8' y='2' width='8' height='4' rx='1' ry='1' />
		<line x1='9' y1='12' x2='15' y2='12' />
		<line x1='9' y1='16' x2='13' y2='16' />
	</svg>
);

export const EditIcon: React.FC = () => (
	<svg
		xmlns='http://www.w3.org/2000/svg'
		width='16'
		height='16'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<path d='M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' />
		<path d='M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z' />
	</svg>
);

export const SaveIcon: React.FC = () => (
	<svg
		xmlns='http://www.w3.org/2000/svg'
		width='16'
		height='16'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<path d='M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z' />
		<polyline points='17 21 17 13 7 13 7 21' />
		<polyline points='7 3 7 8 15 8' />
	</svg>
);

export const KeyIcon: React.FC = () => (
	<svg
		xmlns='http://www.w3.org/2000/svg'
		width='16'
		height='16'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<circle cx='7.5' cy='15.5' r='5.5' />
		<path d='M21 2l-9.6 9.6' />
		<path d='M15.5 7.5l3 3L22 7l-3-3' />
	</svg>
);

export const SearchIcon: React.FC = () => (
	<svg
		xmlns='http://www.w3.org/2000/svg'
		width='16'
		height='16'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<circle cx='11' cy='11' r='8' />
		<line x1='21' y1='21' x2='16.65' y2='16.65' />
	</svg>
);

export const PlusIcon: React.FC = () => (
	<svg
		xmlns='http://www.w3.org/2000/svg'
		width='16'
		height='16'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<line x1='12' y1='5' x2='12' y2='19' />
		<line x1='5' y1='12' x2='19' y2='12' />
	</svg>
);
export const ShareIcon: React.FC = () => (
	<svg
		xmlns='http://www.w3.org/2000/svg'
		width='16'
		height='16'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<circle cx='18' cy='5' r='3' />
		<circle cx='6' cy='12' r='3' />
		<circle cx='18' cy='19' r='3' />
		<line x1='8.59' y1='13.51' x2='15.42' y2='17.49' />
		<line x1='15.41' y1='6.51' x2='8.59' y2='10.49' />
	</svg>
);

export const TerminalIcon: React.FC = () => (
	<svg
		xmlns='http://www.w3.org/2000/svg'
		width='16'
		height='16'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<polyline points='4 17 10 11 4 5' />
		<line x1='12' y1='19' x2='20' y2='19' />
	</svg>
);

export const RefreshIcon: React.FC = () => (
	<svg
		xmlns='http://www.w3.org/2000/svg'
		width='16'
		height='16'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<polyline points='23 4 23 10 17 10' />
		<path d='M20.49 15a9 9 0 1 1-2.12-9.36L23 10' />
	</svg>
);

export const UninstallIcon: React.FC = () => (
	<svg
		xmlns='http://www.w3.org/2000/svg'
		width='16'
		height='16'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<path d='M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8' />
		<rect x='2' y='3' width='20' height='5' rx='1' />
		<line x1='10' y1='12' x2='14' y2='16' />
		<line x1='14' y1='12' x2='10' y2='16' />
	</svg>
);

export const FileIcon: React.FC = () => (
	<svg
		xmlns='http://www.w3.org/2000/svg'
		width='16'
		height='16'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' />
		<polyline points='14 2 14 8 20 8' />
	</svg>
);

export const FolderIcon: React.FC = () => (
	<svg
		xmlns='http://www.w3.org/2000/svg'
		width='16'
		height='16'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<path d='M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z' />
	</svg>
);

export const ChevronDownIcon: React.FC = () => (
	<svg
		xmlns='http://www.w3.org/2000/svg'
		width='16'
		height='16'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<polyline points='6 9 12 15 18 9' />
	</svg>
);
