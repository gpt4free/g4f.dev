# NVIDIA NIM

NVIDIA's AI inference platform with access to optimized enterprise-grade models.

## Requirements

- **API Key**: Required
- **Authentication**: NVIDIA API key

## API Routes

| Type | URL |
|------|-----|
| Base URL | `https://integrate.api.nvidia.com/v1` |
| Dashboard | `https://build.nvidia.com/explore` |
| Proxy | `https://g4f.space/api/nvidia` |

## Features

- 📟 **Optimized Models**: Hardware-accelerated inference
- 🚀 **Enterprise Grade**: Production-ready infrastructure
- 🔄 **OpenAI Compatible**: Standard API format
- 💪 **High Performance**: Low latency, high throughput

## Available Models

- `deepseek-ai/deepseek-v3.2`
- `meta/llama-3.3-70b-instruct`
- `meta/llama-3.2-90b-vision-instruct`
- `nvidia/llama-3.1-nemotron-70b-instruct`
- `google/gemma-2-27b-it`
- `mistralai/mixtral-8x22b-instruct-v0.1`

## Examples

### Python

```python
from g4f.client import Client
from g4f.Provider import Nvidia

client = Client(
    provider=Nvidia,
    api_key="your-nvidia-api-key"
)

response = client.chat.completions.create(
    model="deepseek-ai/deepseek-v3.2",
    messages=[
        {"role": "user", "content": "Explain neural networks"}
    ],
)

print(response.choices[0].message.content)
```

### JavaScript

```javascript
const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer YOUR_NVIDIA_API_KEY'
    },
    body: JSON.stringify({
        model: 'meta/llama-3.3-70b-instruct',
        messages: [
            { role: 'user', content: 'Hello!' }
        ]
    })
});

const data = await response.json();
console.log(data.choices[0].message.content);
```

### Vision Example

```python
from g4f.client import Client
from g4f.Provider import Nvidia

client = Client(
    provider=Nvidia,
    api_key="your-nvidia-api-key"
)

response = client.chat.completions.create(
    model="meta/llama-3.2-90b-vision-instruct",
    messages=[
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "What's in this image?"},
                {"type": "image_url", "image_url": {"url": "https://example.com/image.jpg"}}
            ]
        }
    ],
)

print(response.choices[0].message.content)
```

## Rate Limits

- Free tier available with limited usage
- Get API key at [build.nvidia.com](https://build.nvidia.com/explore)
