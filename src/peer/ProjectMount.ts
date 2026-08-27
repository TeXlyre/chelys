// src/peer/ProjectMount.ts
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';

import { collabService } from '@texlyre/services/CollabService';
import {
	fileStorageEventEmitter,
	fileStorageService,
} from '@texlyre/services/FileStorageService';
import { peerDocumentTrackingService } from '@texlyre/services/PeerDocumentTrackingService';
import { getPeerConfig } from '../config';
import type { PeerSession } from './PeerSession';

export interface PeerPresence {
	clientId: number;
	username: string;
	openDocs: string[];
}

export interface DocumentEntry {
	id: string;
	name: string;
}

type PresenceListener = (peers: PeerPresence[]) => void;
type DocumentsListener = (docs: DocumentEntry[]) => void;

export class ProjectMount {
	private projectId = '';
	private metadataDoc: Y.Doc | null = null;
	private metadataAwareness: Awareness | null = null;
	private awarenessChangeHandler: (() => void) | null = null;
	private dataMapObserver: ((event: Y.YMapEvent<unknown>) => void) | null =
		null;
	private storageUnsubscribe: (() => void) | null = null;
	private trackingUnregister: (() => void) | null = null;

	private presenceListeners: PresenceListener[] = [];
	private documentsListeners: DocumentsListener[] = [];

	constructor(private session: PeerSession) {}

	async mount(docUrl: string): Promise<void> {
		this.projectId = docUrl.startsWith('yjs:') ? docUrl.slice(4) : docUrl;

		await fileStorageService.initialize(docUrl);
		await this.attachCollab();

		this.storageUnsubscribe = fileStorageEventEmitter.onChange(() => {
			this.session.requestSyncSoon();
		});

		await this.session.start(docUrl);
	}

	async unmount(): Promise<void> {
		await this.detachCollab();
		this.session.stop();
		this.storageUnsubscribe?.();
		this.storageUnsubscribe = null;
		this.presenceListeners = [];
		this.documentsListeners = [];

		await new Promise((r) => setTimeout(r, 200));
		fileStorageService.cleanup();
	}

	getProjectId(): string {
		return this.projectId;
	}

	getMetadataDoc(): Y.Doc | null {
		return this.metadataDoc;
	}

	setLocalOpenDocs(docIds: string[]): void {
		this.metadataAwareness?.setLocalStateField('openDocs', docIds);
	}

	subscribePresence(listener: PresenceListener): () => void {
		this.presenceListeners.push(listener);
		listener(this.snapshotPresence());
		return () => {
			this.presenceListeners = this.presenceListeners.filter(
				(l) => l !== listener,
			);
		};
	}

	subscribeDocuments(listener: DocumentsListener): () => void {
		this.documentsListeners.push(listener);
		listener(this.snapshotDocuments());
		return () => {
			this.documentsListeners = this.documentsListeners.filter(
				(l) => l !== listener,
			);
		};
	}

	private async attachCollab(): Promise<void> {
		const cfg = getPeerConfig();
		const { doc, provider } = collabService.connect(
			this.projectId,
			'yjs_metadata',
			{
				signalingServers: cfg.signalingServers,
				websocketServer: cfg.websocketServer,
				awarenessTimeout: false,
			},
		);
		this.metadataDoc = doc;
		this.metadataAwareness = provider?.awareness ?? null;

		const peerKey = provider?.awareness.clientID.toString() ?? cfg.userId;
		collabService.setUserInfo(this.projectId, 'yjs_metadata', {
			id: peerKey,
			username: cfg.username,
			name: cfg.username,
			color: '#7da8c4',
			colorLight: '#a8c4dc',
			passwordHash: '',
			createdAt: 0,
		});

		if (this.metadataAwareness) {
			this.awarenessChangeHandler = () => this.notifyPresence();
			this.metadataAwareness.on('change', this.awarenessChangeHandler);
			this.notifyPresence();

			this.trackingUnregister = peerDocumentTrackingService.registerProject(
				this.projectId,
				this.metadataAwareness,
				{
					signalingServers: cfg.signalingServers,
					websocketServer: cfg.websocketServer,
					awarenessTimeout: false,
				},
			);
		}

		this.dataMapObserver = (event) => {
			if (event.keysChanged.has('documents')) this.notifyDocuments();
		};
		doc.getMap('data').observe(this.dataMapObserver);
		this.notifyDocuments();
	}

	private async detachCollab(): Promise<void> {
		this.trackingUnregister?.();
		this.trackingUnregister = null;

		if (this.metadataAwareness && this.awarenessChangeHandler) {
			this.metadataAwareness.off('change', this.awarenessChangeHandler);
			this.awarenessChangeHandler = null;
		}
		if (this.metadataAwareness) {
			try {
				this.metadataAwareness.setLocalState(null);
			} catch (error) {
				console.warn('[ProjectMount] Failed to clear awareness:', error);
			}
		}
		if (this.metadataDoc && this.dataMapObserver) {
			this.metadataDoc.getMap('data').unobserve(this.dataMapObserver);
			this.dataMapObserver = null;
		}
		if (this.metadataDoc) {
			collabService.disconnect(this.projectId, 'yjs_metadata');
			this.metadataDoc = null;
		}
		this.metadataAwareness = null;
	}

	private snapshotDocuments(): DocumentEntry[] {
		if (!this.metadataDoc) return [];
		const docs = this.metadataDoc.getMap('data').get('documents');
		if (!Array.isArray(docs)) return [];
		return docs
			.filter((d): d is DocumentEntry => !!d?.id && typeof d.name === 'string')
			.map((d) => ({ id: d.id, name: d.name }));
	}

	private snapshotPresence(): PeerPresence[] {
		if (!this.metadataAwareness) return [];
		const localId = this.metadataAwareness.clientID;
		const out: PeerPresence[] = [];
		this.metadataAwareness.getStates().forEach((state, clientId) => {
			if (clientId === localId) return;
			const user = (state as { user?: { username?: string } }).user;
			const openDocs = (state as { openDocs?: string[] }).openDocs;
			out.push({
				clientId,
				username: user?.username ?? `client-${clientId}`,
				openDocs: Array.isArray(openDocs) ? openDocs : [],
			});
		});
		return out;
	}

	private notifyPresence(): void {
		const snapshot = this.snapshotPresence();
		for (const listener of this.presenceListeners) listener(snapshot);
	}

	private notifyDocuments(): void {
		const snapshot = this.snapshotDocuments();
		for (const listener of this.documentsListeners) listener(snapshot);
	}
}
