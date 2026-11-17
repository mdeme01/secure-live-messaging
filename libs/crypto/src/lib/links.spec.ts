import {
  parseReceiverLink,
  parseSenderLink,
  receiverLinkPath,
  senderLinkPath,
  type SenderLink,
} from './links';

const link: SenderLink = {
  sessionId: 'abcDEF0123456789_-xyzA',
  sessionKey: 'K'.repeat(42) + 'g',
  senderToken: 'T'.repeat(42) + 'w',
};

/** Splits a path the way the router does: the route's Session ID and the fragment. */
function split(path: string): [string, string] {
  const url = new URL(path, 'https://example.test');
  return [url.pathname.split('/')[2], url.hash];
}

describe('links', () => {
  it('round-trips a Receiver Link without the Sender Token', () => {
    const path = receiverLinkPath(link);
    expect(path).toBe(`/r/${link.sessionId}#k=${link.sessionKey}`);
    expect(path).not.toContain(link.senderToken);
    expect(parseReceiverLink(...split(path))).toEqual({
      sessionId: link.sessionId,
      sessionKey: link.sessionKey,
    });
  });

  it('round-trips a Sender Link', () => {
    const path = senderLinkPath(link);
    expect(path).toBe(`/s/${link.sessionId}#k=${link.sessionKey}&t=${link.senderToken}`);
    expect(parseSenderLink(...split(path))).toEqual(link);
  });

  it('accepts the fragment with or without the leading #', () => {
    expect(parseReceiverLink(link.sessionId, `k=${link.sessionKey}`)).not.toBeNull();
  });

  it.each([
    ['no fragment', link.sessionId, null],
    ['empty fragment', link.sessionId, '#'],
    ['missing key', link.sessionId, '#x=1'],
    ['truncated key', link.sessionId, `#k=${link.sessionKey.slice(1)}`],
    ['key with invalid characters', link.sessionId, `#k=${'+'.repeat(43)}`],
    ['malformed Session ID', 'short', `#k=${link.sessionKey}`],
    ['missing Session ID', null, `#k=${link.sessionKey}`],
  ])('rejects a Receiver Link with %s', (_label, id, fragment) => {
    expect(parseReceiverLink(id, fragment)).toBeNull();
  });

  it.each([
    ['missing token', `#k=${link.sessionKey}`],
    ['truncated token', `#k=${link.sessionKey}&t=${link.senderToken.slice(2)}`],
    ['missing key', `#t=${link.senderToken}`],
  ])('rejects a Sender Link with %s', (_label, fragment) => {
    expect(parseSenderLink(link.sessionId, fragment)).toBeNull();
  });
});
