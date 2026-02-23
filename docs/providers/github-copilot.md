# GitHub Copilot Provider

GitHub Copilot is a provider that gives access to GitHub's Copilot API, supporting GPT, Claude, Gemini, and Grok models through GitHub's infrastructure.

## Supported Models

- **GPT-5 Series**: `gpt-5`, `gpt-5-mini`, `gpt-5.1`, `gpt-5.2`
- **GPT-5 Codex**: `gpt-5-codex`, `gpt-5.1-codex`, `gpt-5.1-codex-mini`, `gpt-5.1-codex-max`, `gpt-5.2-codex`, `gpt-5.3-codex`
- **GPT-4 Series**: `gpt-4.1`, `gpt-4o`, `gpt-4o-mini`, `gpt-4`
- **Claude 4 Series**: `claude-opus-4.6`, `claude-opus-4.5`, `claude-sonnet-4.5`, `claude-sonnet-4`, `claude-haiku-4.5`
- **Gemini**: `gemini-3-pro-preview`, `gemini-3-flash-preview`, `gemini-2.5-pro`
- **Grok**: `grok-code-fast-1`
- **Legacy**: `gpt-3.5-turbo`
- **Embeddings**: `text-embedding-3-small`, `text-embedding-ada-002`

## Features

- ✅ Text generation with streaming
- ✅ Message history support
- ✅ System message support
- ✅ OAuth2 device flow authentication
- ✅ Multi-model support (GPT, Claude, Gemini, Grok)
- ✅ Code-optimized models (Codex series)

## Authentication

GitHub Copilot requires OAuth2 authentication with GitHub. The provider supports an interactive browser-based device code flow.

### CLI Login

Use the dedicated CLI tool for authentication:

```bash
# Install g4f first
pip install -e .

# Login with browser (device code flow)
g4f auth github-copilot

# Check authentication status
g4f auth github-copilot status

# Remove saved credentials
g4f auth github-copilot logout
```

### Python Login

```python
import asyncio
from g4f.Provider.github import GithubCopilot

# Interactive login
asyncio.run(GithubCopilot.login())

# Check if credentials exist
if GithubCopilot.has_credentials():
    print("Already logged in")
```

### Credential Storage

Credentials are stored in one of these locations:
1. g4f config directory: `~/.config/g4f/cookies/auth_GithubCopilot.json`
2. Default path: `~/.github-copilot/oauth_creds.json`

## Usage Examples

### Basic Text Generation

```python
from g4f.client import Client
from g4f.Provider.github import GithubCopilot

client = Client(provider=GithubCopilot)

response = client.chat.completions.create(
    model="gpt-4.1",
    messages=[
        {"role": "user", "content": "Explain quantum computing in simple terms"}
    ]
)

print(response.choices[0].message.content)
```

### Streaming Response

```python
from g4f.client import Client
from g4f.Provider.github import GithubCopilot

client = Client(provider=GithubCopilot)

stream = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "user", "content": "Write a short story about AI"}
    ],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

### Using Claude via GitHub Copilot

```python
from g4f.client import Client
from g4f.Provider.github import GithubCopilot

client = Client(provider=GithubCopilot)

response = client.chat.completions.create(
    model="claude-sonnet-4.5",
    messages=[
        {"role": "user", "content": "Hello Claude!"}
    ]
)

print(response.choices[0].message.content)
```

### Using Code-Optimized Models

```python
from g4f.client import Client
from g4f.Provider.github import GithubCopilot

client = Client(provider=GithubCopilot)

response = client.chat.completions.create(
    model="gpt-5.1-codex",
    messages=[
        {"role": "user", "content": "Write a Python function to sort a list using merge sort"}
    ]
)

print(response.choices[0].message.content)
```

### Async Usage

```python
import asyncio
from g4f.client import AsyncClient
from g4f.Provider.github import GithubCopilot

async def main():
    client = AsyncClient(provider=GithubCopilot)
    
    response = await client.chat.completions.create(
        model="gpt-4.1",
        messages=[
            {"role": "user", "content": "What is the meaning of life?"}
        ]
    )
    
    print(response.choices[0].message.content)

asyncio.run(main())
```

## API Routes

| Type | URL |
|------|-----|
| Local API | `http://localhost:8080/api/GithubCopilot` |
| Base URL | `https://api.githubcopilot.com` |

## Requirements

- **GitHub Account**: Required with Copilot access
- **Copilot Subscription**: GitHub Copilot Individual, Business, or Enterprise
- **Authentication**: OAuth2 device flow via CLI

## Troubleshooting

### "No credentials found" Error

Run the login command:
```bash
g4f auth github-copilot
```

### "Token expired" Error

Tokens are automatically refreshed. If refresh fails, run login again:
```bash
g4f auth github-copilot logout
g4f auth github-copilot
```

### Check Authentication Status

```bash
g4f auth github-copilot status
```

This will show:
- Whether credentials are found
- Token expiration time
- OAuth scope

## Notes

- GitHub Copilot requires an active Copilot subscription
- The provider supports multiple AI backends through GitHub's unified API
- Code-optimized models (Codex series) are best for programming tasks
- OAuth credentials are securely stored locally
