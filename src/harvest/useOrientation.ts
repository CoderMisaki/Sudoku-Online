"use client";
import { useSyncExternalStore } from 'react';
import { orientationObserver, type OrientationSnapshot } from './orientation';

const SERVER_SNAPSHOT: OrientationSnapshot = {
  landscape: true,
  width: 1280,
  height: 720,
  device: 'desktop',
  ready: false,
};

/**
 * useSyncExternalStore guarantees:
 *  - one subscription per component (no duplicate listeners),
 *  - referentially stable snapshots (the observer only emits on real change),
 *  - therefore no infinite render loop, which the old useState+resize code could hit.
 */
export function useOrientation(): OrientationSnapshot {
  return useSyncExternalStore(
    (cb) => orientationObserver.subscribe(cb),
    orientationObserver.getSnapshot,
    () => SERVER_SNAPSHOT,
  );
}
