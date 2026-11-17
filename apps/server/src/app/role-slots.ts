import type { Role } from '@slm/protocol';

/**
 * Which socket currently holds each role of each Session. Connection state only:
 * it lives beside the SessionStore, not in it, and is never persisted.
 */
export class RoleSlots {
  private readonly bySession = new Map<string, Partial<Record<Role, string>>>();

  /** Takes the slot if it is free or already held by this socket. */
  claim(sessionId: string, role: Role, socketId: string): boolean {
    const slots = this.bySession.get(sessionId) ?? {};
    const holder = slots[role];
    if (holder !== undefined && holder !== socketId) return false;
    slots[role] = socketId;
    this.bySession.set(sessionId, slots);
    return true;
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
