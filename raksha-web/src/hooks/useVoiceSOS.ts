import { useEffect, useRef, useCallback, useState } from 'react';

const TRIGGER_PHRASES = ['help', 'raksha help', 'sos', 'emergency', 'bachao'];

export function useVoiceSOS(onTrigger: () => void, enabled: boolean) {
    const recognitionRef = useRef<any>(null);
    const onTriggerRef = useRef(onTrigger);
    const [listening, setListening] = useState(false);
    const restartRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    useEffect(() => { onTriggerRef.current = onTrigger; }, [onTrigger]);

    const start = useCallback(() => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) return;

        const rec = new SpeechRecognition();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = 'en-IN';
        recognitionRef.current = rec;

        rec.onresult = (e: any) => {
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const transcript = e.results[i][0].transcript.toLowerCase().trim();
                if (TRIGGER_PHRASES.some(p => transcript.includes(p))) {
                    onTriggerRef.current();
                    break;
                }
            }
        };

        rec.onend = () => {
            setListening(false);
            if (enabled) {
                // auto-restart after brief pause
                restartRef.current = setTimeout(() => { try { rec.start(); setListening(true); } catch { } }, 500);
            }
        };

        rec.onerror = () => { setListening(false); };

        try { rec.start(); setListening(true); } catch { }
    }, [enabled]);

    const stop = useCallback(() => {
        clearTimeout(restartRef.current);
        try { recognitionRef.current?.stop(); } catch { }
        recognitionRef.current = null;
        setListening(false);
    }, []);

    useEffect(() => {
        if (enabled) start();
        else stop();
        return stop;
    }, [enabled, start, stop]);

    return { listening, supported: !!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition };
}
