# Puter

Access AI models through Puter's cloud platform.

## Requirements

- **API Key**: Required (get from [Puter](https://puter.com))
- **Browser**: JavaScript client is browser-only

## API Routes

| Type | URL |
|------|-----|
| Proxy | `https://g4f.dev/api/puter` |

## Notes

> ⚠️ The JavaScript client only works in browser environments.
> For server-side usage, use the Python client.

## Available Models

Use `client.models.get_all()` to list available models.

## Examples

### Python

```python
from g4f.client import Client
from g4f.Provider import PuterJS

# API key is required
client = Client(provider=PuterJS, api_key="YOUR_PUTER_API_KEY")

# List available models
models = client.models.get_all()
print(f"Available models: {models}")

# Chat completion
response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[
        {"role": "user", "content": "Hello, how are you?"}
    ],
)

print(response.choices[0].message.content)
```

### JavaScript (Browser Only)

```javascript
import { Puter } from 'https://g4f.dev/dist/js/client.js';

// Browser environment only
const client = new Puter();

const models = await client.models.list();
console.log('Available models:', models);

const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
        { role: "user", content: "Hello, how are you?" }
    ],
});

console.log(response.choices[0].message.content);
```
