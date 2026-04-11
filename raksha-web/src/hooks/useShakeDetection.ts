import { useEffect, useRef, useCallback } from 'react';

const SHAKE_THRESHOLD = 15;   // m/s² delta to count as a shake
const SHAKE_COUNT_NEEDED = 4; // shakes needed within window
const SHAKE_WINDOW_MS = 1500; // time window

export function useShakeDetection(onShake: () => void, enabled: boolean) {
    const lastAccel = useRef<{ x: number; y: number; z: number } | null>(null);
    const shakeCount = useRef(0);
    const windowStart = useRef(0);
    const onShakeRef = useRef(onShake);

    useEffect(() => { onShakeRef.current = onShake; }, [onShake]);

    const handleMotion = useCallback((e: DeviceMotionEvent) => {
        const accel = e.accelerationIncludingGravity;
        if (!accel) return;
        const { x = 0, y = 0, z = 0 } = accel;

        if (lastAccel.current) {
            const delta = Math.abs(x - lastAccel.current.x)
                + Math.abs(y - lastAccel.current.y)
                + Math.abs(z - lastAccel.current.z);

            if (delta > SHAKE_THRESHOLD) {
                const now = Date.now();
                if (now - windowStart.current > SHAKE_WINDOW_MS) {
                    shakeCount.current = 1;
                    windowStart.current = now;
                } else {
                    shakeCount.current++;
                }
                if (shakeCount.current >= SHAKE_COUNT_NEEDED) {
                    shakeCount.current = 0;
                    onShakeRef.current();
                }
            }
        }
        lastAccel.current = { x: x ?? 0, y: y ?? 0, z: z ?? 0 };
    }, []);

    useEffect(() => {
        if (!enabled) return;
        // iOS 13+ requires permission
        const requestAndListen = async () => {
            const dme = DeviceMotionEvent as any;
            if (typeof dme.requestPermission === 'function') {
                try { await dme.requestPermission(); } catch { return; }
            }
            window.addEventListener('devicemotion', handleMotion);
        };
        requestAndListen();
        return () => window.removeEventListener('devicemotion', handleMotion);
    }, [enabled, handleMotion]);
}
