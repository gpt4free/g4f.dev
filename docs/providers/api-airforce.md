# Api.Airforce

Fast and reliable AI inference API with support for text and image generation.

## Requirements

- **API Key**: Optional (free tier available)
- **Authentication**: API key for higher limits

## API Routes

| Type | URL |
|------|-----|
| Base URL | `https://api.airforce/v1` |
| Chat API | `https://api.airforce/v1/chat/completions` |
| Dashboard | `https://panel.api.airforce/dashboard` |

## Features

- 🎨 **Image Generation**: Supports various image models
- 👓 **Vision Support**: Process images in conversations
- 🚀 **Fast Inference**: Low latency responses
- 🆓 **Free Tier**: Available without API key

## Available Models

- `gpt-4o-mini`
- `gpt-oss-120b`
- `llama-4-scout`
- `llama-4-maverick`
- `gemini-2.0-flash`
- `gemini-2.5-flash`
- `gemini-2.5-pro`
- `gemini-3-flash`
- `gemini-3-pro`
- `qwen3-235b`
- `deepseek-r1`
- `deepseek-v3`
- `kimi-k2`
- `claude-sonnet-4.5`

## Examples

### Python

```python
from g4f.client import Client
from g4f.Provider import ApiAirforce

client = Client(provider=ApiAirforce)

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[
        {"role": "user", "content": "Hello, how are you?"}
    ],
)

print(response.choices[0].message.content)
```

### JavaScript

```javascript
const response = await fetch('https://api.airforce/v1/chat/completions', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
    },
    body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
            { role: 'user', content: 'Hello, how are you?' }
        ]
    })
});

const data = await response.json();
console.log(data.choices[0].message.content);
```

### Image Generation

```python
from g4f.client import Client
from g4f.Provider import ApiAirforce

client = Client(provider=ApiAirforce)

response = client.images.generate(
    prompt="A futuristic cityscape at night",
    model="flux"
)

print(response.data[0].url)
```

## Rate Limits

- Free tier has rate limiting
- Get API key from [panel.api.airforce](https://panel.api.airforce/dashboard) for higher limits
