# HuggingFace

Access thousands of open-source models via HuggingFace's Inference API.

## Requirements

- **API Key**: Required (get from [HuggingFace Settings](https://huggingface.co/settings/tokens))
- **Authentication**: Bearer token

## API Routes

| Type | URL |
|------|-----|
| Proxy | `https://g4f.dev/api/huggingface` |

## Available Models

HuggingFace provides access to many models. Use `client.models.get_all()` to list available models.

Popular models include:
- `meta-llama/Llama-3.1-70B-Instruct`
- `mistralai/Mixtral-8x7B-Instruct-v0.1`
- `microsoft/Phi-3-mini-4k-instruct`

## Examples

### Python

```python
from g4f.client import Client
from g4f.Provider import HuggingFace

# API key is required
client = Client(provider=HuggingFace, api_key="YOUR_HF_TOKEN")

# List available models
models = client.models.get_all()
print(f"Available models: {models[:5]}")

# Chat completion
response = client.chat.completions.create(
    model="meta-llama/Llama-3.1-70B-Instruct",
    messages=[
        {"role": "user", "content": "Hello, how are you?"}
    ],
)

print(response.choices[0].message.content)
```

### JavaScript

```javascript
import { HuggingFace } from '@gpt4free/g4f.dev';

const client = new HuggingFace({ apiKey: 'YOUR_HF_TOKEN' });

const response = await client.chat.completions.create({
    model: "meta-llama/Llama-3.1-70B-Instruct",
    messages: [
        { role: "user", content: "Hello, how are you?" }
    ],
});

console.log(response.choices[0].message.content);
```
