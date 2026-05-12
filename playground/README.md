# LLMPlayground

> **An open-source AI playground** — chat, roleplay, coding assistant, and more.

**Live:** [llmplayground.net](https://llmplayground.net) · **GitHub:** [github.com/meow18838/LLMPlayground](https://github.com/meow18838/LLMPlayground)

---

## 🤝 Contributing

We welcome contributions of all kinds! Whether it's new features, bug fixes, new personas, or documentation improvements.

- **Fork** the repo and open a PR
- **Open an issue** for bugs or feature requests
- Join the discussion in [Issues](https://github.com/meow18838/LLMPlayground/issues)

No build step, no framework, no dependencies — just HTML and vanilla JS. Easy to read and contribute to.

---

## Features

| Feature | Description |
|---------|-------------|
| 💬 **Chat** | Multi-turn conversations with streaming responses |
| 🎭 **Roleplay** | Character-based chats with custom personas |
| 💻 **Coding** | Copilot-style assistant with Explain / Review / Refactor / Test / Debug |
| 🧑‍🎨 **Personas** | Create and manage AI characters for roleplay |
| ⚙️ **Providers** | Any OpenAI-compatible API; Airforce API is the default (no key needed) |

---

## Quick Start

```bash
git clone https://github.com/meow18838/LLMPlayground
cd LLMPlayground
python3 -m http.server 8080
```

Open [http://localhost:8080](http://localhost:8080). No install, no build.

---

## File Structure

```
LLMPlayground/
├── index.html                    # App shell, nav, global styles
├── js/
│   ├── store.js                  # localStorage state (providers, chats, personas, settings)
│   ├── api.js                    # OpenAI-compatible streaming + non-streaming fetch
│   ├── components.js             # Messages, markdown, modals, toasts, input bar
│   ├── router.js                 # Hash-based SPA routing
│   └── pages/
│       ├── chat.js               # General multi-turn chat
│       ├── roleplay.js           # Character chat with persona selector
│       ├── coding.js             # Coding assistant with quick actions
│       ├── personas.js           # Persona manager (create, edit, delete)
│       └── providers.js          # Provider config + global settings
└── README.md
```

---

## Default Provider: Airforce API

[api.airforce](https://api.airforce) is an OpenAI-compatible proxy with free access to many models. No API key required for free-tier models.

- **Base URL:** `https://api.airforce/v1`
- **Default model:** `gpt-4.1-mini`
- Click **Fetch Models** on the Providers page to load the full model list

---

## Adding a Custom Provider

1. Go to **Providers → + Add Provider**
2. Enter name, base URL (e.g. `https://api.openai.com/v1`), and API key
3. Click **Fetch Models** to populate the model list
4. Click **Set Active** to use it

Any OpenAI-compatible endpoint works: OpenAI, Anthropic (via proxy), Ollama, LM Studio, etc.

---

## Personas

Personas are stored locally in your browser (localStorage). Create a persona with a name, emoji, description, system prompt, and tags — then use it in Roleplay chats.

1. Go to **Personas → + New Persona**
2. Fill in the details and click **Create**
3. In **Roleplay**, select the persona from the dropdown

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line in input |

---

## Routes

| Route | Page |
|-------|------|
| `#/` | Home |
| `#/chat` | Chat |
| `#/roleplay` | Roleplay |
| `#/coding` | Coding Assistant |
| `#/personas` | Persona Manager |
| `#/providers` | Providers & Settings |

---

## License

MIT — do whatever you want with it.
