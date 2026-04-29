import { useState, useEffect, useRef } from 'react';
import './App.css';
import SettingsPanel from './SettingsPanel.jsx';

// Detect "remember that X" in user input and extract the fact
const REMEMBER_RE = /^(?:please\s+)?remember\s+(?:that\s+)?(.+)$/i;

const MODE_OPTIONS = ['Agent', 'Ask', 'Plan'];
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

  // Auto-scroll to bottom when messages change
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
  const handleSend = async () => {
    if (!input.trim()) return;

    // Check for "remember that X" pattern
    const rememberMatch = input.match(REMEMBER_RE);
    if (rememberMatch) {
      const fact = rememberMatch[1].trim();
      const updated = [...memory, { id: Date.now(), text: fact }];
      saveMemory(updated);
      const ack = { role: 'agent', text: `Got it, I'll remember: "${fact}"` };
      const userMsg = { role: 'user', text: input };
      const updatedChats = chats.map(c =>
        c.id === currentChatId ? { ...c, messages: [...c.messages, userMsg, ack] } : c
      );
      saveChats(updatedChats);
      setInput('');
      return;
    }

    // Build context-enriched prompt
    let enrichedPrompt = input;
    const contextParts = [];
    if (persona) contextParts.push(`[PERSONA/SYSTEM CONTEXT]\n${persona.trim()}\n[END PERSONA]`);
    if (memory.length > 0) {
      contextParts.push(`[USER MEMORY]\n${memory.map(m => `- ${m.text}`).join('\n')}\n[END MEMORY]`);
    }
    if (contextParts.length > 0) {
      enrichedPrompt = `${contextParts.join('\n\n')}\n\n[USER PROMPT]\n${input}`;
    }

    const userMessage = { role: 'user', text: input };
    const updatedWithUser = chats.map(chat =>
      chat.id === currentChatId
        ? { ...chat, messages: [...chat.messages, userMessage] }
        : chat
    );
    saveChats(updatedWithUser);
    setInput('');

    try {
      const response = await fetch('http://localhost:3001/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: enrichedPrompt, model, mode })
      });
      
      const data = await response.json();
      
      if (data.response) {
        const updatedWithAgent = updatedWithUser.map(chat =>
          chat.id === currentChatId
            ? { ...chat, messages: [...chat.messages, { role: 'agent', text: data.response }] }
            : chat
        );
        saveChats(updatedWithAgent);
      } else if (data.error) {
        alert('Error: ' + data.error);
      }
    } catch (err) {
      console.error('Failed to connect to proxy server:', err);
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

  // Get current chat
  const currentChat = chats.find(c => c.id === currentChatId);

  return (
    <div className="app-container">
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
                    <div className="message-header">{msg.role === 'user' ? 'You' : 'Copilot'}</div>
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
