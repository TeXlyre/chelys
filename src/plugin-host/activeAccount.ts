// src/plugin-host/activeAccount.ts
let activeUserId: string | null = null;

export function setActiveAccountId(userId: string | null): void {
	activeUserId = userId;
}

export function getActiveAccountId(): string | null {
	return activeUserId;
}
