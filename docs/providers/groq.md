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

- `llama-3.3-70b-versatile`
- `llama-3.1-8b-instant`
- `llama3-70b-8192`
- `llama3-8b-8192`
- `mixtral-8x7b-32768`
- `gemma2-9b-it`
- `gpt-oss-120b`

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
    model="llama-3.3-70b-versatile",
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
        model: 'llama-3.3-70b-versatile',
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
    model="llama-3.3-70b-versatile",
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
