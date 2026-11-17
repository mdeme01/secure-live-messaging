import { API_PREFIX, PROTOCOL_VERSION, SOCKET_PATH } from './protocol';

describe('protocol', () => {
  it('exposes a versioned contract with distinct REST and socket paths', () => {
    expect(PROTOCOL_VERSION).toMatch(/^slm\/v\d+$/);
    expect(API_PREFIX).not.toEqual(SOCKET_PATH);
  });
});
