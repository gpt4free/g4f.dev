# Together AI

High-performance AI inference platform with access to leading open-source models.

## Requirements

- **API Key**: Required
- **Authentication**: Together API key

## API Routes

| Type | URL |
|------|-----|
| Base URL | `https://api.together.xyz/v1` |
| Dashboard | `https://api.together.xyz/settings/api-keys` |

## Features

- 🚀 **Fast Inference**: Optimized for speed
- 🎨 **Image Generation**: Supports image models
- 💰 **Cost Effective**: Competitive pricing
- 🔄 **OpenAI Compatible**: Standard API format

## Available Models

### Language Models
- `meta-llama/Llama-3.3-70B-Instruct-Turbo`
- `meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo`
- `deepseek-ai/DeepSeek-R1`
- `deepseek-ai/DeepSeek-V3`
- `mistralai/Mixtral-8x22B-Instruct-v0.1`
- `Qwen/Qwen2.5-72B-Instruct-Turbo`

### Image Models
- `black-forest-labs/FLUX.1-schnell`
- `stabilityai/stable-diffusion-xl-base-1.0`

## Examples

### Python

```python
from g4f.client import Client
from g4f.Provider import Together

client = Client(
    provider=Together,
    api_key="your-together-api-key"
)

response = client.chat.completions.create(
    model="meta-llama/Llama-3.3-70B-Instruct-Turbo",
    messages=[
        {"role": "user", "content": "What is the meaning of life?"}
    ],
)

print(response.choices[0].message.content)
```

### JavaScript

```javascript
const response = await fetch('https://api.together.xyz/v1/chat/completions', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer YOUR_TOGETHER_API_KEY'
    },
    body: JSON.stringify({
        model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
        messages: [
            { role: 'user', content: 'Hello!' }
        ]
    })
});

const data = await response.json();
console.log(data.choices[0].message.content);
```

### Image Generation

```python
from g4f.client import Client
from g4f.Provider import Together

client = Client(
    provider=Together,
    api_key="your-together-api-key"
)

response = client.images.generate(
    prompt="A serene mountain landscape at sunrise",
    model="black-forest-labs/FLUX.1-schnell"
)

print(response.data[0].url)
```

## Rate Limits

- Free tier available with limited usage
- Get API key at [api.together.xyz](https://api.together.xyz/settings/api-keys)
