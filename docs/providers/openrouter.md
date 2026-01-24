# OpenRouter

Unified API gateway providing access to 100+ AI models from multiple providers.

## Requirements

- **API Key**: Optional (free models available)
- **Authentication**: API key for premium models

## API Routes

| Type | URL |
|------|-----|
| Base URL | `https://openrouter.ai/api/v1` |
| Dashboard | `https://openrouter.ai/keys` |
| Models | `https://openrouter.ai/api/v1/models` |
| Proxy | `https://g4f.space/api/openrouter` |

## Features

- 🌐 **Multi-Provider**: Access OpenAI, Anthropic, Google, Meta, and more
- 🆓 **Free Models**: Many models available without API key
- 👓 **Vision Support**: Multi-modal capabilities
- 📊 **Usage Tracking**: Detailed analytics and cost tracking

## Available Models

### Free Models
- `openai/gpt-oss-120b:free`
- `google/gemini-2.0-flash-exp:free`
- `meta-llama/llama-3.3-70b-instruct:free`
- `deepseek/deepseek-r1:free`

### Premium Models
- `openai/gpt-4o`
- `anthropic/claude-3.5-sonnet`
- `google/gemini-pro`
- `meta-llama/llama-3.2-90b-vision`

## Examples

### Python

```python
from g4f.client import Client
from g4f.Provider import OpenRouter

client = Client(provider=OpenRouter)

response = client.chat.completions.create(
    model="openai/gpt-oss-120b:free",
    messages=[
        {"role": "user", "content": "Hello, how are you?"}
    ],
)

print(response.choices[0].message.content)
```

### With API Key

```python
from g4f.client import Client
from g4f.Provider import OpenRouter

client = Client(
    provider=OpenRouter,
    api_key="your-openrouter-api-key"
)

response = client.chat.completions.create(
    model="anthropic/claude-3.5-sonnet",
    messages=[
        {"role": "user", "content": "Explain machine learning"}
    ],
)

print(response.choices[0].message.content)
```

### JavaScript

```javascript
const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer YOUR_API_KEY',
        'HTTP-Referer': 'https://your-site.com'
    },
    body: JSON.stringify({
        model: 'openai/gpt-oss-120b:free',
        messages: [
            { role: 'user', content: 'Hello!' }
        ]
    })
});

const data = await response.json();
console.log(data.choices[0].message.content);
```

## Rate Limits

- Free models have usage limits
- Get API key at [openrouter.ai/keys](https://openrouter.ai/keys)
