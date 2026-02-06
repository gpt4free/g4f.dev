# QwenCode Provider

QwenCode provides access to Alibaba's Qwen coding models through the Qwen Code API.

## Supported Models

- `qwen3-coder-plus` (default)

## Features

- ✅ Text/code generation with streaming
- ✅ Message history support
- ✅ OAuth2 device code authentication
- ✅ Automatic token refresh

## Authentication

QwenCode uses OAuth2 device code flow for authentication. This opens a browser where you authorize the application.

### CLI Login

Use the dedicated CLI tool for authentication:

```bash
# Install g4f first
pip install -e .

# Login (opens browser automatically)
g4f-qwencode login

# Check authentication status
g4f-qwencode status

# Remove saved credentials
g4f-qwencode logout
```

### Python Login

```python
import asyncio
from g4f.Provider.qwen import QwenCode

# Interactive login
asyncio.run(QwenCode.login())

# Check if credentials exist
if QwenCode.has_credentials():
    print("Already logged in")
```

### Credential Storage

Credentials are stored in one of these locations (checked in order):
1. g4f config directory: `~/.config/g4f/cookies/QwenCode.json`
2. Default path: `~/.qwen/oauth_creds.json`

## Usage Examples

### Basic Code Generation

```python
from g4f.client import Client

client = Client()

response = client.chat.completions.create(
    model="qwen3-coder-plus",
    provider="QwenCode",
    messages=[
        {"role": "user", "content": "Write a Python function to calculate fibonacci numbers"}
    ]
)

print(response.choices[0].message.content)
```

### Streaming Response

```python
from g4f.client import Client

client = Client()

stream = client.chat.completions.create(
    model="qwen3-coder-plus",
    provider="QwenCode",
    messages=[
        {"role": "user", "content": "Create a REST API with FastAPI for a todo app"}
    ],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

### Code Review

```python
from g4f.client import Client

client = Client()

code = """
def process_data(data):
    result = []
    for i in range(len(data)):
        if data[i] > 0:
            result.append(data[i] * 2)
    return result
"""

response = client.chat.completions.create(
    model="qwen3-coder-plus",
    provider="QwenCode",
    messages=[
        {"role": "user", "content": f"Review this Python code and suggest improvements:\n\n```python\n{code}\n```"}
    ]
)

print(response.choices[0].message.content)
```

### Multi-turn Conversation

```python
from g4f.client import Client

client = Client()

messages = [
    {"role": "user", "content": "I need to build a web scraper in Python"}
]

# First response
response = client.chat.completions.create(
    model="qwen3-coder-plus",
    provider="QwenCode",
    messages=messages
)

print("Assistant:", response.choices[0].message.content)

# Follow-up
messages.append({"role": "assistant", "content": response.choices[0].message.content})
messages.append({"role": "user", "content": "Now add error handling and rate limiting"})

response = client.chat.completions.create(
    model="qwen3-coder-plus",
    provider="QwenCode",
    messages=messages
)

print("Assistant:", response.choices[0].message.content)
```

## Troubleshooting

### "No credentials found" Error

Run the login command:
```bash
g4f-qwencode login
```

### "Token expired" / "Refresh failed" Error

Tokens are automatically refreshed. If refresh fails, run login again:
```bash
g4f-qwencode logout
g4f-qwencode login
```

### Device Code Flow Times Out

The device code flow has a timeout (default 30 minutes). If it times out:
1. Run login again: `g4f-qwencode login`
2. Complete the browser authorization promptly

## Notes

- QwenCode is optimized for coding tasks
- The provider uses Alibaba Cloud's Qwen infrastructure
- Free tier limits may apply based on your Qwen account
