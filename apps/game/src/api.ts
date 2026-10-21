/**
 * Client for the leaderboard API.
 *
 * The base URL is baked in at build time via `VITE_API_BASE_URL`, because the
 * bundle is uploaded to Facebook and runs from their CDN, where relative URLs
 * would not reach the backend.
 */

import type {
  HealthResponse,
  LeaderboardResponse,
  ProfileResponse,
  ScoreResponse,
  SessionResponse,
} from '@shared/contract';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export interface ApiOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

export class LeaderboardApi {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: ApiOptions = {}) {
    const configured = (import.meta.env?.['VITE_API_BASE_URL'] as string | undefined) ?? '';
    this.baseUrl = (options.baseUrl ?? configured).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 8000;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      throw new ApiError(
        'network',
        error instanceof Error && error.name === 'AbortError'
          ? 'The request timed out.'
          : 'Could not reach the leaderboard.',
      );
    } finally {
      clearTimeout(timer);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ApiError(
        'unavailable',
        'The leaderboard returned an unreadable response.',
        response.status,
      );
    }

    if (!response.ok) {
      const body = payload as { error?: string; message?: string } | null;
      throw new ApiError(
        body?.error ?? 'error',
        body?.message ?? 'The leaderboard rejected the request.',
        response.status,
      );
    }

    return payload as T;
  }

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/api/health', { method: 'GET' });
  }

  async openSession(nonce: string, signature: string): Promise<SessionResponse> {
    return this.request<SessionResponse>('/api/session', {
      method: 'POST',
      body: JSON.stringify({ nonce, signature }),
    });
  }

  async submitScore(input: {
    sessionId: string;
    nonce: string;
    signature: string;
    score: number;
  }): Promise<ScoreResponse> {
    return this.request<ScoreResponse>('/api/score', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async leaderboard(playerId?: string): Promise<LeaderboardResponse> {
    const query = playerId ? `?playerId=${encodeURIComponent(playerId)}` : '';
    return this.request<LeaderboardResponse>(`/api/leaderboard${query}`, { method: 'GET' });
  }

  async setDisplayName(
    nonce: string,
    signature: string,
    displayName: string,
  ): Promise<ProfileResponse> {
    return this.request<ProfileResponse>('/api/profile', {
      method: 'POST',
      body: JSON.stringify({ nonce, signature, displayName }),
    });
  }
}
