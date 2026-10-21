/**
 * Thin wrapper around the Facebook Instant Games SDK.
 *
 * The SDK is injected by the platform when the game runs inside Facebook.
 * When it is missing (local development, a browser preview, a failed load)
 * the bridge reports itself as unavailable and the game falls back to a
 * fully playable offline mode.
 */

export interface SignedPlayerInfo {
  playerId: string;
  signature: string;
}

export interface SharePayload {
  text: string;
  /** A data URL or hosted URL for the shared image. */
  image?: string;
  /** Optional payload the game can read back from a shared link. */
  data?: string;
}

export type HapticType =
  'light' | 'medium' | 'heavy' | 'selection' | 'success' | 'warning' | 'error';

interface SignedPlayerInfoLike {
  getPlayerID?: () => string;
  getSignature?: () => string;
  playerID?: string;
  signature?: string;
}

interface FbInstantSdk {
  initializeAsync?: (options?: unknown) => Promise<unknown>;
  startGameAsync?: (options?: unknown) => Promise<unknown>;
  setLoadingProgress?: (progress: number) => void;
  getEntryPointData?: () => Record<string, unknown>;
  getDisplayMode?: () => string;
  player?: {
    getSignedPlayerInfoAsync?: (requestPayload: string) => Promise<unknown>;
  };
  shareAsync?: (options: {
    text: string;
    image?: string;
    imageOverlayPath?: string;
    data?: string;
  }) => Promise<unknown>;
  performHapticFeedbackAsync?: (type: string) => Promise<unknown>;
  onPause?: (callback: () => void) => void;
  onResume?: (callback: () => void) => void;
  logEvent?: (name: string) => void;
}

declare global {
  interface Window {
    FBInstant?: FbInstantSdk;
  }
}

const HAPTIC_SDK_NAMES: Record<HapticType, string> = {
  light: 'HAPTIC_FEEDBACK_LIGHT',
  medium: 'HAPTIC_FEEDBACK_MEDIUM',
  heavy: 'HAPTIC_FEEDBACK_HEAVY',
  selection: 'HAPTIC_FEEDBACK_SELECTION',
  success: 'HAPTIC_FEEDBACK_SUCCESS',
  warning: 'HAPTIC_FEEDBACK_WARNING',
  error: 'HAPTIC_FEEDBACK_ERROR',
};

/** Wait for the platform to inject the SDK. */
export function waitForSdk(timeoutMs = 3000): Promise<FbInstantSdk | null> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const check = (): void => {
      const sdk = window.FBInstant;
      if (sdk) {
        resolve(sdk);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(null);
        return;
      }
      setTimeout(check, 50);
    };
    check();
  });
}

function readSignedPlayerInfo(raw: unknown): SignedPlayerInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as SignedPlayerInfoLike;
  const playerId = typeof value.getPlayerID === 'function' ? value.getPlayerID() : value.playerID;
  const signature =
    typeof value.getSignature === 'function' ? value.getSignature() : value.signature;
  if (typeof playerId !== 'string' || typeof signature !== 'string') return null;
  if (!playerId || !signature) return null;
  return { playerId, signature };
}

export class FbBridge {
  private sdk: FbInstantSdk | null = null;
  private pauseHandler: (() => void) | null = null;
  private resumeHandler: (() => void) | null = null;

  get available(): boolean {
    return this.sdk !== null;
  }

  /** Initialise the SDK and hand control back to the platform. */
  async init(): Promise<boolean> {
    const sdk = await waitForSdk();
    if (!sdk) return false;
    this.sdk = sdk;

    // The lifecycle callbacks are usually registered before the SDK has
    // loaded, so they are attached here as well.
    if (this.pauseHandler) sdk.onPause?.(this.pauseHandler);
    if (this.resumeHandler) sdk.onResume?.(this.resumeHandler);

    try {
      await sdk.initializeAsync?.();
    } catch (error) {
      console.warn('[tap-rush] FBInstant.initializeAsync failed.', error);
    }

    try {
      await sdk.startGameAsync?.({ locale: 'en_US' });
    } catch (error) {
      console.warn('[tap-rush] FBInstant.startGameAsync failed.', error);
    }

    return true;
  }

  /**
   * Ask Facebook to sign a payload for this player.
   *
   * The same nonce has to be used for the session request and for the score
   * submission, which is what binds a score to a round.
   */
  async signedPlayerInfo(requestPayload: string): Promise<SignedPlayerInfo | null> {
    const sdk = this.sdk;
    const getSigned = sdk?.player?.getSignedPlayerInfoAsync;
    if (!sdk || !getSigned) return null;
    try {
      const raw = await getSigned.call(sdk.player, requestPayload);
      return readSignedPlayerInfo(raw);
    } catch (error) {
      console.warn('[tap-rush] Could not get signed player info.', error);
      return null;
    }
  }

  async share(payload: SharePayload): Promise<boolean> {
    const sdk = this.sdk;
    if (!sdk?.shareAsync) return false;
    try {
      await sdk.shareAsync({
        text: payload.text,
        ...(payload.image ? { image: payload.image } : {}),
        ...(payload.data ? { data: payload.data } : {}),
      });
      return true;
    } catch (error) {
      console.warn('[tap-rush] Sharing failed.', error);
      return false;
    }
  }

  haptic(type: HapticType): void {
    const sdk = this.sdk;
    const name = HAPTIC_SDK_NAMES[type];
    if (!sdk?.performHapticFeedbackAsync) return;
    void sdk.performHapticFeedbackAsync(name).catch(() => undefined);
  }

  entryPointData(): Record<string, unknown> {
    try {
      return this.sdk?.getEntryPointData?.() ?? {};
    } catch {
      return {};
    }
  }

  onPause(callback: () => void): void {
    this.pauseHandler = callback;
    this.sdk?.onPause?.(callback);
  }

  onResume(callback: () => void): void {
    this.resumeHandler = callback;
    this.sdk?.onResume?.(callback);
  }

  logEvent(name: string): void {
    try {
      this.sdk?.logEvent?.(name);
    } catch {
      // Logging is best effort.
    }
  }
}
