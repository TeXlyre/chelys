// src/components/plugin-host/RecipeCodeMirror.tsx
import type React from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { StreamLanguage } from '@codemirror/language';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import {
	Compartment,
	EditorState,
	Transaction,
	type Extension,
} from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';

import { useThemeVariant } from '../../hooks/useThemeVariant';

export type RecipeEditorLanguage =
	| 'plain'
	| 'json'
	| 'javascript'
	| 'dockerfile';

interface RecipeCodeMirrorProps {
	value: string;
	language: RecipeEditorLanguage;
	readOnly?: boolean;
	onChange: (value: string) => void;
}

export const recipeEditorLanguage = (
	name: string,
	kind?: 'file' | 'view' | 'reference',
): RecipeEditorLanguage => {
	if (kind === 'view') return 'json';

	const lower = name.toLowerCase();
	if (lower.endsWith('.json')) return 'json';
	if (lower === 'dockerfile' || lower.endsWith('/dockerfile'))
		return 'dockerfile';
	if (/\.(?:cjs|mjs|js|jsx)$/i.test(lower)) return 'javascript';
	return 'plain';
};

const languageExtension = (language: RecipeEditorLanguage): Extension => {
	switch (language) {
		case 'json':
			return json();
		case 'javascript':
			return javascript();
		case 'dockerfile':
			return StreamLanguage.define(dockerFile);
		default:
			return [];
	}
};

const chelysEditorTheme = EditorView.theme({
	'&': {
		minHeight: '24em',
		border: '1px solid var(--accent-border)',
		borderRadius: 'var(--radius-sm)',
		backgroundColor: 'var(--pico-background)',
		color: 'var(--text-color)',
		fontSize: '0.875rem',
	},
	'&.cm-focused': {
		outline: '2px solid var(--pico-primary-focus)',
		outlineOffset: '1px',
	},
	'.cm-scroller': {
		overflow: 'auto',
		fontFamily:
			'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
	},
	'.cm-gutters': {
		backgroundColor: 'var(--pico-secondary-background)',
		color: 'var(--pico-secondary)',
		borderRight: '1px solid var(--accent-border)',
	},
});

const RecipeCodeMirror: React.FC<RecipeCodeMirrorProps> = ({
	value,
	language,
	readOnly = false,
	onChange,
}) => {
	const currentVariant = useThemeVariant();
	const editorViewRef = useRef<EditorView | null>(null);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const onChangeRef = useRef(onChange);
	const isInternalUpdateRef = useRef(false);
	const languageCompartmentRef = useRef(new Compartment());
	const themeCompartmentRef = useRef(new Compartment());
	const readOnlyCompartmentRef = useRef(new Compartment());

	useEffect(() => {
		onChangeRef.current = onChange;
	}, [onChange]);

	const themeExtension = useCallback(
		() => (currentVariant === 'dark' ? oneDark : []),
		[currentVariant],
	);

	/* biome-ignore lint/correctness/useExhaustiveDependencies: Mount-only; reactive updates use compartments below. */
	useEffect(() => {
		if (!containerRef.current || editorViewRef.current) return;

		const state = EditorState.create({
			doc: value,
			extensions: [
				basicSetup,
				languageCompartmentRef.current.of(languageExtension(language)),
				themeCompartmentRef.current.of(themeExtension()),
				readOnlyCompartmentRef.current.of([
					EditorState.readOnly.of(readOnly),
					EditorView.editable.of(!readOnly),
				]),
				chelysEditorTheme,
				EditorView.lineWrapping,
				EditorView.contentAttributes.of({ dir: 'ltr' }),
				EditorView.editorAttributes.of({ dir: 'ltr' }),
				EditorView.updateListener.of((update) => {
					if (!update.docChanged) return;
					isInternalUpdateRef.current = true;
					onChangeRef.current(update.state.doc.toString());
					requestAnimationFrame(() => {
						isInternalUpdateRef.current = false;
					});
				}),
			],
		});

		editorViewRef.current = new EditorView({
			state,
			parent: containerRef.current,
		});

		return () => {
			editorViewRef.current?.destroy();
			editorViewRef.current = null;
		};
	}, []);

	useEffect(() => {
		const view = editorViewRef.current;
		if (!view || isInternalUpdateRef.current) return;

		const current = view.state.doc.toString();
		if (current === value) return;

		view.dispatch({
			changes: { from: 0, to: current.length, insert: value },
			annotations: Transaction.addToHistory.of(false),
		});
	}, [value]);

	useEffect(() => {
		editorViewRef.current?.dispatch({
			effects: languageCompartmentRef.current.reconfigure(
				languageExtension(language),
			),
		});
	}, [language]);

	useEffect(() => {
		editorViewRef.current?.dispatch({
			effects: themeCompartmentRef.current.reconfigure(themeExtension()),
		});
	}, [themeExtension]);

	useEffect(() => {
		editorViewRef.current?.dispatch({
			effects: readOnlyCompartmentRef.current.reconfigure([
				EditorState.readOnly.of(readOnly),
				EditorView.editable.of(!readOnly),
			]),
		});
	}, [readOnly]);

	return <div ref={containerRef} className='recipe-codemirror' />;
};

export default RecipeCodeMirror;
