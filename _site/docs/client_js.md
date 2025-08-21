# GPT4Free.js Client Documentation

## Overview

This JavaScript library provides a flexible interface to interact with **multiple AI model providers** via unified APIs. It supports:

- **Chat Completions** (including streaming)
- **Image Generation**
- **Audio Modalities**
- **Multi-provider support**
- **Automatic model alias mapping**
- Easy model listing and discovery

---

## Installation

### HTML (CDN)

```html
<script type="module">
  import { Client, PollinationsAI, DeepInfra, Together, Puter, HuggingFace } from 'https://g4f.dev/dist/js/client.js';
</script>
```

### NPM

```bash
npm install @gpt4free/g4f.dev
```

---

## Providers

You can initialize a client using one of the following providers:

```js
import { Client, PollinationsAI, DeepInfra, Together, Puter, HuggingFace } from '@gpt4free/g4f.dev';

// Pollinations
const client = new PollinationsAI({ apiKey: 'optional' });

// DeepInfra
const client = new DeepInfra({ apiKey: 'optional' });

// HuggingFace
const client = new HuggingFace({ apiKey: 'required' });

// Together.AI
const client = new Together({ apiKey: 'required' });

// Puter
const client = new Puter();

// Custom (e.g., local GPT4Free instance)
const client = new Client({ baseUrl: 'http://localhost:8080/v1', apiKey: 'secret' });
```

All clients conform to the same method interfaces for completions, models, and image generation.

---

## Chat Completions

### Regular Completion

```js
const result = await client.chat.completions.create({
  model: 'gpt-4.1',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Tell me a joke.' }
  ]
});
```

### Streaming Completion

```js
const stream = await client.chat.completions.create({
  model: 'gpt-4.1',
  messages: [...],
  stream: true
});

for await (const chunk of stream) {
  console.log(chunk.choices[0]?.delta?.content);
}
```

---

## Image Generation

```js
const result = await client.images.generate({
  model: 'flux', // Or "gpt-image", "sdxl-turbo"
  prompt: 'A futuristic city skyline at night',
  size: '512x512' // Optional
});

const image = new Image();
image.src = result.data[0].url;
document.body.appendChild(image);
```

---

## Audio Modality Support

```js
const result = await client.chat.completions.create({
  model: 'gpt-4o-audio',
  messages: [...],
  audio: {
    voice: 'alloy',
    format: 'mp3'
  },
  modalities: ['text', 'audio']
});
```

---

## Model Listing

```js
const models = await client.models.list();
models.forEach(m => console.log(m.id, m.type));
```
---

## Multi-Provider Web UI Example

You can create a browser-based chat UI supporting multiple providers and models. See [`pro.html`](../chat/pro.html) for a working example.

### Features:
- Dynamic model loading per provider
- Chat and image model routing
- API key input
- Markdown rendering

---

## Configuration Options

| Option         | Type    | Description                                 | Default                      |
|----------------|---------|---------------------------------------------|------------------------------|
| `baseUrl`      | string  | Override API base URL                       | Depends on provider          |
| `apiKey`       | string  | Authorization key/token                     | `undefined`                  |
| `extraHeaders` | object  | Custom headers                              | `{}`                         |
| `modelAliases` | object  | Shortcut names for models                   | [See below]                  |

---

## Default Model Aliases

| Alias           | Maps To          |
|------------------|------------------|
| `gpt-4.1`        | `openai-large`   |
| `gpt-4.1-mini`   | `openai`         |
| `deepseek-v3`    | `deepseek`       |

---

## Error Handling

Client throws informative errors for:
- Network/API issues
- Unsupported streaming environments
- Model fetch or alias errors

---

## Notes

- Streaming requires a modern browser with `ReadableStream` support
- Models list includes type info for routing (e.g., `chat`, `image`)
- Markdown (`marked`) can be used for rich text rendering in browser UIs
