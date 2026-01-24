# Ollama

Run large language models locally with Ollama.

## Requirements

- **Ollama**: Must be installed and running locally ([Download Ollama](https://ollama.ai))
- **API Key**: Not required for local usage
- **Default URL**: `http://localhost:11434`
- **Proxy URL**: `http://g4f.space/api/ollama`

## Setup

1. Install Ollama from [ollama.ai](https://ollama.ai)
2. Pull a model: `ollama pull llama3`
3. Ollama runs automatically in the background

## Available Models

Depends on what you've pulled locally. Popular models:
- `llama3` / `llama3:70b`
- `mistral` / `mixtral`
- `codellama`
- `phi3`

## Examples

### Python

```python
from g4f.client import Client
from g4f.Provider import Ollama

# Connect to local Ollama instance
client = Client(provider=Ollama)

# List available models (pulled locally)
models = client.models.get_all()
print(f"Available models: {models}")

# Chat completion
response = client.chat.completions.create(
    model="llama3",
    messages=[
        {"role": "user", "content": "Hello, how are you?"}
    ],
)

print(response.choices[0].message.content)
```

### JavaScript (Remote Models)

```javascript
import { Client } from '@gpt4free/g4f.dev';

const client = new Client({ baseUrl: 'https://g4f.space/api/ollama'});

const response = await client.chat.completions.create({
    model: "llama3",
    messages: [
        { role: "user", content: "Hello, how are you?" }
    ],
});

console.log(response.choices[0].message.content);
```

## Configuration

To use a remote Ollama instance:

```python
from g4f.client import Client
from g4f.Provider import Ollama

client = Client(
    provider=Ollama,
    base_url="http://your-server:11434"
)
```
