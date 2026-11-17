import { createHash } from 'node:crypto';
import { isSenderToken } from '@slm/protocol';
import { SessionStore } from './session-store';

const update0 = { seq: 0, iv: 'A'.repeat(16), ciphertext: 'B'.repeat(363) };

describe('SessionStore', () => {
  it('keeps only a SHA-256 hash of the Sender Token, never the token itself', () => {
    const store = new SessionStore({ maxSessions: 10 });
    const result = store.create('s1', update0);
    if (!result.ok) throw new Error('expected creation');

    expect(isSenderToken(result.senderToken)).toBe(true);
    const stored = store.get('s1');
    expect(stored?.senderTokenHash).toEqual(
      createHash('sha256').update(result.senderToken).digest(),
    );
    expect(JSON.stringify(stored)).not.toContain(result.senderToken);
  });

  it('recognises the Sender Token and rejects anything else', () => {
    const store = new SessionStore({ maxSessions: 10 });
    const result = store.create('s1', update0);
    if (!result.ok) throw new Error('expected creation');

    expect(store.isSender('s1', result.senderToken)).toBe(true);
    expect(store.isSender('s1', 'x'.repeat(43))).toBe(false);
    expect(store.isSender('unknown', result.senderToken)).toBe(false);
  });

  it('records activity on create, join and publish', () => {
    let clock = 1_000;
    const store = new SessionStore({ maxSessions: 10, now: () => clock });
    store.create('s1', update0);
    expect(store.get('s1')?.lastActivityAt).toBe(1_000);

    clock = 2_000;
    store.touch('s1');
    expect(store.get('s1')?.lastActivityAt).toBe(2_000);

    clock = 3_000;
    store.publish('s1', { ...update0, seq: 1 });
    expect(store.get('s1')?.lastActivityAt).toBe(3_000);

    clock = 4_000;
    store.publish('s1', { ...update0, seq: 1 }); // stale: not activity
    expect(store.get('s1')?.lastActivityAt).toBe(3_000);
  });
});
