import type { Role } from '@slm/protocol';

/**
 * Which socket currently holds each role of each Session. Connection state only:
 * it lives beside the SessionStore, not in it, and is never persisted.
 */
export class RoleSlots {
  private readonly bySession = new Map<string, Partial<Record<Role, string>>>();

  /** Gives the slot to this socket; check `holder` first. */
  claim(sessionId: string, role: Role, socketId: string): void {
    this.bySession.set(sessionId, { ...this.bySession.get(sessionId), [role]: socketId });
  }

  /** Frees the slot if this socket holds it; returns whether it did. */
  release(sessionId: string, role: Role, socketId: string): boolean {
    const slots = this.bySession.get(sessionId);
    if (slots?.[role] !== socketId) return false;
    delete slots[role];
    if (!slots.sender && !slots.receiver) this.bySession.delete(sessionId);
    return true;
  }

  holder(sessionId: string, role: Role): string | undefined {
    return this.bySession.get(sessionId)?.[role];
  }
}
