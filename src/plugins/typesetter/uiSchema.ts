// src/plugins/typesetter/uiSchema.ts
export type TranslatableText =
	| string
	| { key: string; params?: Record<string, string> };

export type TypesetterFieldKind = 'select' | 'boolean' | 'text' | 'number';

export interface TypesetterUIFieldOption {
	label: TranslatableText;
	value: string;
}

export interface TypesetterUIField {
	key: string;
	label: TranslatableText;
	kind: TypesetterFieldKind;
	defaultValue?: string | number | boolean;
	options?: TypesetterUIFieldOption[];
	help?: TranslatableText;
	sendAs?: 'option' | 'format';
}

export interface TypesetterUISection {
	label?: TranslatableText;
	fields: TypesetterUIField[];
}

export interface TypesetterUIInfoRow {
	label: TranslatableText;
	value: TranslatableText;
}

export interface TypesetterUIInfoSection {
	title: TranslatableText;
	rows: TypesetterUIInfoRow[];
}

export interface TypesetterUIRenderer {
	format: string;
	label: TranslatableText;
}

export interface TypesetterUISchema {
	compile?: TypesetterUISection;
	export?: TypesetterUISection;
	info?: TypesetterUIInfoSection;
	renderers?: TypesetterUIRenderer[];
}
