### Notes

- Only streaming
- None API key

### BaseURL

https://g4f.dev/api/perplexity

### Examples

```python
from g4f.client import Client
from g4f.Provider import Perplexity

client = Client(provider=Perplexity)

response = client.chat.completions.create(
    model="auto",
    messages=[
        {"role": "user", "content": "Example..."}
    ],
)

print(response.choices[0].message.content)
