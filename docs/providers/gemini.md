# Gemini

Google's Gemini AI models via the Generative Language API.

## Requirements

- **API Key**: Required (get from [Google AI Studio](https://aistudio.google.com/app/apikey))
- **Authentication**: API key based

## API Routes

| Type | URL |
|------|-----|
| BaseURL | `https://generativelanguage.googleapis.com/v1beta/openai` |
| Proxy | `https://g4f.dev/api/gemini` |

## Available Models

- `gemini-2.5-flash` (recommended)
- `gemini-2.5-flash-lite`

## Examples

### Python

```python
from g4f.client import Client
from g4f.Provider import GeminiPro

# API key is required
client = Client(provider=GeminiPro, api_key="YOUR_GOOGLE_API_KEY")

response = client.chat.completions.create(
    model="gemini-2.5-flash",
    messages=[
        {"role": "user", "content": "Hello, how are you?"}
    ],
)

print(response.choices[0].message.content)
```

### JavaScript

```javascript
import { createClient } from '@gpt4free/g4f.dev/providers';

const client = createClient("gemini", { apiKey: 'YOUR_GOOGLE_API_KEY' });

const response = await client.chat.completions.create({
    model: "gemini-2.5-flash",
    messages: [
        { role: "user", content: "Hello, how are you?" }
    ],
});

console.log(response.choices[0].message.content);
```
