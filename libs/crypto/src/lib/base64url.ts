/** Unpadded base64url, the encoding used for every binary value in links and on the wire. */

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Throws on anything that isn't unpadded base64url. */
export function base64UrlDecode(encoded: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded) || encoded.length % 4 === 1) {
    throw new TypeError('Invalid base64url');
  }
  const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
