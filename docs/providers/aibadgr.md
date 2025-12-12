# AI Badgr

AI Badgr is an OpenAI-compatible API provider that can be used with gpt4free (g4f).

## Requirements

- **API Key**: Required (get free key from [AI Badgr Contact](https://aibadgr.com/#contact))
- **Authentication**: Bearer token

## API Routes

| Type | URL |
|------|-----|
| BaseURL | `https://aibadgr.com/api/v1` |

## Features

- ✅ Chat completions
- ✅ Streaming responses
- ✅ System messages
- ✅ Message history
- ✅ OpenAI-compatible API

## Getting Started

### 1. Get Your API Key

Visit https://aibadgr.com/#contact to request a free API key.

### 2. Install gpt4free

```bash
pip install -U g4f[all]
```

### 3. Use AI Badgr with g4f

#### Python Example

```python
from g4f.client import Client
from g4f.Provider import AIBadgr

# Create client with AI Badgr provider
client = Client(
    provider=AIBadgr,
    api_key="your-api-key-here"
)

# Chat completion
response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

#### Using Environment Variables

```bash
export AIBADGR_API_KEY="your-api-key-here"
```

```python
from g4f.client import Client
from g4f.Provider import AIBadgr

# API key will be loaded from environment variable
client = Client(provider=AIBadgr)

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

#### Streaming Responses

```python
response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Tell me a story"}],
    stream=True
)

for chunk in response:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

#### cURL Example

```bash
curl https://aibadgr.com/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Using with Standard OpenAI Client

Since AI Badgr is OpenAI-compatible, you can use it with the standard OpenAI Python client by changing the base URL:

```python
from openai import OpenAI

client = OpenAI(
    api_key="your-aibadgr-api-key",
    base_url="https://aibadgr.com/api/v1"
)

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

## Supported Models

AI Badgr supports OpenAI-compatible models. Check the [AI Badgr documentation](https://aibadgr.com) for the latest list of available models.

## Configuration Options

| Option | Description | Required |
|--------|-------------|----------|
| `api_key` | Your AI Badgr API key | Yes |
| `api_base` | API base URL (default: https://aibadgr.com/api/v1) | No |
| `model` | Model to use | Yes |
| `stream` | Enable streaming responses | No |
| `temperature` | Sampling temperature | No |
| `max_tokens` | Maximum tokens to generate | No |

## Support

- Website: https://aibadgr.com
- Contact: https://aibadgr.com/#contact
