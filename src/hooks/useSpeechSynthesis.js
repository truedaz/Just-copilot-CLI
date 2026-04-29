import { useRef, useState, useCallback, useEffect } from 'react';

/**
 * Split text into sentence-sized chunks for natural-sounding TTS.
 */
function splitSentences(text) {
  const chunks = text.match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g) || [text];
  return chunks.map((s) => s.trim()).filter(Boolean);
}

/**
 * Pick the best available voice — prefers Google UK English Male in Chrome.
 */
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  return (
    voices.find((v) => v.name === 'Google UK English Male') ||
    voices.find((v) => v.name === 'Google US English Male') ||
    voices.find((v) => v.name.includes('Google') && /male/i.test(v.name)) ||
    voices.find((v) => v.name === 'Google US English') ||
    voices.find((v) => v.name === 'Samantha') ||
    voices.find((v) => v.lang === 'en-US' && v.localService) ||
    voices.find((v) => v.lang.startsWith('en')) ||
    voices[0] ||
    null
  );
}

/**
 * TTS hook using the Web Speech Synthesis API.
 *
 * Text-chat mode:
 *   speak(text, { onChunkStart, onDone })  — cancels current, speaks full text
 *   cancel()                               — stop immediately
 *
 * Voice streaming mode (start speaking before full response arrives):
 *   beginStream({ onChunkStart, onDone }) — call once before first sentence
 *   appendSentence(text)                  — call for each sentence as it arrives
 *   endStream()                           — call when no more sentences coming
 */
export function useSpeechSynthesis() {
  const [speaking, setSpeaking] = useState(false);
  const speakingRef = useRef(false);
  const streamingRef = useRef(false); // true while a streaming send is in progress
  const keepAliveRef = useRef(null);
  const pendingRef = useRef(0);    // utterances currently in the synthesis queue
  const onDoneRef = useRef(null);  // called when queue drains and stream is done
  const onChunkRef = useRef(null); // called when each utterance starts

  // Chrome bug: speechSynthesis silently stops after ~15 s.
  const startKeepAlive = useCallback(() => {
    clearInterval(keepAliveRef.current);
    keepAliveRef.current = setInterval(() => {
      if (speechSynthesis.speaking) {
        speechSynthesis.pause();
        speechSynthesis.resume();
      }
    }, 14000);
  }, []);

  const stopKeepAlive = useCallback(() => {
    clearInterval(keepAliveRef.current);
    keepAliveRef.current = null;
  }, []);

  // Pause/resume when tab is hidden/shown
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        speechSynthesis.pause();
      } else if (speakingRef.current) {
        speechSynthesis.resume();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Fire onDone when queue is empty AND stream is finished
  const _checkDone = useCallback(() => {
    if (pendingRef.current <= 0 && speakingRef.current && !streamingRef.current) {
      speakingRef.current = false;
      setSpeaking(false);
      stopKeepAlive();
      const cb = onDoneRef.current;
      onDoneRef.current = null;
      cb?.();
    }
  }, [stopKeepAlive]);

  const cancel = useCallback(() => {
    speakingRef.current = false;
    streamingRef.current = false;
    pendingRef.current = 0;
    onDoneRef.current = null;
    setSpeaking(false);
    stopKeepAlive();
    speechSynthesis.cancel();
  }, [stopKeepAlive]);

  // Internal: create and enqueue one utterance
  const _queueSentence = useCallback((text) => {
    const utt = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) utt.voice = voice;
    utt.rate = 1.15; // slightly faster feels crisper
    pendingRef.current++;
    utt.onstart = () => onChunkRef.current?.(text);
    utt.onend = () => {
      pendingRef.current = Math.max(0, pendingRef.current - 1);
      _checkDone();
    };
    utt.onerror = (e) => {
      pendingRef.current = Math.max(0, pendingRef.current - 1);
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      _checkDone();
    };
    speechSynthesis.speak(utt);
  }, [_checkDone]);

  // ── Text-chat mode ────────────────────────────────────────────────────────
  const speak = useCallback((text, { onChunkStart, onDone } = {}) => {
    speechSynthesis.cancel();
    pendingRef.current = 0;
    streamingRef.current = false;
    const sentences = splitSentences(text);
    if (!sentences.length) { onDone?.(); return; }
    onChunkRef.current = onChunkStart || null;
    onDoneRef.current = onDone || null;
    speakingRef.current = true;
    setSpeaking(true);
    startKeepAlive();
    const doSpeak = () => sentences.forEach((s) => _queueSentence(s));
    if (speechSynthesis.getVoices().length === 0) {
      speechSynthesis.addEventListener('voiceschanged', doSpeak, { once: true });
    } else {
      doSpeak();
    }
  }, [startKeepAlive, _queueSentence]);

  // ── Streaming mode ────────────────────────────────────────────────────────

  // Call ONCE before the first appendSentence
  const beginStream = useCallback(({ onChunkStart, onDone } = {}) => {
    speechSynthesis.cancel();
    pendingRef.current = 0;
    onChunkRef.current = onChunkStart || null;
    onDoneRef.current = onDone || null;
    speakingRef.current = true;
    streamingRef.current = true;
    setSpeaking(true);
    startKeepAlive();
  }, [startKeepAlive]);

  // Call for each sentence as it arrives from the stream
  const appendSentence = useCallback((text) => {
    const doQueue = () => _queueSentence(text);
    if (speechSynthesis.getVoices().length === 0) {
      speechSynthesis.addEventListener('voiceschanged', doQueue, { once: true });
    } else {
      doQueue();
    }
  }, [_queueSentence]);

  // Call once when no more sentences are coming; triggers onDone when queue drains
  const endStream = useCallback(() => {
    streamingRef.current = false;
    _checkDone();
  }, [_checkDone]);

  return { speaking, speak, appendSentence, beginStream, endStream, cancel };
}
