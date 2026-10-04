# Groq

Ultra-fast AI inference powered by Groq's LPU (Language Processing Unit) technology.

## Requirements

- **API Key**: Required
- **Authentication**: API key from Groq console

## API Routes

| Type | URL |
|------|-----|
| Base URL | `https://api.groq.com/openai/v1` |
| Console | `https://console.groq.com` |
| Proxy | `https://g4f.space/api/groq` |

## Features

- ⚡ **Ultra Fast**: Powered by Groq LPU technology
- 🆓 **Free Tier**: Generous free usage limits
- 🔄 **OpenAI Compatible**: Standard API format
- 📊 **Low Latency**: Sub-second response times

## Available Models

- `openai/gpt-oss-120b`
- `openai/gpt-oss-20b`
- `qwen/qwen3.8-27b`
- `allam-2-7b`
- `whisper-large-v3` (audio transcription)
- `whisper-large-v3-turbo` (audio transcription)
- `canopylabs/orpheus-v1-english` (audio)

> Deprecated models like `llama-3.3-70b-versatile` or `mixtral-8x7b-32768` were
> removed from Groq. The g4f proxy automatically remaps such requests to
> `openai/gpt-oss-120b`.

## Examples

### Python

```python
from g4f.client import Client
from g4f.Provider import Groq

client = Client(
    provider=Groq,
    api_key="your-groq-api-key"
)

response = client.chat.completions.create(
    model="openai/gpt-oss-120b",
    messages=[
        {"role": "user", "content": "Explain the theory of relativity"}
    ],
)

print(response.choices[0].message.content)
```

### JavaScript

```javascript
const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer YOUR_GROQ_API_KEY'
    },
    body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: [
            { role: 'user', content: 'Hello!' }
        ]
    })
});

const data = await response.json();
console.log(data.choices[0].message.content);
```

### Streaming

```python
from g4f.client import Client
from g4f.Provider import Groq

client = Client(
    provider=Groq,
    api_key="your-groq-api-key"
)

stream = client.chat.completions.create(
    model="openai/gpt-oss-120b",
    messages=[
        {"role": "user", "content": "Write a poem about AI"}
    ],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

## Rate Limits

- Free tier: 14,400 requests/day for most models
- Get API key at [console.groq.com](https://console.groq.com)
