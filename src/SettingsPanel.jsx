import { useState, useRef } from 'react';

export default function SettingsPanel({ persona, onPersonaChange, memory, onMemoryChange, onClose }) {
  const [activeTab, setActiveTab] = useState('persona');
  const [newMemory, setNewMemory] = useState('');
  const fileRef = useRef();

  const handleFileLoad = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onPersonaChange(ev.target.result);
    reader.readAsText(file);
  };

  const handleAddMemory = () => {
    if (!newMemory.trim()) return;
    onMemoryChange([...memory, { id: Date.now(), text: newMemory.trim() }]);
    setNewMemory('');
  };

  const handleDeleteMemory = (id) => {
    onMemoryChange(memory.filter(m => m.id !== id));
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="settings-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="settings-tabs">
          <button className={`settings-tab ${activeTab === 'persona' ? 'active' : ''}`} onClick={() => setActiveTab('persona')}>Persona</button>
          <button className={`settings-tab ${activeTab === 'memory' ? 'active' : ''}`} onClick={() => setActiveTab('memory')}>
            Memory
            {memory.length > 0 && <span className="memory-badge">{memory.length}</span>}
          </button>
        </div>

        {activeTab === 'persona' && (
          <div className="settings-body">
            <p className="settings-hint">
              The persona is injected as a system context prefix before every prompt.
              {persona ? ' Currently active.' : ' No persona loaded.'}
            </p>
            <div className="settings-actions-row">
              <button className="settings-btn" onClick={() => fileRef.current.click()}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Load from file
              </button>
              <input ref={fileRef} type="file" accept=".md,.txt" style={{ display: 'none' }} onChange={handleFileLoad} />
              {persona && (
                <button className="settings-btn danger" onClick={() => onPersonaChange('')}>
                  Clear
                </button>
              )}
            </div>
            <textarea
              className="settings-textarea"
              value={persona}
              onChange={e => onPersonaChange(e.target.value)}
              placeholder="Paste or type a persona / system prompt here..."
              rows={18}
            />
          </div>
        )}

        {activeTab === 'memory' && (
          <div className="settings-body">
            <p className="settings-hint">
              Memory facts are prepended to every prompt. You can also say <em>"remember that..."</em> in chat and it will be added automatically.
            </p>
            <div className="memory-add-row">
              <input
                className="memory-input"
                value={newMemory}
                onChange={e => setNewMemory(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddMemory()}
                placeholder="Add a fact to remember..."
              />
              <button className="settings-btn" onClick={handleAddMemory}>Add</button>
            </div>
            <div className="memory-list">
              {memory.length === 0 && <div className="settings-empty">No memories yet.</div>}
              {memory.map(m => (
                <div key={m.id} className="memory-item">
                  <span>{m.text}</span>
                  <button className="memory-delete-btn" onClick={() => handleDeleteMemory(m.id)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              ))}
            </div>
            {memory.length > 0 && (
              <button className="settings-btn danger" style={{ marginTop: '12px' }} onClick={() => onMemoryChange([])}>
                Clear all memory
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
