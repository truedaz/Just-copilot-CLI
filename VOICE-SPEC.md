# Voice Mode Spec — ChatGPT-Style

## Goal
Add a hands-free voice mode where the AI speaks responses aloud and the user can interrupt at any point, exactly like ChatGPT's Advanced Voice Mode.

---

## Architecture Overview

```
Microphone → SpeechRecognition (STT) → handleSend()
                                             ↓
                                     server.js /api/chat
                                             ↓
                              Response text → sentence chunks
                                             ↓
                              SpeechSynthesis (TTS) ← interrupt signal
                                             ↑
                              Microphone stays hot (VAD loop)
```

No new API keys required. Both Web Speech API (`SpeechRecognition`) and Web Speech Synthesis API (`speechSynthesis`) are built into every modern browser and work completely offline for TTS.

---

## Key Components

### 1. Voice Mode Toggle
- A microphone button in the chat toolbar (beside send).
- Clicking it enters **Voice Mode** — a dedicated fullscreen/overlay UI (like ChatGPT's pulsing orb).
- The regular chat input is hidden in Voice Mode; a visual waveform/orb is shown instead.
- An "X" button exits Voice Mode and returns to text chat.

### 2. Speech-to-Text (STT) — `useSpeechRecognition` hook
- Use the browser's `window.SpeechRecognition` (or `webkitSpeechRecognition`).
- Run in **continuous + interimResults** mode.
- **While the AI is NOT speaking**: actively listen; fire the query on silence (`onend` / finalResult).
- **While the AI IS speaking**: keep the mic hot to detect interrupts (see §4).
- `interimResults: true` lets us show a live transcript as the user speaks.

```js
// src/hooks/useSpeechRecognition.js
const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
recognition.continuous = true;
recognition.interimResults = true;
recognition.lang = 'en-US';
```

### 3. Text-to-Speech (TTS) — `useSpeechSynthesis` hook
- Use `window.speechSynthesis` with `SpeechSynthesisUtterance`.
- **Sentence-chunk the response** before speaking. Split on `.`, `!`, `?`, `\n` boundaries.
- Speak chunks sequentially via `onend` chaining — this is critical for interruption granularity.
- Maintain a `speakingRef` boolean and a `currentUtteranceRef`.

```js
function speakInChunks(text, onChunkStart, onDone, onInterrupt) {
  const chunks = splitSentences(text);  // ["Hello.", "Here is the answer.", ...]
  let i = 0;
  const speakNext = () => {
    if (i >= chunks.length) { onDone(); return; }
    const utt = new SpeechSynthesisUtterance(chunks[i++]);
    utt.onstart = () => onChunkStart(utt);
    utt.onend = speakNext;
    speechSynthesis.speak(utt);
  };
  speakNext();
}
```

**Voice selection**: Prefer a high-quality voice (e.g. `Google US English`, `Samantha` on macOS). Expose a dropdown in Settings to pick preferred voice.

### 4. Interruption — The Core Mechanic

This is what makes it feel like ChatGPT.

**Approach: continuous microphone listening during playback**

While TTS is speaking:
1. Keep `SpeechRecognition` running.
2. On any `speechstart` event (voice activity detected), immediately:
   - Call `speechSynthesis.cancel()` — stops playback instantly.
   - Set `speakingRef.current = false`.
   - Wait for the user to finish speaking (final transcript from STT).
   - Send the new query.

```js
recognition.addEventListener('speechstart', () => {
  if (speakingRef.current) {
    speechSynthesis.cancel();
    speakingRef.current = false;
    // UI: show "listening..." state
  }
});
```

**Echo cancellation** — REQUIRED. Without it the mic picks up the speaker and interrupts itself.
```js
navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
```
Pass this stream to `recognition.start()` is not directly possible via Web Speech API — but the browser automatically uses the default input device, which uses system-level echo cancellation. On macOS/Windows this is sufficient. Test on headphones vs speakers.

**Debounce guard**: Add a 300ms debounce after TTS starts before the interrupt listener activates. Prevents the first syllable of TTS from triggering a self-interrupt.

### 5. Response Streaming (Server Change)

**Problem**: The current `server.js` waits for the entire `gh copilot` response before returning it. For voice, we want to start speaking as soon as the first sentence arrives.

**Solution A (Recommended) — Fake streaming with full response + chunked speak**:
No server change needed. Once the full response arrives, split it into sentences and start speaking immediately. The latency is the CLI's response time (~2–4s), which is acceptable.

**Solution B — True streaming via SSE**:
Change `/api/chat` to use Server-Sent Events (SSE). Pipe `exec`'s stdout line-by-line:
```js
// server.js
app.get('/api/chat/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  const proc = spawn('gh', ['copilot', '-p', prompt, '-s']);
  proc.stdout.on('data', chunk => res.write(`data: ${chunk}\n\n`));
  proc.on('close', () => res.write('data: [DONE]\n\n'));
});
```
**Note**: `gh copilot` CLI may buffer stdout, making Solution A practical for now.

Start with **Solution A**. Upgrade to B if latency is a problem.

### 6. Voice Mode UI States

| State | Visual | Orb behaviour |
|-------|--------|---------------|
| **Idle** | Orb dim | Static |
| **Listening** | Orb glows | Pulses with mic amplitude |
| **Thinking** | Spinner / orb dim | Slow pulse |
| **Speaking** | Orb glows | Pulses with speech amplitude |
| **Interrupted** | Brief flash | Shrinks then returns to Listening |

Show a live transcript overlay (interim STT results) while the user speaks.
Show the AI response text as subtitles while TTS plays.

---

## File Changes Required

| File | Change |
|------|--------|
| `src/hooks/useSpeechRecognition.js` | New hook — STT lifecycle |
| `src/hooks/useSpeechSynthesis.js` | New hook — TTS + chunk speaker |
| `src/components/VoiceOrb.jsx` | New component — animated orb/waveform UI |
| `src/App.jsx` | Add voice mode state, wire hooks, toggle button |
| `src/App.css` | Voice overlay styles |
| `server.js` | No change required for Solution A |

---

## Implementation Order

1. **`useSpeechSynthesis` hook** — chunk speak + cancel API
2. **`useSpeechRecognition` hook** — continuous listen, final transcript callback
3. **Wire into `App.jsx`** — voice mode flag, call `handleSend` from STT hook
4. **Interrupt logic** — speechstart → cancel TTS → re-listen
5. **`VoiceOrb` UI** — the visual polish
6. **Echo cancellation testing** — verify on built-in mic vs external speaker

---

## Edge Cases & Gotchas

- **`speechSynthesis` pauses on tab switch** — use `document.addEventListener('visibilitychange')` to resume.
- **Chrome bug**: `speechSynthesis` cuts out after ~15s. Fix: call `speechSynthesis.pause()` + `resume()` on a 14s interval while speaking.
- **Safari** requires a user gesture to start `SpeechSynthesis`. The voice mode button click counts.
- **Firefox** does not support `SpeechRecognition` without a flag. Show a warning.
- **Empty interim results** can fire `onend` prematurely. Only trigger `handleSend` on `isFinal === true` results.
- **Network latency**: While waiting for the CLI response, keep showing "thinking" state so the user doesn't speak again prematurely.

---

## Non-Goals (out of scope for this spec)

- Server-side TTS (ElevenLabs, OpenAI TTS) — overkill, adds cost and latency
- Wake word detection ("Hey Copilot") — adds complexity, not needed
- Streaming from `gh copilot` CLI — pursue only if response latency is a problem
