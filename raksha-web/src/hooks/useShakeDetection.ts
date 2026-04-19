import { useEffect, useRef, useCallback } from 'react';

const SHAKE_THRESHOLD = 15;
const SHAKE_COUNT_NEEDED = 4;
const SHAKE_WINDOW_MS = 1500;

export function useShakeDetection(onShake: () => void, enabled: boolean) {
    const lastAccel = useRef<{ x: number; y: number; z: number } | null>(null);
    const shakeCount = useRef(0);
    const windowStart = useRef(0);
    const onShakeRef = useRef(onShake);

    useEffect(() => { onShakeRef.current = onShake; }, [onShake]);

    const handleMotion = useCallback((e: DeviceMotionEvent) => {
        const accel = e.accelerationIncludingGravity;
        if (!accel) return;
        const ax = accel.x ?? 0;
        const ay = accel.y ?? 0;
        const az = accel.z ?? 0;

        if (lastAccel.current) {
            const delta = Math.abs(ax - lastAccel.current.x)
                + Math.abs(ay - lastAccel.current.y)
                + Math.abs(az - lastAccel.current.z);

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
        lastAccel.current = { x: ax, y: ay, z: az };
    }, []);

    useEffect(() => {
        if (!enabled) return;
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
