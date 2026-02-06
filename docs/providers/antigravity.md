# Antigravity Provider

Antigravity is a provider that gives access to Google's Antigravity API (Code Assist), supporting Gemini and Claude models through Google Cloud's infrastructure.

## Supported Models

- **Gemini 2.5**: `gemini-2.5-pro`, `gemini-2.5-flash`
- **Gemini 3**: `gemini-3-pro-preview`, `gemini-3-flash-preview`, `gemini-3-pro-high`, `gemini-3-pro-low`
- **Claude**: `claude-sonnet-4.5`, `claude-opus-4.5`

## Features

- ✅ Text generation with streaming
- ✅ Message history support
- ✅ System message support
- ✅ Image/media input
- ✅ Tool calls (function calling)
- ✅ Reasoning tokens (thinking budget)
- ✅ OAuth2 authentication with PKCE

## Authentication

Antigravity requires OAuth2 authentication with Google. The provider supports an interactive browser-based login flow.

### CLI Login

Use the dedicated CLI tool for authentication:

```bash
# Install g4f first
pip install -e .

# Login with browser (recommended)
g4f-antigravity login

# Login without auto-opening browser (manual URL copy)
g4f-antigravity login --no-browser

# Login with specific project ID
g4f-antigravity login --project-id YOUR_PROJECT_ID

# Check authentication status
g4f-antigravity status

# Remove saved credentials
g4f-antigravity logout
```

### Python Login

```python
import asyncio
from g4f.Provider.needs_auth import Antigravity

# Interactive login
asyncio.run(Antigravity.login())

# Check if credentials exist
if Antigravity.has_credentials():
    print("Already logged in")
```

### Credential Storage

Credentials are stored in one of these locations (checked in order):
1. g4f config directory: `~/.config/g4f/cookies/Antigravity.json`
2. Default path: `~/.antigravity/oauth_creds.json`

## Usage Examples

### Basic Text Generation

```python
from g4f.client import Client

client = Client()

response = client.chat.completions.create(
    model="gemini-3-pro-preview",
    provider="Antigravity",
    messages=[
        {"role": "user", "content": "Explain quantum computing in simple terms"}
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
    provider="Antigravity",
    messages=[
        {"role": "user", "content": "Write a short story about AI"}
    ],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

### With Thinking Budget (Reasoning)

```python
from g4f.client import Client

client = Client()

response = client.chat.completions.create(
    model="gemini-3-pro-high",  # Uses high thinking level
    provider="Antigravity",
    messages=[
        {"role": "user", "content": "Solve this complex math problem: ..."}
    ]
)

print(response.choices[0].message.content)
```

### Using Claude via Antigravity

```python
from g4f.client import Client

client = Client()

response = client.chat.completions.create(
    model="claude-sonnet-4.5",
    provider="Antigravity",
    messages=[
        {"role": "user", "content": "Hello Claude!"}
    ]
)

print(response.choices[0].message.content)
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTIGRAVITY_SERVICE_ACCOUNT` | JSON string with OAuth credentials (alternative to file-based auth) |
| `ANTIGRAVITY_PROJECT_ID` | Google Cloud project ID (auto-discovered if not set) |

## Troubleshooting

### "No credentials found" Error

Run the login command:
```bash
g4f-antigravity login
```

### "Token expired" Error

Tokens are automatically refreshed. If refresh fails, run login again:
```bash
g4f-antigravity logout
g4f-antigravity login
```

### Port 51121 Already in Use

The OAuth callback server uses port 51121. If it's in use:
```bash
g4f-antigravity login --no-browser
```
Then manually copy the redirect URL.

## Notes

- Antigravity uses Google Cloud's Code Assist API
- Access may depend on your Google Cloud account permissions
- Some models support different "thinking levels" for enhanced reasoning
