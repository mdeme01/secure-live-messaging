import {
  API_PREFIX,
  ErrorCode,
  LIMITS,
  PROTOCOL_VERSION,
  SOCKET_PATH,
  isSenderToken,
  isSessionId,
  isSessionKey,
  validateSealedUpdate,
} from './protocol';

const validUpdate = { seq: 0, iv: 'A'.repeat(16), ciphertext: 'B'.repeat(363) };

describe('protocol', () => {
  it('exposes a versioned contract with distinct REST and socket paths', () => {
    expect(PROTOCOL_VERSION).toMatch(/^slm\/v\d+$/);
    expect(API_PREFIX).not.toEqual(SOCKET_PATH);
  });

  describe('identifier validators', () => {
    it('accepts base64url values of the exact length', () => {
      expect(isSessionId('abcDEF0123456789_-xyzA')).toBe(true);
      expect(isSessionKey('k'.repeat(43))).toBe(true);
      expect(isSenderToken('t'.repeat(43))).toBe(true);
    });

    it.each([
      ['too short', 'a'.repeat(21)],
      ['too long', 'a'.repeat(23)],
      ['non-base64url characters', 'a'.repeat(21) + '+'],
      ['padding', 'a'.repeat(20) + '=='],
      ['not a string', 42],
    ])('rejects a Session ID with %s', (_label, value) => {
      expect(isSessionId(value)).toBe(false);
    });
  });

  describe('validateSealedUpdate', () => {
    it('accepts a well-formed update', () => {
      expect(validateSealedUpdate(validUpdate)).toBeNull();
    });

    it.each([
      ['null', null],
      ['negative seq', { ...validUpdate, seq: -1 }],
      ['fractional seq', { ...validUpdate, seq: 1.5 }],
      ['string seq', { ...validUpdate, seq: '1' }],
      ['short iv', { ...validUpdate, iv: 'A'.repeat(15) }],
      ['empty ciphertext', { ...validUpdate, ciphertext: '' }],
      ['non-base64url ciphertext', { ...validUpdate, ciphertext: 'a/b+' }],
    ])('rejects %s as invalid', (_label, value) => {
      expect(validateSealedUpdate(value)).toBe(ErrorCode.InvalidPayload);
    });

    it('rejects ciphertext over the size limit as too large', () => {
      const atLimit = Math.ceil((LIMITS.maxCiphertextBytes * 4) / 3);
      expect(validateSealedUpdate({ ...validUpdate, ciphertext: 'A'.repeat(atLimit) })).toBeNull();
      expect(validateSealedUpdate({ ...validUpdate, ciphertext: 'A'.repeat(atLimit + 4) })).toBe(
        ErrorCode.PayloadTooLarge,
      );
    });
  });
});
