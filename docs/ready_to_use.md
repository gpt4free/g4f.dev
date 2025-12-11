## Documentation: API endpoints and usage

### Overview
- This collection exposes multiple base URLs (providers) for chat-style completions. Each entry in the table lists a base URL (with /models removed) and whether an API key is required.
- Base URL extraction: remove /models from the URL in your table to get the API base_url you should use in requests.

### Base URLs Table
| Base URLs | API key | Notes |
| --- | --- | --- |
| [https://localhost:1337/v1](https://localhost:1337/v1/models) | none required | use it locally |
| [https://g4f.dev/api/groq](https://g4f.dev/api/groq/models) | none required | Use Groq provider |
| [https://g4f.dev/api/ollama](https://g4f.dev/api/ollama/models) | none required | Use Ollama provider |
| [https://g4f.dev/api/pollinations.ai](https://g4f.dev/api/pollinations.ai/models) | none required | Proxy for pollinations.ai |
| [https://g4f.dev/api/nvidia](https://g4f.dev/api/nvidia/models) | none required | Use Nvidia provider |
| [https://g4f.dev/api/gemini](https://g4f.dev/ai/gemini) | none required | Hosted Gemini provider |
| [https://g4f.dev/api/gpt-oss-120b](https://g4f.dev/api/gpt-oss-120b/models) | required | now requires API key from [g4f.dev/api_key](https://g4f.dev/api_key.html) |
| [https://g4f.dev/api/Azure](https://g4f.dev/api/Azure/models) | required | Use Azure on my bill, get key from [g4f.dev/api_key](https://g4f.dev/api_key.html) |
| [https://g4f.dev/v1](https://g4f.dev/v1/models) | required | Hosted instance, many models, get key from [g4f.dev/api_key](https://g4f.dev/api_key.html) |

### Also Supported API Routes:
- **Nvidia**: https://integrate.api.nvidia.com/v1
- **DeepInfra**: https://api.deepinfra.com/v1
- **OpenRouter**: https://openrouter.ai/api/v1
- **Google Gemini**: https://generativelanguage.googleapis.com/v1beta/openai
- **xAI**: https://api.x.ai/v1
- **Together**: https://api.together.xyz/v1
- **OpenAI**: https://api.openai.com/v1
- **Strinable Inf**: https://stringableinf.com/api/v1
- **TypeGPT**: https://typegpt.ai/api
- **Grok**: https://api.grok.com/v1
- **ApiAirforce**: baseUrl: https://api.airforce/v1, apiEndpoint: https://stringableinf.com/api/v1/chat/completions
- **Auto Provider & Model Selection**: apiEndpoint: https://g4f.dev/ai/{now}

### Individual clients available for:
- [Pollinations AI](providers/pollinations.md)
- [Puter AI](providers/puter.md)
- [HuggingFace](providers/huggingface.md)
- [Ollama](providers/ollama.md)
- [Gemini](providers/gemini.md)
- [OpenAI Chat](providers/openai.md)
- [Perplexity](providers/perplexity.md)

### How to choose a base URL
- If you want a local or self-hosted instance, you can use:
  - https://localhost:1337/v1
- If you want a free or public provider, you can use one of the g4f.dev endpoints (e.g., groq, ollama, pollinations.ai, nvidia, grok).
- If you want Azure-backed usage or hosted instances, use:
  - https://g4f.dev/api/Azure (requires API key)
  - https://g4f.dev/v1 (requires API key)

### API usage basics
- **Endpoints**: All chat-style interactions use the chat completions endpoint at `{base_url}/chat/completions`
- **Authentication**:
  - If the table entry says "none required", you do not need to pass an API key.
  - If an API key is required (Azure, hosted instances, or gpt-oss-120b), supply api_key in your client configuration or request headers.
- **Payload shape** (typical):
  - model: string (e.g., gpt-oss-120b, gpt-4o, etc.)
  - temperature: number (optional)
  - messages: array of { role: "system" | "user" | "assistant", content: string }

### Example payload
```json
{
  "model": "gpt-4o",
  "temperature": 0.9,
  "messages": [{"role": "user", "content": "Hello, how are you?"}]
}
```

### Examples

#### 1) Python requests (local example)
- Sends a chat completion to the local endpoint at /v1/chat/completions

```python
import requests

payload = {
    "model": "gpt-4o",
    "temperature": 0.9,
    "messages": [{"role": "user", "content": "Hello, how are you?"}]
}

response = requests.post("http://localhost:1337/v1/chat/completions", json=payload)

if response.status_code == 200:
    print(response.text)
else:
    print(f"Request failed with status code {response.status_code}")
    print("Response:", response.text)
```

#### 2) Python with OpenAI client (custom base_url)
- Use the OpenAI Python client but point it at your chosen base URL

```python
from openai import OpenAI

client = OpenAI(
    api_key="secret",  #  A API key is required; set 'secrect' for "none required api_key" providers
    base_url="https://g4f.dev/api/gpt-oss-120b"  # replace with the chosen base_url
)

response = client.chat.completions.create(
    model="gpt-oss-120b",
    messages=[{"role": "user", "content": "Explain quantum computing"}],
)

print(response.choices[0].message.content)
```

#### 3) JavaScript (HTML/JS client)
- Basic usage in a browser-like environment

```html
<script type="module">
    import Client from 'https://g4f.dev/dist/js/client.js';

    // Initialize a client with a base URL and optional API key
    const client = new Client({ baseUrl: 'https://g4f.dev/api/grok', apiKey: 'secret' });

    const result = await client.chat.completions.create({
        model: 'grok-4-fast-non-reasoning',
        messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'Tell me a joke.' }
        ]
    });
</script>
```

### Notes and quick tips
- **API Key Changes**: The gpt-oss-120b endpoint now requires an API key. Retrieve it from [g4f.dev/api_key.html](https://g4f.dev/api_key.html).
- **Hosted Instance URL**: Updated from host.g4f.dev/v1 to g4f.dev/v1
- The examples assume a chat-style completions API where you pass messages and receive a response containing the assistant's content.
- The base_url is always the URL without the trailing /models segment