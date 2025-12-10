### Examples

```javascript
import { createClient } from '@gpt4free/g4f.dev/providers';

const client = createClient("ollama", { apiKey: 'optional' });

response = client.chat.completions.create({
    model: client.models.list()[0].id,
    messages: [
        {"role": "user", "content": "Example..."}
    ],
})

console.log(response.choices[0].message.content)
```

```python
from g4f.client import Client
from g4f.Provider import Ollama

client = Client(provider=Ollama, api_key="required")

response = client.chat.completions.create(
    model=client.models.all()[0],
    messages=[
        {"role": "user", "content": "Example..."}
    ],
)

print(response.choices[0].message.content)
