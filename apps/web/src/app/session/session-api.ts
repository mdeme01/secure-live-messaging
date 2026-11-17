import { Injectable } from '@angular/core';
import type { SenderLink } from '@slm/crypto';
import {
  SESSIONS_PATH,
  sessionPath,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type ErrorCode,
} from '@slm/protocol';

/** A hung end request is reported as a failure so the Sender can retry. */
const END_TIMEOUT_MS = 10_000;

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

  /** Deletes a Session; 'not-found' if it was already gone (ended or expired). */
  async endSession({ sessionId, senderToken }: SenderLink): Promise<'ended' | 'not-found'> {
    let response: Response;
    try {
      response = await fetch(sessionPath(sessionId), {
        method: 'DELETE',
        headers: { authorization: `Bearer ${senderToken}` },
        signal: AbortSignal.timeout(END_TIMEOUT_MS),
      });
    } catch {
      throw new ApiError('NETWORK');
    }
    if (response.ok) return 'ended';
    if (response.status === 404) return 'not-found';
    const body = await response.json().catch(() => null);
    throw new ApiError(body?.error ?? 'UNKNOWN');
  }
}
