import { useState, useRef, useEffect } from 'react';
import { streamChat } from './api';

export default function App() {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('Instant');
  const [theme, setTheme] = useState('paper');
  const [messages, setMessages] = useState<{ role: string; text: string; events?: any[] }[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!query.trim() || isStreaming) return;

    const userText = query;
    setQuery('');
    setMessages((prev) => [...prev, { role: 'user', text: userText }]);
    setIsStreaming(true);

    let currentAnswer = '';
    const currentEvents: any[] = [];

    setMessages((prev) => [...prev, { role: 'aura', text: '', events: currentEvents }]);

    await streamChat(
      userText,
      mode,
      (event) => {
        currentEvents.push(event);
        
        if (event.t === 'token') {
          currentAnswer += event.delta;
          setMessages((prev) => {
            const newMsgs = [...prev];
            const lastMsg = newMsgs[newMsgs.length - 1];
            lastMsg.text = currentAnswer;
            return newMsgs;
          });
        } else if (event.t === 'done') {
          setIsStreaming(false);
        } else if (event.t === 'error') {
          alert(event.userMessage);
          setIsStreaming(false);
        }
      },
      (err) => {
        console.error(err);
        setIsStreaming(false);
      }
    );
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--paper)' }}>
      <header style={{ padding: '16px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontFamily: 'var(--f-id)', margin: 0, fontSize: '14px', letterSpacing: '.14em', color: 'var(--ink)' }}>
          AURA-LIE
        </h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setTheme(theme === 'paper' ? 'ink' : 'paper')} style={{ cursor: 'pointer', background: 'none', border: 'none', fontSize: '20px' }}>
            {theme === 'paper' ? '🌙' : '☀️'}
          </button>
        </div>
      </header>

      <main style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--ink-3)', marginTop: '20vh' }}>
            <h2 style={{ fontFamily: 'var(--f-id)', fontSize: '24px', letterSpacing: '.1em', color: 'var(--ink)' }}>What are we solving?</h2>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={{ maxWidth: '720px', margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontFamily: 'var(--f-id)', fontSize: '10px', color: msg.role === 'user' ? 'var(--ink-2)' : 'var(--accent)', textTransform: 'uppercase' }}>
              {msg.role === 'user' ? 'You' : 'Aura-lie'}
            </div>
            
            {msg.role === 'aura' && msg.events && (
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: '12px', color: 'var(--ink-3)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent)' }} />
                {isStreaming && i === messages.length - 1 ? 'Thinking...' : 'Thought for 1.2s'}
              </div>
            )}

            <div style={{ fontSize: '16px', lineHeight: 1.6, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>
              {msg.text}
            </div>
            
            {msg.role === 'aura' && msg.text && !isStreaming && (
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <span style={{ fontFamily: 'var(--f-id)', fontSize: '9px', padding: '4px 8px', border: '1px solid var(--ok)', color: 'var(--ok)', borderRadius: '4px' }}>
                  + FACT 85
                </span>
              </div>
            )}
          </div>
        ))}
        <div ref={chatEndRef} />
      </main>

      <footer style={{ padding: '20px', borderTop: '1px solid var(--hairline)', background: 'var(--paper)' }}>
        <div style={{ maxWidth: '720px', margin: '0 auto', display: 'flex', gap: '12px' }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask Aura-lie..."
            style={{ flex: 1, padding: '12px 16px', border: '1px solid var(--hairline)', borderRadius: '8px', background: 'var(--bone)', color: 'var(--ink)', fontSize: '16px', outline: 'none' }}
          />
          <select 
            value={mode} 
            onChange={(e) => setMode(e.target.value)}
            style={{ padding: '0 12px', background: 'var(--bone)', border: '1px solid var(--hairline)', color: 'var(--ink)', borderRadius: '8px', fontFamily: 'var(--f-mono)' }}
          >
            <option value="Instant">Instant</option>
            <option value="Think">Think</option>
            <option value="Research">Research</option>
          </select>
          <button
            onClick={handleSend}
            disabled={isStreaming}
            style={{ padding: '12px 24px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            {isStreaming ? '...' : 'Send'}
          </button>
        </div>
      </footer>
    </div>
  );
}