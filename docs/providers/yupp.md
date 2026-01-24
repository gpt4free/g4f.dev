# Yupp

AI chat platform with access to multiple models and image generation capabilities.

## Requirements

- **API Key**: Required (session token from yupp.ai)
- **Authentication**: Login via yupp.ai

## API Routes

| Type | URL |
|------|-----|
| Website | `https://yupp.ai` |

## Features

- 🎨 **Image Generation**: Supports various image models
- 👓 **Vision Support**: Multi-modal image understanding
- 📤 **File Uploads**: Attach images to conversations
- 🔄 **Streaming**: Real-time response streaming
- 🤖 **Multiple Models**: Access to many AI models

## Available Models

Yupp provides access to a wide variety of models. Use `get_models()` to fetch the current list:

- Various GPT models
- Claude models
- Gemini models
- Llama models
- Image generation models
- And more...

## Examples

### Python

```python
from g4f.client import Client
from g4f.Provider import Yupp

client = Client(
    provider=Yupp,
    api_key="your-yupp-session-token"
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "user", "content": "Hello, how are you?"}
    ],
)

print(response.choices[0].message.content)
```

### With Streaming

```python
from g4f.client import Client
from g4f.Provider import Yupp

client = Client(
    provider=Yupp,
    api_key="your-yupp-session-token"
)

stream = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "user", "content": "Write a story about AI"}
    ],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

### Image Generation

```python
from g4f.client import Client
from g4f.Provider import Yupp

client = Client(
    provider=Yupp,
    api_key="your-yupp-session-token"
)

response = client.images.generate(
    prompt="A beautiful sunset over the ocean",
    model="flux"
)

print(response.data[0].url)
```

### Vision Example

```python
from g4f.client import Client
from g4f.Provider import Yupp

client = Client(
    provider=Yupp,
    api_key="your-yupp-session-token"
)

response = client.chat.completions.create(
    model="gpt-4o",
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

### Environment Variable Setup

```bash
# Set your Yupp session token
export YUPP_API_KEY="your-session-token-here"

# Or set multiple accounts (comma-separated)
export YUPP_API_KEY="token1,token2,token3"
```

## Getting Your Session Token

1. Go to [yupp.ai](https://yupp.ai) and log in with Discord
2. Open browser developer tools (F12)
3. Go to Application → Cookies
4. Find the `__Secure-yupp.session-token` cookie
5. Copy the value as your API key

## Rate Limits

- Account-based rate limiting
- Multiple accounts can be configured for rotation
- Join the [Discord](https://discord.gg/qXA4Wf4Fsm) for support
