/* ═══════════════════════════════════════════════════════════════════════════
   AURA-LIE — runtime config
   Reads keys from window.AURA_ENV (if set by dev server), then from
   localStorage (set by the Settings UI). Never commits anything.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  window.AURA_ENV = window.AURA_ENV || {};

  // Every key the app knows about. Order = preference cascade when >1 present.
  const KEY_NAMES = [
    'GROQ_API_KEY',
    'GEMINI_API_KEY',
    'CEREBRAS_API_KEY',
    'MISTRAL_API_KEY',
    'NVIDIA_API_KEY',
    'OPENROUTER_API_KEY',
    'GITHUB_MODELS_TOKEN',
    'TAVILY_API_KEY',
    'EXA_API_KEY',
    'SERPER_API_KEY',
    'TELEGRAM_BOT_TOKEN',
    'VAPID_PUBLIC_KEY',
    'VAPID_PRIVATE_KEY',
    'VAPID_SUBJECT',
    'BEARER_TOKEN',
    'MASTER_KEY'
  ];

  const STORAGE_PREFIX = 'aura-key-';

  function loadKey(name) {
    try {
      const fromEnv = window.AURA_ENV[name];
      if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return fromEnv.trim();
    } catch (_) {}
    try {
      const fromLS = localStorage.getItem(STORAGE_PREFIX + name);
      if (typeof fromLS === 'string' && fromLS.trim().length > 0) return fromLS.trim();
    } catch (_) {}
    return '';
  }

  function saveKey(name, value) {
    try {
      if (value == null || String(value).trim().length === 0) {
        localStorage.removeItem(STORAGE_PREFIX + name);
      } else {
        localStorage.setItem(STORAGE_PREFIX + name, String(value).trim());
      }
    } catch (_) {}
  }

  function clearAllKeys() {
    KEY_NAMES.forEach(n => {
      try { localStorage.removeItem(STORAGE_PREFIX + n); } catch (_) {}
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // PROVIDER REGISTRY — each entry declares its base URL, model picker,
  // streaming function, and a cheap test call for the Settings UI.
  // ───────────────────────────────────────────────────────────────────────

  function readSSE(res) {
    // Returns an async generator of raw SSE `data:` payloads
    return (async function* () {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (payload === '[DONE]') return;
            yield payload;
          }
        }
      } finally {
        reader.cancel().catch(() => {});
      }
    })();
  }

  async function* openAiCompatibleStream(url, apiKey, model, messages, extraHeaders) {
    const res = await fetch(url, {
      method: 'POST',
      headers: Object.assign(
        { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
        extraHeaders || {}
      ),
      body: JSON.stringify({ model, messages, stream: true, temperature: 0.7 })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(res.status + ' ' + body.slice(0, 200));
    }
    for await (const data of readSSE(res)) {
      try {
        const j = JSON.parse(data);
        const delta = j.choices && j.choices[0] && j.choices[0].delta;
        if (!delta) continue;
        if (delta.content) yield { text: delta.content };
        if (delta.reasoning || delta.reasoning_content)
          yield { reasoning: delta.reasoning || delta.reasoning_content };
      } catch (_) {}
    }
  }

  async function* geminiStream(apiKey, model, messages) {
    const systemBits = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const convo = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));
    const body = { contents: convo };
    if (systemBits) body.systemInstruction = { parts: [{ text: systemBits }] };
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(model) +
      ':streamGenerateContent?alt=sse&key=' +
      encodeURIComponent(apiKey);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(res.status + ' ' + errBody.slice(0, 200));
    }
    for await (const data of readSSE(res)) {
      try {
        const j = JSON.parse(data);
        const cand = j.candidates && j.candidates[0];
        const parts = cand && cand.content && cand.content.parts;
        if (!parts) continue;
        for (const p of parts) if (p.text) yield { text: p.text };
      } catch (_) {}
    }
  }

  const PROVIDERS = {
    groq: {
      label: 'Groq',
      envKey: 'GROQ_API_KEY',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      defaultModel: 'llama-3.3-70b-versatile',
      models: [
        'llama-3.3-70b-versatile',
        'llama-3.1-8b-instant',
        'qwen/qwen3-32b',
        'moonshotai/kimi-k2-instruct'
      ],
      stream: (apiKey, model, messages) =>
        openAiCompatibleStream(PROVIDERS.groq.url, apiKey, model, messages),
      test: async apiKey => {
        const res = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: 'Bearer ' + apiKey }
        });
        return res.ok;
      }
    },
    gemini: {
      label: 'Gemini',
      envKey: 'GEMINI_API_KEY',
      defaultModel: 'gemini-2.0-flash-lite',
      models: ['gemini-2.0-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-flash'],
      stream: (apiKey, model, messages) => geminiStream(apiKey, model, messages),
      test: async apiKey => {
        const res = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(apiKey)
        );
        return res.ok;
      }
    },
    cerebras: {
      label: 'Cerebras',
      envKey: 'CEREBRAS_API_KEY',
      url: 'https://api.cerebras.ai/v1/chat/completions',
      defaultModel: 'llama3.1-8b',
      models: ['llama3.1-8b', 'llama3.1-70b', 'qwen-3-32b'],
      stream: (apiKey, model, messages) =>
        openAiCompatibleStream(PROVIDERS.cerebras.url, apiKey, model, messages),
      test: async apiKey => {
        const res = await fetch('https://api.cerebras.ai/v1/models', {
          headers: { Authorization: 'Bearer ' + apiKey }
        });
        return res.ok;
      }
    },
    mistral: {
      label: 'Mistral',
      envKey: 'MISTRAL_API_KEY',
      url: 'https://api.mistral.ai/v1/chat/completions',
      defaultModel: 'mistral-small-latest',
      models: ['mistral-small-latest', 'mistral-large-latest', 'open-mistral-nemo'],
      stream: (apiKey, model, messages) =>
        openAiCompatibleStream(PROVIDERS.mistral.url, apiKey, model, messages),
      test: async apiKey => {
        const res = await fetch('https://api.mistral.ai/v1/models', {
          headers: { Authorization: 'Bearer ' + apiKey }
        });
        return res.ok;
      }
    },
    nvidia: {
      label: 'NVIDIA NIM',
      envKey: 'NVIDIA_API_KEY',
      url: 'https://integrate.api.nvidia.com/v1/chat/completions',
      defaultModel: 'meta/llama-3.3-70b-instruct',
      models: ['meta/llama-3.3-70b-instruct', 'nvidia/llama-3.1-nemotron-70b-instruct'],
      stream: (apiKey, model, messages) =>
        openAiCompatibleStream(PROVIDERS.nvidia.url, apiKey, model, messages),
      test: async apiKey => {
        const res = await fetch('https://integrate.api.nvidia.com/v1/models', {
          headers: { Authorization: 'Bearer ' + apiKey }
        });
        return res.ok;
      }
    },
    openrouter: {
      label: 'OpenRouter',
      envKey: 'OPENROUTER_API_KEY',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
      models: [
        'meta-llama/llama-3.3-70b-instruct:free',
        'google/gemini-2.0-flash-exp:free',
        'qwen/qwen-2.5-72b-instruct:free'
      ],
      stream: (apiKey, model, messages) =>
        openAiCompatibleStream(PROVIDERS.openrouter.url, apiKey, model, messages, {
          'HTTP-Referer': 'https://aura-lie.local',
          'X-Title': 'Aura-lie'
        }),
      test: async apiKey => {
        const res = await fetch('https://openrouter.ai/api/v1/key', {
          headers: { Authorization: 'Bearer ' + apiKey }
        });
        return res.ok;
      }
    },
    github: {
      label: 'GitHub Models',
      envKey: 'GITHUB_MODELS_TOKEN',
      url: 'https://models.inference.ai.azure.com/chat/completions',
      defaultModel: 'gpt-4o-mini',
      models: ['gpt-4o-mini', 'gpt-4o', 'Phi-3.5-mini-instruct'],
      stream: (apiKey, model, messages) =>
        openAiCompatibleStream(PROVIDERS.github.url, apiKey, model, messages),
      test: async apiKey => {
        const res = await fetch('https://models.inference.ai.azure.com/chat/completions', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 1
          })
        });
        return res.ok || res.status === 400;
      }
    }
  };

  // Search providers (all optional, Wikipedia is keyless fallback)
  const SEARCH_PROVIDERS = {
    wikipedia: {
      label: 'Wikipedia',
      keyless: true,
      search: async query => {
        const url =
          'https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' +
          encodeURIComponent(query) +
          '&srlimit=4&format=json&origin=*';
        const res = await fetch(url);
        if (!res.ok) return [];
        const data = await res.json();
        return (data.query && data.query.search || []).map(r => ({
          title: r.title,
          url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(r.title),
          snippet: (r.snippet || '').replace(/<[^>]+>/g, ''),
          domain: 'en.wikipedia.org',
          tier: 3
        }));
      }
    },
    tavily: {
      label: 'Tavily',
      envKey: 'TAVILY_API_KEY',
      search: async (query, apiKey) => {
        const res = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: apiKey,
            query,
            max_results: 4,
            include_answer: false
          })
        });
        if (!res.ok) return [];
        const data = await res.json();
        return (data.results || []).map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.content || '',
          domain: safeDomain(r.url),
          tier: 2
        }));
      }
    },
    exa: {
      label: 'Exa',
      envKey: 'EXA_API_KEY',
      search: async (query, apiKey) => {
        const res = await fetch('https://api.exa.ai/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({ query, numResults: 4, contents: { text: { maxCharacters: 400 } } })
        });
        if (!res.ok) return [];
        const data = await res.json();
        return (data.results || []).map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.text || '',
          domain: safeDomain(r.url),
          tier: 2
        }));
      }
    },
    serper: {
      label: 'Serper',
      envKey: 'SERPER_API_KEY',
      search: async (query, apiKey) => {
        const res = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
          body: JSON.stringify({ q: query, num: 4 })
        });
        if (!res.ok) return [];
        const data = await res.json();
        return (data.organic || []).map(r => ({
          title: r.title,
          url: r.link,
          snippet: r.snippet || '',
          domain: safeDomain(r.link),
          tier: 2
        }));
      }
    }
  };

  function safeDomain(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return ''; }
  }

  // ───────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ───────────────────────────────────────────────────────────────────────

  window.AURA_CONFIG = {
    KEY_NAMES,
    PROVIDERS,
    SEARCH_PROVIDERS,
    loadKey,
    saveKey,
    clearAllKeys,
    listConfigured() {
      const out = {};
      KEY_NAMES.forEach(n => { out[n] = loadKey(n) ? 'set' : ''; });
      return out;
    },
    preferredProvider() {
      const pref = (window.AURA_ENV.PROVIDER_NAME || '').trim();
      if (pref && PROVIDERS[pref] && loadKey(PROVIDERS[pref].envKey)) return pref;
      for (const name of Object.keys(PROVIDERS)) {
        if (loadKey(PROVIDERS[name].envKey)) return name;
      }
      return null;
    },
    searchProvidersAvailable() {
      const list = ['wikipedia'];
      for (const name of Object.keys(SEARCH_PROVIDERS)) {
        const p = SEARCH_PROVIDERS[name];
        if (p.keyless) continue;
        if (loadKey(p.envKey)) list.push(name);
      }
      return list;
    }
  };
})();