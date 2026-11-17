import { Injectable } from '@angular/core';
import {
  SESSIONS_PATH,
  sessionPath,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type ErrorCode,
} from '@slm/protocol';

/** Why a request failed: a protocol error code, or the server couldn't be reached at all. */
export class ApiError extends Error {
  constructor(readonly code: ErrorCode | 'NETWORK' | 'UNKNOWN') {
    super(`Request failed: ${code}`);
    this.name = 'ApiError';
  }
}

@Injectable({ providedIn: 'root' })
export class SessionApi {
  async createSession(request: CreateSessionRequest): Promise<CreateSessionResponse> {
    let response: Response;
    try {
      response = await fetch(SESSIONS_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      });
    } catch {
      throw new ApiError('NETWORK');
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(body?.error ?? 'UNKNOWN');
    return body as CreateSessionResponse;
  }

  /** Deletes a Session. One that is already gone counts as ended. */
  async endSession(sessionId: string, senderToken: string): Promise<void> {
    let response: Response;
    try {
      response = await fetch(sessionPath(sessionId), {
        method: 'DELETE',
        headers: { authorization: `Bearer ${senderToken}` },
      });
    } catch {
      throw new ApiError('NETWORK');
    }
    if (response.ok || response.status === 404) return;
    const body = await response.json().catch(() => null);
    throw new ApiError(body?.error ?? 'UNKNOWN');
  }
}
