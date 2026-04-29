import { useState, useEffect, useRef } from 'react';
import './App.css';
import SettingsPanel from './SettingsPanel.jsx';
import VoiceOrb from './components/VoiceOrb.jsx';
import { useSpeechRecognition } from './hooks/useSpeechRecognition.js';
import { useSpeechSynthesis } from './hooks/useSpeechSynthesis.js';
import { useAudioLevel } from './hooks/useAudioLevel.js';

// Detect "remember that X" in user input and extract the fact
const REMEMBER_RE = /^(?:please\s+)?remember\s+(?:that\s+)?(.+)$/i;

// Strip markdown formatting so TTS reads cleanly
function stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, '') // fenced code blocks
    .replace(/`([^`]+)`/g, '$1')    // inline code
    .replace(/#{1,6}\s+/g, '')      // headers
    .replace(/\*\*(.+?)\*\*/g, '$1') // bold
    .replace(/\*(.+?)\*/g, '$1')     // italic
    .replace(/~~(.+?)~~/g, '$1')     // strikethrough
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/^[-*+]\s+/gm, '')      // unordered bullets
    .replace(/^\d+\.\s+/gm, '')      // ordered list numbers
    .replace(/^[-_*]{3,}$/gm, '')    // horizontal rules
    .replace(/\n{3,}/g, '\n\n')      // excessive blank lines
    .trim();
}

const MODE_OPTIONS = ['Agent', 'Ask', 'Plan'];
const EFFORT_OPTIONS = [
  { label: 'Auto', value: '' },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'XHigh', value: 'xhigh' },
];
const MODEL_OPTIONS = [
  { label: 'Default (fastest)', value: 'default' },
  { label: 'GPT-4.1 (0x)', value: 'gpt-4.1' },
  { label: 'GPT-5 mini (0x)', value: 'gpt-5-mini' },
  { label: 'Raptor mini (0x)', value: 'raptor-mini' },
  { label: 'GPT-5.2 (1x)', value: 'gpt-5.2' },
  { label: 'Claude Sonnet 4.5 (1x)', value: 'claude-sonnet-4.5' },
  { label: 'Gemini 2.5 Pro (1x)', value: 'gemini-2.5-pro' },
  { label: 'Gemini 3 Flash (0.33x)', value: 'gemini-3-flash' },
  { label: 'Claude Opus 4.7 (7.5x)', value: 'claude-opus-4.7' },
  { label: 'GPT-5.5 (7.5x)', value: 'gpt-5.5' },
];

function App() {
  // Chat state
  const [chats, setChats] = useState(() => {
    const saved = localStorage.getItem('coplit-chats');
    return saved ? JSON.parse(saved) : [];
  });
  const [currentChatId, setCurrentChatId] = useState(chats[0]?.id || null);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState(MODE_OPTIONS[0]);
  const [model, setModel] = useState(MODEL_OPTIONS[0].value);
  const [effort, setEffort] = useState(EFFORT_OPTIONS[0].value);
  const [editingChatId, setEditingChatId] = useState(null);
  const [editName, setEditName] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [persona, setPersona] = useState(() => localStorage.getItem('coplit-persona') || '');
  const [memory, setMemory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('coplit-memory') || '[]'); } catch { return []; }
  });

  const savePersona = (val) => { setPersona(val); localStorage.setItem('coplit-persona', val); };
  const saveMemory = (val) => { setMemory(val); localStorage.setItem('coplit-memory', JSON.stringify(val)); };

  const bottomRef = useRef(null);

  // ── Voice mode state ───────────────────────────────────────────────────────
  const [voiceMode, setVoiceMode] = useState(false);
  // 'idle' | 'listening' | 'thinking' | 'speaking'
  const [voiceState, setVoiceState] = useState('idle');
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceSubtitle, setVoiceSubtitle] = useState('');

  // Refs so callbacks in hooks always see current values without stale closures
  const voiceStateRef = useRef(voiceState);
  voiceStateRef.current = voiceState;
  const ttsStartTimeRef = useRef(0);

  const { speak, cancel: cancelSpeech } = useSpeechSynthesis();
  const { volumeRef, start: startAudio, stop: stopAudio } = useAudioLevel();
  const abortControllerRef = useRef(null);

  const onVoiceFinalResult = (transcript) => {
    // Only act when we are listening (not mid-thinking or mid-speaking)
    if (voiceStateRef.current !== 'listening') return;
    setVoiceTranscript('');
    handleVoiceSend(transcript);
  };

  const onVoiceInterimResult = (interim) => {
    if (voiceStateRef.current === 'listening') setVoiceTranscript(interim);
  };

  const onVoiceSpeechStart = () => {
    // Interrupt TTS only if we are speaking AND enough time has passed
    // (the 400 ms guard prevents the TTS audio itself from triggering interruption)
    if (
      voiceStateRef.current === 'speaking' &&
      Date.now() - ttsStartTimeRef.current > 400
    ) {
      // Abort the in-flight stream so appendSentence stops feeding the queue
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      cancelSpeech();
      // Update ref synchronously so onVoiceFinalResult (which fires next) sees 'listening'
      voiceStateRef.current = 'listening';
      setVoiceState('listening');
      setVoiceSubtitle('');
    }
  };

  const { supported: sttSupported, start: startSTT, stop: stopSTT } = useSpeechRecognition({
    onFinalResult: onVoiceFinalResult,
    onInterimResult: onVoiceInterimResult,
    onSpeechStart: onVoiceSpeechStart,
  });

  const handleVoiceEnter = () => {
    setVoiceMode(true);
    setVoiceState('listening');
    setVoiceTranscript('');
    setVoiceSubtitle('');
    startSTT();
    startAudio(); // start real-time mic level metering
  };

  const handleVoiceExit = () => {
    abortControllerRef.current?.abort(); // kill in-flight CLI fetch immediately
    abortControllerRef.current = null;
    cancelSpeech();
    stopSTT();
    stopAudio(); // stop mic level metering & release mic
    setVoiceMode(false);
    setVoiceState('idle');
    setVoiceTranscript('');
    setVoiceSubtitle('');
  };

  // ── Auto-scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chats]);

  // Create new chat function (defined early so useEffect can use it)
  const handleNewChat = () => {
    const newId = Date.now();
    const newChat = { id: newId, name: `New Chat`, messages: [] };
    const updated = [newChat, ...chats];
    setChats(updated);
    localStorage.setItem('coplit-chats', JSON.stringify(updated));
    setCurrentChatId(newId);
  };

  // Handle first load: create a chat if none exist
  useEffect(() => {
    if (chats.length === 0) {
      handleNewChat();
    }
  }, []);

  // Save chats to localStorage
  const saveChats = (newChats) => {
    setChats(newChats);
    localStorage.setItem('coplit-chats', JSON.stringify(newChats));
  };

  // Send message
  // textOverride: if provided, use this text instead of the input state (for voice mode)
  const handleSend = async (textOverride) => {
    const text = textOverride !== undefined ? textOverride : input;
    if (!text.trim()) return;

    // Check for "remember that X" pattern
    const rememberMatch = text.match(REMEMBER_RE);
    if (rememberMatch) {
      const fact = rememberMatch[1].trim();
      const updated = [...memory, { id: Date.now(), text: fact }];
      saveMemory(updated);
      const ack = { role: 'agent', text: `Got it, I'll remember: "${fact}"` };
      const userMsg = { role: 'user', text };
      const updatedChats = chats.map(c =>
        c.id === currentChatId ? { ...c, messages: [...c.messages, userMsg, ack] } : c
      );
      saveChats(updatedChats);
      if (textOverride === undefined) setInput('');
      return;
    }

    // Build context-enriched prompt
    let enrichedPrompt = text;
    const contextParts = [];
    if (persona) contextParts.push(`[PERSONA/SYSTEM CONTEXT]\n${persona.trim()}\n[END PERSONA]`);
    if (memory.length > 0) {
      contextParts.push(`[USER MEMORY]\n${memory.map(m => `- ${m.text}`).join('\n')}\n[END MEMORY]`);
    }
    if (contextParts.length > 0) {
      enrichedPrompt = `${contextParts.join('\n\n')}\n\n[USER PROMPT]\n${text}`;
    }

    const userMessage = { role: 'user', text };
    const updatedWithUser = chats.map(chat =>
      chat.id === currentChatId
        ? { ...chat, messages: [...chat.messages, userMessage] }
        : chat
    );
    saveChats(updatedWithUser);
    if (textOverride === undefined) setInput('');

    try {
      const response = await fetch('http://localhost:3001/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: enrichedPrompt, model, mode, effort })
      });
      
      const data = await response.json();
      
      if (data.response) {
        const updatedWithAgent = updatedWithUser.map(chat =>
          chat.id === currentChatId
            ? { ...chat, messages: [...chat.messages, { role: 'agent', text: data.response }] }
            : chat
        );
        saveChats(updatedWithAgent);
        return data.response; // returned so voice mode can speak it
      } else if (data.error) {
        if (textOverride === undefined) alert('Error: ' + data.error);
      }
    } catch (err) {
      console.error('Failed to connect to proxy server:', err);
    }
  };

  // Voice-mode send: fetches response then speaks it sentence-by-sentence
  const handleVoiceSend = async (transcript) => {
    if (!transcript.trim()) return;

    // Build enriched prompt (same as handleSend, plus short voice note appended)
    const contextParts = [];
    if (persona) contextParts.push(`[PERSONA/SYSTEM CONTEXT]\n${persona.trim()}\n[END PERSONA]`);
    if (memory.length > 0) {
      contextParts.push(`[USER MEMORY]\n${memory.map(m => `- ${m.text}`).join('\n')}\n[END MEMORY]`);
    }
    const voiceNote = 'Reply conversationally in 2-3 plain sentences. No markdown, no lists.';
    const userPart = contextParts.length > 0
      ? `${contextParts.join('\n\n')}\n\n[USER PROMPT]\n${transcript}\n\n(${voiceNote})`
      : `${transcript}\n\n${voiceNote}`;
    const enrichedPrompt = userPart;

    // Save user message to chat immediately
    const userMessage = { role: 'user', text: transcript };
    const updatedWithUser = chats.map(chat =>
      chat.id === currentChatId
        ? { ...chat, messages: [...chat.messages, userMessage] }
        : chat
    );
    saveChats(updatedWithUser);

    // Stop STT while thinking/speaking so the bot can't hear its own TTS output
    stopSTT();
    setVoiceState('thinking');
    // Update ref synchronously so interrupt check is accurate
    voiceStateRef.current = 'thinking';

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch('http://localhost:3001/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: enrichedPrompt, model, mode, effort }),
        signal: controller.signal,
      });

      const data = await response.json();
      if (!data.response) {
        voiceStateRef.current = 'listening';
        setVoiceState('listening');
        return;
      }

      // Save response to chat history
      const updatedWithAgent = updatedWithUser.map(chat =>
        chat.id === currentChatId
          ? { ...chat, messages: [...chat.messages, { role: 'agent', text: data.response }] }
          : chat
      );
      saveChats(updatedWithAgent);

      // Speak the response — strip markdown so TTS reads cleanly
      const spokenText = stripMarkdown(data.response);
      voiceStateRef.current = 'speaking';
      setVoiceState('speaking');
      ttsStartTimeRef.current = Date.now();
      speak(spokenText, {
        onChunkStart: (chunk) => setVoiceSubtitle(chunk),
        onDone: () => {
          voiceStateRef.current = 'listening';
          setVoiceState('listening');
          setVoiceSubtitle('');
          // Delay restart so trailing TTS speaker echo isn't picked up by STT
          setTimeout(() => startSTT(), 800);
        },
      });

    } catch (err) {
      if (err.name === 'AbortError') return; // user pressed X — already handled
      console.error('Voice error:', err);
      voiceStateRef.current = 'listening';
      setVoiceState('listening');
      setTimeout(() => startSTT(), 800);
    } finally {
      abortControllerRef.current = null;
    }
  };

  // Delete chat
  const handleDeleteChat = (e, id) => {
    e.stopPropagation();
    const updated = chats.filter(c => c.id !== id);
    saveChats(updated);
    if (currentChatId === id) {
      setCurrentChatId(updated[0]?.id || null);
    }
  };

  // Rename chat
  const handleStartEdit = (e, chat) => {
    e.stopPropagation();
    setEditingChatId(chat.id);
    setEditName(chat.name);
  };

  const handleSaveEdit = (e, id) => {
    e.stopPropagation();
    if (editName.trim()) {
      const updated = chats.map(c => c.id === id ? { ...c, name: editName } : c);
      saveChats(updated);
    }
    setEditingChatId(null);
  };

  const handleCancelEdit = (e) => {
    e.stopPropagation();
    setEditingChatId(null);
  };

  // Select chat
  const handleSelectChat = (id) => {
    if (editingChatId) return; // Don't switch while editing
    setCurrentChatId(id);
  };

  const [speakingMsgIndex, setSpeakingMsgIndex] = useState(null);

  const handleSpeakMessage = (text, index) => {
    // If already speaking this message, stop it
    if (speakingMsgIndex === index) {
      cancelSpeech();
      setSpeakingMsgIndex(null);
      return;
    }
    cancelSpeech();
    setSpeakingMsgIndex(index);
    speak(text, {
      onDone: () => setSpeakingMsgIndex(null),
    });
  };

  // Get current chat
  const currentChat = chats.find(c => c.id === currentChatId);

  return (
    <div className="app-container">
      {/* Voice mode overlay */}
      {voiceMode && (
        <VoiceOrb
          voiceState={voiceState}
          transcript={voiceTranscript}
          subtitle={voiceSubtitle}
          onExit={handleVoiceExit}
          volumeRef={volumeRef}
        />
      )}
      {/* Sidebar: Chat history */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo-text">Coplit Web</div>
          <button className="new-chat-btn" onClick={handleNewChat}>
            <span>+</span> New Chat
          </button>
        </div>
        <div className="chat-list">
          {chats.length === 0 && <div className="empty-state">No chats yet</div>}
          {chats.map(chat => (
            <div 
              key={chat.id} 
              onClick={() => handleSelectChat(chat.id)} 
              className={`chat-item ${chat.id === currentChatId ? 'active' : ''}`}
            >
              <div className="chat-item-left">
                <svg className="chat-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                {editingChatId === chat.id ? (
                  <input
                    className="edit-chat-input"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onBlur={(e) => handleSaveEdit(e, chat.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleSaveEdit(e, chat.id);
                      if (e.key === 'Escape') handleCancelEdit(e);
                    }}
                    autoFocus
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <span className="chat-name">{chat.name}</span>
                )}
              </div>
              <div className="chat-item-actions">
                {editingChatId !== chat.id && (
                  <>
                    <button className="chat-action-btn edit-btn" title="Rename" onClick={(e) => handleStartEdit(e, chat)}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                    </button>
                    <button className="chat-action-btn delete-chat-btn" title="Delete" onClick={(e) => handleDeleteChat(e, chat.id)}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="sidebar-footer">
          <button className="settings-btn-sidebar" onClick={() => setShowSettings(true)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            Settings
            {(persona || memory.length > 0) && <span className="active-dot" />}
          </button>
        </div>
      </aside>

      {showSettings && (
        <SettingsPanel
          persona={persona}
          onPersonaChange={savePersona}
          memory={memory}
          onMemoryChange={saveMemory}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Main area */}
      <main className="main-content">
        {/* Chat area */}
        <div className="messages-container">
          {currentChat?.messages.length ? (
            <>
              {currentChat.messages.map((msg, i) => (
                <div key={i} className={`message-row ${msg.role === 'user' ? 'user' : 'agent'}`}>
                  <div className="message-bubble">
                    <div className="message-header">
                      {msg.role === 'user' ? 'You' : 'Copilot'}
                      {msg.role === 'agent' && (
                        <button
                          className={`speak-msg-btn ${speakingMsgIndex === i ? 'speaking' : ''}`}
                          title={speakingMsgIndex === i ? 'Stop speaking' : 'Speak response'}
                          onClick={() => handleSpeakMessage(msg.text, i)}
                        >
                          {speakingMsgIndex === i ? (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                          ) : (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                            </svg>
                          )}
                        </button>
                      )}
                    </div>
                    <div className="message-text">{msg.text}</div>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </>
          ) : (
            <div className="hero-state">
              <h1>What can I help with?</h1>
            </div>
          )}
        </div>

        {/* Bottom controls and Input */}
        <div className="input-section">
          <div className="controls-bar">
            <div className="control-group">
              <label>Model</label>
              <select value={model} onChange={e => setModel(e.target.value)}>
                {MODEL_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
            <div className="control-group">
              <label>Mode</label>
              <select value={mode} onChange={e => setMode(e.target.value)}>
                {MODE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </div>
            <div className="control-group">
              <label>Thinking</label>
              <select value={effort} onChange={e => setEffort(e.target.value)}>
                {EFFORT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
          </div>
          
          <form onSubmit={e => { e.preventDefault(); handleSend(); }} className="input-form">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={`Ask anything using ${mode} mode...`}
              autoFocus
            />
            <button type="submit" disabled={!input.trim()}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            </button>
            {sttSupported ? (
              <button
                type="button"
                className="voice-btn"
                title="Voice mode"
                onClick={handleVoiceEnter}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              </button>
            ) : null}
          </form>
          <div className="input-footer">
            Powered by GitHub Copilot CLI
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
