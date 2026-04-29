# G4F — Using AsyncClient for Faster AI Responses

## What is AsyncClient?

**AsyncClient** is like a faster version of the regular G4F client. Instead of waiting for one AI response at a time, it can handle **multiple requests simultaneously** — just like how you can text several friends at once instead of one by one.

## Why Use It?

- **Speed**: Run multiple AI tasks at the same time
- **Efficiency**: Perfect for apps that need to handle many users
- **Same features**: Everything the regular client can do, AsyncClient can too

## Getting Started

### 1. Install G4F
```bash
pip install g4f
```

### 2. Import and Create Client
```python
from g4f.client import AsyncClient

client = AsyncClient()
```

### 3. Basic Chat (Same as Regular Client)
```python
response = await client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Tell me a joke"}]
)
print(response.choices[0].message.content)
```

### 4. Run Multiple Tasks at Once
```python
import asyncio

async def ask_multiple_questions():
    questions = [
        "What is Python?",
        "What is JavaScript?",
        "What is HTML?"
    ]
    
    # Create all tasks at once
    tasks = [
        client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": q}]
        )
        for q in questions
    ]
    
    # Wait for ALL to finish at the same time
    responses = await asyncio.gather(*tasks)
    
    for response in responses:
        print(response.choices[0].message.content)

# Run it
asyncio.run(ask_multiple_questions())
```

## Available Features

| Feature | How It Works |
|---------|-------------|
| Text Chat | Ask questions and get text replies |
| Streaming | Get the reply word-by-word as it's being written |
| Image Understanding | Send a picture and ask about it |
| Image Creation | Generate images from text descriptions |
| Audio Transcription | Convert speech to text |
| Video Creation | Generate short videos from prompts |

## Streaming Example (Watch AI Write Live)
```python
stream = await client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Write a short poem"}],
    stream=True  # Enable streaming
)

async for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")
```

## Image Understanding Example
```python
response = await client.chat.completions.create(
    model="gpt-4o",
    messages=[{
        "role": "user",
        "content": "Describe this image: https://example.com/picture.jpg"
    }]
)
print(response.choices[0].message.content)
```

## Image Creation Example
```python
response = await client.images.generate(
    model="flux",
    prompt="A cute robot playing guitar in a garden"
)
print(response.data[0].url)  # Link to the generated image
```

## Quick Reference: AsyncClient vs Regular Client

| What You Want | Regular Client | AsyncClient |
|--------------|---------------|-------------|
| One chat at a time | ✅ Yes | ✅ Yes |
| Multiple chats at once | ❌ No | ✅ Yes |
| Same features | ✅ Yes | ✅ Yes |
| Speed (single task) | ✅ Same | ✅ Same |
| Speed (many tasks) | ⚠️ Slower | ✅ Faster |

## Tips
- **Use AsyncClient** when building apps that handle multiple users
- **Use Regular Client** for simple scripts or one-off tasks
- Always wrap async code in `async def` and run with `asyncio.run()`
