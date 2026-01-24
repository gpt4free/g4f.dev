# Anthropic

Access to Claude, Anthropic's advanced AI assistant known for safety and helpfulness.

## Requirements

- **API Key**: Required
- **Authentication**: Anthropic API key

## API Routes

| Type | URL |
|------|-----|
| Base URL | `https://api.anthropic.com/v1` |
| Console | `https://console.anthropic.com` |

## Features

- 🧠 **Advanced Reasoning**: State-of-the-art language understanding
- 🛡️ **Safety Focused**: Built with safety in mind
- 📝 **Long Context**: Up to 200K token context window
- 👓 **Vision Support**: Image understanding capabilities

## Available Models

- `claude-3.5-sonnet` (Latest, recommended)
- `claude-3.5-haiku` (Fast, efficient)
- `claude-3-opus` (Most capable)
- `claude-3-sonnet`
- `claude-3-haiku`
- `claude-sonnet-4.5`

## Examples

### Python

```python
from g4f.client import Client
from g4f.Provider import Anthropic

client = Client(
    provider=Anthropic,
    api_key="your-anthropic-api-key"
)

response = client.chat.completions.create(
    model="claude-3.5-sonnet",
    messages=[
        {"role": "user", "content": "Explain the concept of emergence in complex systems"}
    ],
)

print(response.choices[0].message.content)
```

### JavaScript

```javascript
const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'YOUR_ANTHROPIC_API_KEY',
        'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        messages: [
            { role: 'user', content: 'Hello, Claude!' }
        ]
    })
});

const data = await response.json();
console.log(data.content[0].text);
```

### Vision Example

```python
from g4f.client import Client
from g4f.Provider import Anthropic

client = Client(
    provider=Anthropic,
    api_key="your-anthropic-api-key"
)

response = client.chat.completions.create(
    model="claude-3.5-sonnet",
    messages=[
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Describe this image in detail"},
                {"type": "image_url", "image_url": {"url": "https://example.com/image.jpg"}}
            ]
        }
    ],
)

print(response.choices[0].message.content)
```

## Rate Limits

- Rate limits based on API tier
- Get API key at [console.anthropic.com](https://console.anthropic.com)
