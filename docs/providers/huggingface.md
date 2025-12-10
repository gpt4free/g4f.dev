### API Routes

BaseURL: https://g4f.dev/api/huggingface

### Examples

```javascript
import { HuggingFace } from '@gpt4free/g4f.dev';

const client = new HuggingFace({ apiKey: 'required' });

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
from g4f.Provider import HuggingFace

client = Client(provider=HuggingFace, api_key="required")

response = client.chat.completions.create(
    model=client.models.all()[0],
    messages=[
        {"role": "user", "content": "Example..."}
    ],
)

print(response.choices[0].message.content)
