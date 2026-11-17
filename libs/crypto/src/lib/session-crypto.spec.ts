import { LIMITS, isSessionId, isSessionKey, type SealedUpdate } from '@slm/protocol';
import { base64UrlDecode, base64UrlEncode } from './base64url';
import {
  MAX_MESSAGE_BYTES,
  MessageTooLongError,
  generateSessionId,
  generateSessionKey,
  importSessionKey,
  openUpdate,
  sealUpdate,
} from './session-crypto';

const SESSION_ID = 'abcDEF0123456789_-xyzA';

async function newKey() {
  return (await generateSessionKey()).key;
}

function flipByte(encoded: string, index: number): string {
  const bytes = base64UrlDecode(encoded);
  bytes[index] ^= 0x01;
  return base64UrlEncode(bytes);
}

describe('session crypto', () => {
  describe('key and ID generation', () => {
    it('generates a link-safe Session Key whose CryptoKey cannot be exported', async () => {
      const { encoded, key } = await generateSessionKey();
      expect(isSessionKey(encoded)).toBe(true);
      expect(key.extractable).toBe(false);
      await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
    });

    it('generates distinct 128-bit Session IDs', () => {
      const a = generateSessionId();
      const b = generateSessionId();
      expect(isSessionId(a)).toBe(true);
      expect(a).not.toEqual(b);
    });

    it('imports an encoded Session Key that opens what the original sealed', async () => {
      const { encoded, key } = await generateSessionKey();
      const sealed = await sealUpdate(key, SESSION_ID, 0, 'hello');
      const imported = await importSessionKey(encoded);
      expect(await openUpdate(imported, SESSION_ID, null, sealed)).toEqual({
        ok: true,
        seq: 0,
        text: 'hello',
      });
    });

    it('refuses to import a malformed Session Key', async () => {
      await expect(importSessionKey('not-a-key')).rejects.toThrow();
    });
  });

  describe('seal / open round-trip', () => {
    it.each([
      ['the empty Message', ''],
      ['ASCII text', 'Meet at 10:00'],
      ['multi-byte Unicode', 'Árvíztűrő tükörfúrógép 🔐 日本語'],
    ])('round-trips %s', async (_label, text) => {
      const key = await newKey();
      const sealed = await sealUpdate(key, SESSION_ID, 3, text);
      expect(await openUpdate(key, SESSION_ID, 2, sealed)).toEqual({ ok: true, seq: 3, text });
    });

    it('uses a fresh IV for every Update', async () => {
      const key = await newKey();
      const a = await sealUpdate(key, SESSION_ID, 1, 'same');
      const b = await sealUpdate(key, SESSION_ID, 1, 'same');
      expect(a.iv).not.toEqual(b.iv);
      expect(a.ciphertext).not.toEqual(b.ciphertext);
    });
  });

  describe('integrity', () => {
    let key: CryptoKey;
    let sealed: SealedUpdate;

    beforeEach(async () => {
      key = await newKey();
      sealed = await sealUpdate(key, SESSION_ID, 5, 'authentic');
    });

    it.each([
      ['first ciphertext byte', 0],
      ['a middle ciphertext byte', 100],
      ['the last byte (GCM tag)', -1],
    ])('rejects a flipped bit in the %s', async (_label, index) => {
      const length = base64UrlDecode(sealed.ciphertext).length;
      const tampered = {
        ...sealed,
        ciphertext: flipByte(sealed.ciphertext, (index + length) % length),
      };
      expect(await openUpdate(key, SESSION_ID, 4, tampered)).toEqual({
        ok: false,
        reason: 'authentication-failed',
      });
    });

    it('rejects a flipped bit in the IV', async () => {
      const tampered = { ...sealed, iv: flipByte(sealed.iv, 0) };
      expect(await openUpdate(key, SESSION_ID, 4, tampered)).toEqual({
        ok: false,
        reason: 'authentication-failed',
      });
    });

    it('rejects an Update sealed with a different key', async () => {
      expect(await openUpdate(await newKey(), SESSION_ID, 4, sealed)).toEqual({
        ok: false,
        reason: 'authentication-failed',
      });
    });

    it('rejects an Update spliced in from another Session', async () => {
      expect(await openUpdate(key, 'zzzDEF0123456789_-xyzA', 4, sealed)).toEqual({
        ok: false,
        reason: 'authentication-failed',
      });
    });

    it('rejects an Update whose Sequence Number was altered', async () => {
      expect(await openUpdate(key, SESSION_ID, 4, { ...sealed, seq: 6 })).toEqual({
        ok: false,
        reason: 'authentication-failed',
      });
    });

    it('rejects a Sequence Number older than the last accepted one as stale', async () => {
      expect(await openUpdate(key, SESSION_ID, 6, sealed)).toEqual({ ok: false, reason: 'stale' });
    });

    it('reports the last accepted Sequence Number as already seen, not as a failure', async () => {
      expect(await openUpdate(key, SESSION_ID, 5, sealed)).toEqual({
        ok: false,
        reason: 'already-seen',
      });
    });

    it('rejects an authentic ciphertext whose plaintext breaks the framing', async () => {
      // Sealed with the right key and AAD, but without the length prefix and padding.
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const raw = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`slm/v1|${SESSION_ID}|7`) },
        key,
        new TextEncoder().encode('x'.repeat(300)),
      );
      const unframed = {
        seq: 7,
        iv: base64UrlEncode(iv),
        ciphertext: base64UrlEncode(new Uint8Array(raw)),
      };
      expect(await openUpdate(key, SESSION_ID, 5, unframed)).toEqual({
        ok: false,
        reason: 'malformed',
      });
    });

    it('rejects a structurally malformed Update', async () => {
      expect(await openUpdate(key, SESSION_ID, null, { ...sealed, iv: '!!' })).toEqual({
        ok: false,
        reason: 'malformed',
      });
    });
  });

  describe('padding', () => {
    const ciphertextBytes = async (text: string) =>
      base64UrlDecode((await sealUpdate(await newKey(), SESSION_ID, 0, text)).ciphertext).length;
    const TAG = 16;

    it('hides the exact length within a padding bucket', async () => {
      expect(await ciphertextBytes('')).toBe(LIMITS.paddingBlockBytes + TAG);
      expect(await ciphertextBytes('a'.repeat(200))).toBe(LIMITS.paddingBlockBytes + TAG);
    });

    it('moves to the next bucket once the framed text no longer fits', async () => {
      // 4-byte length prefix + 252 bytes fills exactly one block; one more byte spills over.
      expect(await ciphertextBytes('a'.repeat(252))).toBe(LIMITS.paddingBlockBytes + TAG);
      expect(await ciphertextBytes('a'.repeat(253))).toBe(2 * LIMITS.paddingBlockBytes + TAG);
    });

    it('seals the longest allowed Message within the ciphertext limit and refuses longer', async () => {
      const key = await newKey();
      const longest = await sealUpdate(key, SESSION_ID, 0, 'a'.repeat(MAX_MESSAGE_BYTES));
      expect(base64UrlDecode(longest.ciphertext).length).toBeLessThanOrEqual(
        LIMITS.maxCiphertextBytes,
      );
      await expect(
        sealUpdate(key, SESSION_ID, 0, 'a'.repeat(MAX_MESSAGE_BYTES + 1)),
      ).rejects.toThrow(MessageTooLongError);
    });
  });
});
