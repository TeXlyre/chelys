// src/utils/platformUtils.ts
import { invoke } from '@tauri-apps/api/core';

const isTauri = (): boolean =>
    typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function openExternalUrl(url: string): Promise<void> {
    if (isTauri()) {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(url);
        return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
}

async function tauriReadClipboard(): Promise<string | null> {
    try {
        const { readText } = await import(
            '@tauri-apps/plugin-clipboard-manager'
        );
        return (await readText()) ?? '';
    } catch (error) {
        console.warn('Tauri clipboard unavailable, falling back:', error);
        return null;
    }
}

export async function readClipboardText(): Promise<string> {
    if (isTauri()) {
        const text = await tauriReadClipboard();
        if (text !== null) return text;
    }
    return navigator.clipboard.readText();
}

async function tauriSaveTextFile(
    suggestedName: string,
    contents: string,
): Promise<boolean | null> {
    try {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const path = await save({
            defaultPath: suggestedName,
            filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (!path) return false;
        const encoder = new TextEncoder();
        await invoke('fs_write', {
            path,
            contents: Array.from(encoder.encode(contents)),
        });
        return true;
    } catch (error) {
        console.warn('Tauri save unavailable, falling back:', error);
        return null;
    }
}

async function browserSaveTextFile(
    suggestedName: string,
    contents: string,
): Promise<boolean> {
    const picker = (
        window as unknown as {
            showSaveFilePicker?: (options: unknown) => Promise<{
                createWritable: () => Promise<{
                    write: (data: string) => Promise<void>;
                    close: () => Promise<void>;
                }>;
            }>;
        }
    ).showSaveFilePicker;

    if (picker) {
        try {
            const handle = await picker({
                suggestedName,
                types: [
                    {
                        description: 'JSON',
                        accept: { 'application/json': ['.json'] },
                    },
                ],
            });
            const writable = await handle.createWritable();
            await writable.write(contents);
            await writable.close();
            return true;
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                return false;
            }
            console.warn('File picker unavailable, falling back to download:', error);
        }
    }

    const blob = new Blob([contents], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
}

export async function saveTextFile(
    suggestedName: string,
    contents: string,
): Promise<boolean> {
    if (isTauri()) {
        const result = await tauriSaveTextFile(suggestedName, contents);
        if (result !== null) return result;
    }
    return browserSaveTextFile(suggestedName, contents);
}