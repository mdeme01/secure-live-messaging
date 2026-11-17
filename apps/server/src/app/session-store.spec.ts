import { createHash } from 'node:crypto';
import { isSenderToken } from '@slm/protocol';
import { SessionStore } from './session-store';

const update0 = { seq: 0, iv: 'A'.repeat(16), ciphertext: 'B'.repeat(363) };

describe('SessionStore', () => {
  it('keeps only a SHA-256 hash of the Sender Token, never the token itself', () => {
    const store = new SessionStore(10);
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
    const store = new SessionStore(10);
    const result = store.create('s1', update0);
    if (!result.ok) throw new Error('expected creation');

    expect(store.isSender('s1', result.senderToken)).toBe(true);
    expect(store.isSender('s1', 'x'.repeat(43))).toBe(false);
    expect(store.isSender('unknown', result.senderToken)).toBe(false);
  });
});
