// src/peer/DocumentLister.ts
import type { PeerPresence } from "./ProjectMount";

export interface DocumentEntry {
    id: string;
    name: string;
    watchers: string[];
}

export const listDocumentsFromPresence = (
    presence: PeerPresence[],
): DocumentEntry[] => {
    const byId = new Map<string, Set<string>>();
    for (const peer of presence) {
        for (const docId of peer.openDocs) {
            const set = byId.get(docId) ?? new Set<string>();
            set.add(peer.username);
            byId.set(docId, set);
        }
    }
    return Array.from(byId.entries()).map(([id, watchers]) => ({
        id,
        name: id,
        watchers: Array.from(watchers),
    }));
};
