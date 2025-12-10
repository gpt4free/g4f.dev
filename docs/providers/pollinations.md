### API Routes

Endpoint: https://text.pollinations.ai/openai
BaseURL (Proxy): https://g4f.dev/ai/pollinations
Models: https://gen.pollinations.ai/v1/models

### Examples

```javascript
import { Pollinations } from '@gpt4free/g4f.dev';

const client = new Pollinations({ apiKey: 'optional' });

response = client.chat.completions.create({
    model: "openai",
    messages: [
        {"role": "user", "content": "Example..."}
    ],
})

console.log(response.choices[0].message.content)
```

```python
from pollinations import Pollinations

# Create a client (no API key required for free tier)
client = Pollinations()

# Or with API key for gen.pollinations.ai
# client = Pollinations(api_key="your-api-key")

# Chat completion (OpenAI-compatible)
response = client.chat.completions.create(
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Explain quantum computing in simple terms"}
    ],
    model="openai",
    temperature=0.7
)
print(response.choices[0].message.content)