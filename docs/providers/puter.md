### BaseURL

https://g4f.dev/api/puter

### Examples

```javascript
import { Puter } from 'https://g4f.dev/dist/js/client.js';

// Only browser supported
const client = new Puter();

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
from g4f.Provider import PuterJS

client = Client(provider=PuterJS, api_key="required")

response = client.chat.completions.create(
    model=client.models.all()[0],
    messages=[
        {"role": "user", "content": "Example..."}
    ],
)

print(response.choices[0].message.content)
