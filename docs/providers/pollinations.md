# Pollinations

Free AI inference API with text and image generation capabilities.

## Requirements

- **API Key**: Optional (higher rate limits with key)
- **Authentication**: None required for free tier

## API Routes

| Type | URL |
|------|-----|
| Text API | `https://text.pollinations.ai/openai` |
| Image API | `https://image.pollinations.ai/prompt/{prompt}` |
| Proxy | `https://g4f.space/pollinations` |
| Models | `https://gen.pollinations.ai/v1/models` |

## Features

- 🆓 **Free Tier**: No API key required for basic usage
- 🖼️ **Image Generation**: Supports image creation
- 💬 **Text Generation**: OpenAI-compatible chat API

## Available Models

- `openai` (recommended)
- Various other models available via the models endpoint

## Examples

### Python

```python
from g4f.client import Client
from g4f.Provider import PollinationsAI

# No API key required
client = Client(provider=PollinationsAI)

response = client.chat.completions.create(
    model="openai",
    messages=[
        {"role": "user", "content": "Hello, how are you?"}
    ],
)

print(response.choices[0].message.content)
```

### JavaScript

```javascript
import { Pollinations } from '@gpt4free/g4f.dev';

const client = new Pollinations();

const response = await client.chat.completions.create({
    model: "openai",
    messages: [
        { role: "user", content: "Hello, how are you?" }
    ],
});

console.log(response.choices[0].message.content);
```

### Image Generation

```python
from g4f.client import Client
from g4f.Provider import PollinationsAI

client = Client(provider=PollinationsAI)

response = client.images.generate(
    prompt="A beautiful sunset over mountains",
    model="flux"
)

print(response.data[0].url)
```
