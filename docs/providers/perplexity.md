# Perplexity

Access Perplexity AI's search-augmented language models.

## Requirements

- **API Key**: Not required
- **Streaming**: Responses are streamed only

## API Routes

| Type | URL |
|------|-----|
| Proxy | `https://g4f.space/api/perplexity` |

## Features

- 🔍 **Web Search**: Perplexity augments responses with real-time web search
- 📚 **Citations**: Responses include source citations
- 🌊 **Streaming**: All responses are streamed

## Available Models

- `auto` (recommended) - Automatically selects the best model

## Examples

### Python

```python
from g4f.client import Client
from g4f.Provider import Perplexity

# No API key required
client = Client(provider=Perplexity)

response = client.chat.completions.create(
    model="auto",
    messages=[
        {"role": "user", "content": "What are the latest developments in AI?"}
    ],
)

print(response.choices[0].message.content)
```

### Streaming Example

```python
from g4f.client import Client
from g4f.Provider import Perplexity

client = Client(provider=Perplexity)

stream = client.chat.completions.create(
    model="auto",
    messages=[
        {"role": "user", "content": "Explain quantum computing"}
    ],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```
