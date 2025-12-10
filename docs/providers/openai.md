### Notes

- Automatic authentication with browser automation
- No public API routes available

### API Routes

BaseURL: http://localhost:8080/api/OpenaiChat

### Examples

```javascript
import { Client } from '@gpt4free/g4f.dev';

const client = new Client({ baseUrl: 'http://localhost:8080/api/OpenaiChat' });

response = client.chat.completions.create({
    model: "",
    messages: [
        {"role": "user", "content": "Example..."}
    ],
})

console.log(response.choices[0].message.content)
```

```python
from g4f.client import Client
from g4f.Provider import OpenaiChat

client = Client(provider=OpenaiChat)

response = client.chat.completions.create(
    model="",
    messages=[
        {"role": "user", "content": "Example..."}
    ],
)

print(response.choices[0].message.content)
