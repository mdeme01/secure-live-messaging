import { Injectable, inject } from '@angular/core';
import { generateSessionId, generateSessionKey, sealUpdate, type SenderLink } from '@slm/crypto';
import { SessionApi } from './session-api';

/**
 * Creates a Session entirely from the browser: the Session Key never leaves it,
 * the server receives only the Session ID and the sealed empty Message (Update 0).
 */
@Injectable({ providedIn: 'root' })
export class SessionCreator {
  private readonly api = inject(SessionApi);

  async create(): Promise<SenderLink> {
    const { encoded: sessionKey, key } = await generateSessionKey();
    const sessionId = generateSessionId();
    const update = await sealUpdate(key, sessionId, 0, '');
    const { senderToken } = await this.api.createSession({ sessionId, update });
    return { sessionId, sessionKey, senderToken };
  }
}
