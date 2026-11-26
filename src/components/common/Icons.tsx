// src/components/common/Icons.tsx
import type React from 'react';

export * from '@texlyre/components/common/Icons';

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
