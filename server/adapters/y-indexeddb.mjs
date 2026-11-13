// server/adapters/y-indexeddb.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { dataDir, ensureDataDir } from '../data.mjs';

export class IndexeddbPersistence {
	constructor(name, doc) {
		ensureDataDir();
		const directory = path.join(dataDir, 'yjs');
		fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
		this.file = path.join(
			directory,
			`${createHash('sha256').update(name).digest('hex')}.bin`,
		);
		this.doc = doc;
		this.synced = false;
		this.timer = null;
		this.destroyed = false;
		try {
			Y.applyUpdate(doc, new Uint8Array(fs.readFileSync(this.file)), this);
		} catch (error) {
			if (error.code !== 'ENOENT') throw error;
		}
		this.update = () => {
			if (this.destroyed || this.timer) return;
			this.timer = setTimeout(() => {
				this.timer = null;
				this.flush();
			}, 50);
		};
		doc.on('update', this.update);
		this.synced = true;
	}
	on(event, fn) {
		if (event === 'synced' && this.synced) queueMicrotask(() => fn(this));
		return this;
	}
	once(event, fn) {
		return this.on(event, fn);
	}
	flush() {
		if (this.destroyed) return;
		const temp = `${this.file}.${process.pid}.tmp`;
		try {
			fs.writeFileSync(temp, Buffer.from(Y.encodeStateAsUpdate(this.doc)), {
				mode: 0o600,
			});
			fs.renameSync(temp, this.file);
		} finally {
			try {
				fs.unlinkSync(temp);
			} catch {}
		}
	}
	async destroy() {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.flush();
		this.destroyed = true;
		this.doc.off('update', this.update);
	}
}
