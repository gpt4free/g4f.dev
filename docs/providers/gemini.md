### API Routes

BaseURL: https://generativelanguage.googleapis.com/v1beta/openai
Proxy: https://g4f.dev/api/gemini

### Examples

```javascript
import { createClient } from '@gpt4free/g4f.dev/providers';

const client = createClient("gemini", { apiKey: 'optional' });

response = client.chat.completions.create({
    model: "gemini-2.5-flash",
    messages: [
        {"role": "user", "content": "Example..."}
    ],
})

console.log(response.choices[0].message.content)
```

```python
from g4f.client import Client
from g4f.Provider import GeminiPro

client = Client(provider=GeminiPro, api_key="required")

response = client.chat.completions.create(
    model="gemini-2.5-flash",
    messages=[
        {"role": "user", "content": "Example..."}
    ],
)

print(response.choices[0].message.content)