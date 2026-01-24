# DeepInfra

Enterprise-grade AI inference platform with a wide variety of open-source models.

## Requirements

- **API Key**: Optional (free tier available)
- **Authentication**: API key for production use

## API Routes

| Type | URL |
|------|-----|
| Base URL | `https://api.deepinfra.com/v1/openai` |
| Dashboard | `https://deepinfra.com/dash/api_keys` |
| Models | `https://api.deepinfra.com/v1/openai/models` |

## Features

- 🎨 **Image Generation**: Supports image models
- 👓 **Vision Support**: Multi-modal capabilities
- 📟 **Wide Model Selection**: Access to many open-source models
- 🚀 **Low Latency**: Fast inference times

## Available Models

### DeepSeek Models
- `deepseek-r1`
- `deepseek-r1-0528`
- `deepseek-r1-turbo`
- `deepseek-v3`
- `deepseek-v3-0324`
- `deepseek-prover-v2`

### Meta Llama Models
- `llama-3.2-90b-vision`
- `llama-3.3-70b`

### Google Models
- `gemma-2-27b`
- `gemma-2-9b`
- `gemma-3-4b`
- `codegemma-7b`

### Other Models
- `gpt-oss-120b`
- `gpt-oss-20b`
- `dolphin-2.6`
- `dolphin-2.9`

## Examples

### Python

```python
from g4f.client import Client
from g4f.Provider import DeepInfra

client = Client(provider=DeepInfra)

response = client.chat.completions.create(
    model="deepseek-r1",
    messages=[
        {"role": "user", "content": "Explain quantum computing"}
    ],
)

print(response.choices[0].message.content)
```

### With API Key

```python
from g4f.client import Client
from g4f.Provider import DeepInfra

client = Client(
    provider=DeepInfra,
    api_key="your-api-key"
)

response = client.chat.completions.create(
    model="meta-llama/Llama-3.2-90B-Vision-Instruct",
    messages=[
        {"role": "user", "content": "What's in this image?"}
    ],
)

print(response.choices[0].message.content)
```

### JavaScript

```javascript
const response = await fetch('https://api.deepinfra.com/v1/openai/chat/completions', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer YOUR_API_KEY'
    },
    body: JSON.stringify({
        model: 'deepseek-ai/DeepSeek-R1',
        messages: [
            { role: 'user', content: 'Hello!' }
        ]
    })
});

const data = await response.json();
console.log(data.choices[0].message.content);
```

## Rate Limits

- Free tier available with limited usage
- API keys available at [deepinfra.com](https://deepinfra.com/dash/api_keys)
