// src/peer/DocumentViewer.ts
import { collabService } from "@texlyre/services/CollabService";

export interface DocumentViewerHandle {
    destroy: () => void;
}

export const openDocumentViewer = (
    projectId: string,
    documentId: string,
    onContent: (content: string) => void,
): DocumentViewerHandle => {
    const collectionName = `yjs_${documentId}`;
    const { doc } = collabService.connect(projectId, collectionName);
    const ytext = doc.getText("codemirror");

    const emit = () => onContent(ytext.toString());
    ytext.observe(emit);
    emit();

    return {
        destroy: () => {
            ytext.unobserve(emit);
            collabService.disconnect(projectId, collectionName);
        },
    };
};