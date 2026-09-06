// Pure connection-overlay state machine (no React, no DOM).
//
// The UI must never guess whether the game is playable: it derives the overlay
// from `(screen, status)` only. The rules encode the hard requirements:
//
//   • socket OPEN is NOT enough — `hello`/`syncing` still mean "loading"
//   • a completed handshake + snapshot (`ready`) ALWAYS clears the overlay
//   • nothing may stay in `reconnecting` forever: after the retry budget the
//     session moves to `error`, which renders an actionable FAILED state
//   • the character creator is never covered by a "loading" overlay (only by a
//     genuine connection problem)
import type { ConnectionStatus, Screen } from './types';

export type OverlayKind = 'loading' | 'reconnecting' | 'recovering' | 'failed';

export interface OverlayState {
  kind: OverlayKind;
  title: string;
  hint: string;
  /** Show the destructive/secondary "reload page" action. */
  allowReload: boolean;
}

/** Statuses that mean "the session is fine, do not cover the game". */
const TERMINAL_STATUSES: ConnectionStatus[] = ['ready', 'connected', 'closed'];

export function isTerminalStatus(status: ConnectionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * The overlay to render, or `null` when the game must be visible/interactive.
 */
export function connectionOverlay(screen: Screen, status: ConnectionStatus): OverlayState | null {
  // The dedicated error screen owns this state.
  if (screen === 'error') return null;

  // In the character creator the handshake already succeeded (`ready`); the
  // transient loading states must not block character creation.
  const inCreator = screen === 'creator';
  const inLoading = screen === 'loading' || screen === 'orientation';

  // The pre-game screens ALWAYS own an overlay: a terminal status without a
  // screen change would otherwise render an empty page. (The session's snapshot
  // watchdog resolves that contradiction — resync, then FAILED.)
  if (isTerminalStatus(status)) {
    if (!inLoading) return null;
    return {
      kind: 'loading',
      title: 'Menyiapkan Dunia...',
      hint: 'Menunggu snapshot world dari server.',
      allowReload: false,
    };
  }

  switch (status) {
    case 'connecting':
      return {
        kind: 'loading',
        title: 'Menghubungkan ke Server...',
        hint: 'Sinkronisasi world, farm, inventory, dan pemain lain.',
        allowReload: false,
      };
    case 'hello':
    case 'syncing': {
      if (inCreator) return null;
      // Already on the game screen? Then this is a RE-handshake of an existing
      // session (reconnect/resync), not a first load — say so.
      if (screen === 'game') {
        return {
          kind: 'recovering',
          title: 'Memulihkan Koneksi...',
          hint: 'Menyambungkan ulang ke world yang sama. Karakter dan farm tetap aman.',
          allowReload: false,
        };
      }
      return status === 'hello'
        ? {
            kind: 'loading',
            title: 'Menyiapkan Dunia...',
            hint: 'Menunggu jawaban server untuk sesi kamu.',
            allowReload: false,
          }
        : {
            kind: 'loading',
            title: 'Memuat Data Dunia...',
            hint: 'Menerapkan snapshot world, farm, dan inventory.',
            allowReload: false,
          };
    }
    case 'reconnecting':
    case 'lost':
      return {
        kind: 'reconnecting',
        title: 'Menghubungkan Kembali...',
        hint: 'Koneksi terputus. Data kamu aman — pemulihan berjalan otomatis.',
        allowReload: false,
      };
    case 'recovering':
      return {
        kind: 'recovering',
        title: 'Memulihkan Koneksi...',
        hint: 'Menyambungkan ulang ke world yang sama. Karakter dan farm tetap aman.',
        allowReload: false,
      };
    case 'error':
      return {
        kind: 'failed',
        title: 'Koneksi belum berhasil dipulihkan',
        hint: 'Server tidak menjawab setelah beberapa percobaan. Data kamu aman — coba sambungkan lagi tanpa memuat ulang.',
        allowReload: true,
      };
    default:
      return null;
  }
}

/** Convenience boolean used by the game shell and the tests. */
export function shouldShowConnectionOverlay(screen: Screen, status: ConnectionStatus): boolean {
  return connectionOverlay(screen, status) !== null;
}
