# GeminiCLI Provider

GeminiCLI provides access to Google's Gemini models through the Google Cloud Code Assist API.

## Supported Models

- `gemini-2.5-pro`
- `gemini-2.5-flash`
- `gemini-3-pro-preview` (default)

## Features

- ✅ Text generation with streaming
- ✅ Message history support
- ✅ System message support
- ✅ Image/media input
- ✅ Tool calls (function calling)
- ✅ Reasoning tokens
- ✅ OAuth2 authentication with PKCE

## Authentication

GeminiCLI requires OAuth2 authentication with Google. The provider supports an interactive browser-based login flow.

### CLI Login

Use the dedicated CLI tool for authentication:

```bash
# Install g4f first
pip install -e .

# Login with browser (recommended)
g4f-geminicli login

# Login without auto-opening browser (manual URL copy)
g4f-geminicli login --no-browser

# Check authentication status
g4f-geminicli status

# Remove saved credentials
g4f-geminicli logout
```

### Python Login

```python
import asyncio
from g4f.Provider.needs_auth import GeminiCLI

# Interactive login
asyncio.run(GeminiCLI.login())

# Check if credentials exist
if GeminiCLI.has_credentials():
    print("Already logged in")
```

### Credential Storage

Credentials are stored in one of these locations (checked in order):
1. g4f cache directory: `~/.config/g4f/cookies/GeminiCLI.json`
2. Default path: `~/.gemini/oauth_creds.json`

### Environment Variable Authentication

You can also provide credentials via environment variable:

```bash
export GCP_SERVICE_ACCOUNT='{"access_token":"...","refresh_token":"...","expiry_date":1234567890000}'
```

## Usage Examples

### Basic Text Generation

```python
from g4f.client import Client

client = Client()

response = client.chat.completions.create(
    model="gemini-3-pro-preview",
    provider="GeminiCLI",
    messages=[
        {"role": "user", "content": "Explain machine learning in simple terms"}
    ]
)

print(response.choices[0].message.content)
```

### Streaming Response

```python
from g4f.client import Client

client = Client()

stream = client.chat.completions.create(
    model="gemini-2.5-pro",
    provider="GeminiCLI",
    messages=[
        {"role": "user", "content": "Write a detailed tutorial on Python decorators"}
    ],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

### With System Message

```python
from g4f.client import Client

client = Client()

response = client.chat.completions.create(
    model="gemini-2.5-flash",
    provider="GeminiCLI",
    messages=[
        {"role": "system", "content": "You are a helpful coding assistant. Always provide working code examples."},
        {"role": "user", "content": "How do I read a CSV file in Python?"}
    ]
)

print(response.choices[0].message.content)
```

### Multi-turn Conversation

```python
from g4f.client import Client

client = Client()

messages = [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "What is Python?"}
]

response = client.chat.completions.create(
    model="gemini-3-pro-preview",
    provider="GeminiCLI",
    messages=messages
)

print("Assistant:", response.choices[0].message.content)

# Continue the conversation
messages.append({"role": "assistant", "content": response.choices[0].message.content})
messages.append({"role": "user", "content": "What are its main advantages?"})

response = client.chat.completions.create(
    model="gemini-3-pro-preview",
    provider="GeminiCLI",
    messages=messages
)

print("Assistant:", response.choices[0].message.content)
```

### With Image Input

```python
from g4f.client import Client
from g4f.Provider.needs_auth import GeminiCLI

client = Client()

response = client.chat.completions.create(
    model="gemini-2.5-pro",
    provider=GeminiCLI,
    messages=[
        {"role": "user", "content": "What's in this image?"}
    ],
    media=[("image.png", open("image.png", "rb"))]
)

print(response.choices[0].message.content)
```

## Comparison with Antigravity

| Feature | GeminiCLI | Antigravity |
|---------|-----------|-------------|
| Gemini Models | ✅ | ✅ |
| Claude Models | ❌ | ✅ |
| Thinking Budget | ❌ | ✅ |
| Project Discovery | ✅ | ✅ |
| OAuth Port | 51122 | 51121 |

## Troubleshooting

### "No credentials found" Error

Run the login command:
```bash
g4f-geminicli login
```

### "Token expired" Error

Tokens are automatically refreshed. If refresh fails, run login again:
```bash
g4f-geminicli logout
g4f-geminicli login
```

### Port 51122 Already in Use

The OAuth callback server uses port 51122. If it's in use:
```bash
g4f-geminicli login --no-browser
```
Then manually copy the redirect URL.

### "GCP_SERVICE_ACCOUNT not set" Error

Either:
1. Run `g4f-geminicli login` to create credential file
2. Or set the environment variable with valid credentials

## Notes

- GeminiCLI uses Google Cloud's Code Assist API
- Access may depend on your Google Cloud account permissions
- The provider automatically discovers and caches your GCP project ID
