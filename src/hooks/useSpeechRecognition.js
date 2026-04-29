import { useRef, useState, useCallback, useEffect } from 'react';

const SpeechRecognitionAPI =
  (typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)) || null;

/**
 * Continuous speech-to-text hook using the Web Speech API.
 * Callbacks are stored in refs so they never go stale.
 *
 * @param {object} opts
 * @param {(text: string) => void} opts.onFinalResult   – called when a final transcript is ready
 * @param {(text: string) => void} opts.onInterimResult – called with live partial transcript
 * @param {() => void}             opts.onSpeechStart   – called the moment voice activity is detected
 */
export function useSpeechRecognition({ onFinalResult, onInterimResult, onSpeechStart } = {}) {
  const supported = !!SpeechRecognitionAPI;
  const recRef = useRef(null);
  const activeRef = useRef(false);
  const [listening, setListening] = useState(false);

  // Keep callbacks fresh in refs so handlers created once never go stale
  const onFinalRef = useRef(onFinalResult);
  const onInterimRef = useRef(onInterimResult);
  const onSpeechStartRef = useRef(onSpeechStart);
  onFinalRef.current = onFinalResult;
  onInterimRef.current = onInterimResult;
  onSpeechStartRef.current = onSpeechStart;

  useEffect(() => {
    if (!SpeechRecognitionAPI) return;

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recRef.current = recognition;

    recognition.onresult = (e) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += text;
        else interim += text;
      }
      if (interim) onInterimRef.current?.(interim);
      if (final.trim()) onFinalRef.current?.(final.trim());
    };

    recognition.onspeechstart = () => {
      onSpeechStartRef.current?.();
    };

    // Auto-restart to maintain continuous listening
    recognition.onend = () => {
      if (activeRef.current) {
        try { recognition.start(); } catch (_) {}
      } else {
        setListening(false);
      }
    };

    recognition.onerror = (e) => {
      // These are all non-fatal in continuous mode
      if (['no-speech', 'audio-capture', 'aborted'].includes(e.error)) return;
      console.warn('SpeechRecognition error:', e.error);
    };

    return () => {
      activeRef.current = false;
      try { recognition.abort(); } catch (_) {}
      recRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback(() => {
    if (!supported || !recRef.current) return;
    activeRef.current = true;
    setListening(true);
    try { recRef.current.start(); } catch (_) {}
  }, [supported]);

  const stop = useCallback(() => {
    if (!recRef.current) return;
    activeRef.current = false;
    try { recRef.current.abort(); } catch (_) {}
    setListening(false);
  }, []);

  return { listening, supported, start, stop };
}
