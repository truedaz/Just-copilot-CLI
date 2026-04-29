import { useRef, useCallback } from 'react';

/**
 * Reads real-time microphone amplitude via the Web Audio API.
 * Returns a volumeRef (0–1, smoothed) that is updated every animation frame.
 * Call start() when entering voice mode, stop() when exiting.
 */
export function useAudioLevel() {
  const volumeRef = useRef(0);
  const contextRef = useRef(null);
  const analyserRef = useRef(null);
  const dataRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    contextRef.current?.close();
    contextRef.current = null;
    analyserRef.current = null;
    dataRef.current = null;
    volumeRef.current = 0;
  }, []);

  const start = useCallback(async () => {
    stop(); // clean up any previous session

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      streamRef.current = stream;

      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      contextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      analyserRef.current = analyser;

      const bufLen = analyser.frequencyBinCount;
      dataRef.current = new Uint8Array(bufLen);

      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(dataRef.current);

        // RMS over the waveform buffer → 0..1
        let sum = 0;
        for (let i = 0; i < bufLen; i++) {
          const norm = (dataRef.current[i] / 128.0) - 1.0; // -1..1
          sum += norm * norm;
        }
        const rms = Math.sqrt(sum / bufLen);
        // Smooth toward new value; scale up to make subtle speech visible
        volumeRef.current = volumeRef.current * 0.8 + Math.min(1, rms * 5) * 0.2;

        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      // Permission denied or hardware error — volume stays 0, silently degrade
      console.warn('useAudioLevel: could not open microphone:', err.message);
    }
  }, [stop]);

  return { volumeRef, start, stop };
}
