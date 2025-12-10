# OpenAI Chat

Access OpenAI's ChatGPT through browser automation.

## Requirements

- **API Key**: Not required
- **Authentication**: Automatic via browser cookies
- **Browser**: Requires browser with active ChatGPT session

## Notes

> ⚠️ This provider uses browser automation to interact with ChatGPT.
> No public API routes are available. You need to be logged into ChatGPT in your browser.

## API Routes

| Type | URL |
|------|-----|
| Local API | `http://localhost:8080/api/OpenaiChat` |

## Available Models

Model selection is automatic based on your ChatGPT subscription:
- GPT-4o (Plus/Team subscribers)
- GPT-4o-mini (Free tier)
- GPT-4 (Plus/Team subscribers)

## Examples

### Python

```python
from g4f.client import Client
from g4f.Provider import OpenaiChat

# No API key needed - uses browser authentication
client = Client(provider=OpenaiChat)

response = client.chat.completions.create(
    model="",  # Model auto-selected
    messages=[
        {"role": "user", "content": "Hello, how are you?"}
    ],
)

print(response.choices[0].message.content)
```

### JavaScript

```javascript
import { Client } from '@gpt4free/g4f.dev';

const client = new Client({ baseUrl: 'http://localhost:8080/api/OpenaiChat' });

const response = await client.chat.completions.create({
    model: "",
    messages: [
        { role: "user", content: "Hello, how are you?" }
    ],
});

console.log(response.choices[0].message.content);
```

## Troubleshooting

- **401 Unauthorized**: Make sure you're logged into ChatGPT in your browser
- **Rate Limited**: ChatGPT has usage limits, especially on free tier
