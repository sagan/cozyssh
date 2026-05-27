import { useEffect, useRef } from 'react';

/**
 * A React hook that prevents the screen from locking/dimming using the Wake Lock API.
 * @param shouldPreventLock - Boolean flag to enable or disable the wake lock.
 */
export function useWakeLock(shouldPreventLock: boolean): void {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    const requestWakeLock = async () => {
      // Check for API support and ensure a lock isn't already active
      if ('wakeLock' in navigator && !wakeLockRef.current) {
        try {
          const lock = await navigator.wakeLock.request('screen');
          wakeLockRef.current = lock;

          // The browser may release the lock automatically (e.g., when minimized).
          // We clear our ref when that happens so we know to request a new one later.
          lock.addEventListener('release', () => {
            wakeLockRef.current = null;
          });
        } catch {
          // Fail silently per requirements
        }
      }
    };

    const releaseWakeLock = async () => {
      if (wakeLockRef.current) {
        try {
          await wakeLockRef.current.release();
        } catch {
          // Fail silently per requirements
        }
        wakeLockRef.current = null;
      }
    };

    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && shouldPreventLock) {
        await requestWakeLock();
      }
    };

    if (shouldPreventLock) {
      requestWakeLock();
      document.addEventListener('visibilitychange', handleVisibilityChange);
    } else {
      releaseWakeLock();
    }

    // Cleanup on unmount or when shouldPreventLock changes
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseWakeLock();
    };
  }, [shouldPreventLock]);
}