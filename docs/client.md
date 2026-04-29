# Using G4F in Python

A beginner-friendly guide to adding AI to your Python programs.

---

## What This Means

If you write Python code, you can use G4F to ask questions to AI models directly from your scripts. No need to pay for API keys or set up complicated billing.

---

## Setup

Install the package:

```bash
pip install g4f
```

---

## Quick Start

### Ask a Simple Question

```python
from g4f.client import Client

client = Client()

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "What is the capital of France?"}]
)

print(response.choices[0].message.content)
```

**What this does:** Creates an AI client, asks a question, and prints the answer.

---

### Save the Answer to a Variable

```python
answer = response.choices[0].message.content
print("The AI said:", answer)
```

---

## Understanding the Pieces

- **`Client()`** — This starts the connection to the AI service.
- **`model="gpt-4o-mini"`** — Picks which AI brain to use. `gpt-4o-mini` is fast and free.
- **`messages=[...]`** — The conversation. Each message has a `role` (who is talking) and `content` (what they said).
  - `"user"` = you
  - `"assistant"` = the AI
  - `"system"` = hidden instructions to the AI
- **`response.choices[0].message.content`** — The AI's actual reply text.

---

## Having a Back-and-Forth Conversation

The AI forgets everything after each request. To make it remember, you must send the whole conversation history every time.

```python
from g4f.client import Client

client = Client()
history = []

while True:
    user_input = input("You: ")
    if user_input.lower() == "bye":
        break

    history.append({"role": "user", "content": user_input})

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=history
    )

    reply = response.choices[0].message.content
    print("AI:", reply)

    history.append({"role": "assistant", "content": reply})
```

---

## Working with Images

### Describe an Image

```python
import requests
from g4f.client import Client

client = Client()

# Load an image from the internet
image = requests.get("https://example.com/photo.jpg", stream=True).raw

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "What is in this image?"}],
    image=image
)

print(response.choices[0].message.content)
```

Or use a local file:

```python
image = open("my_photo.jpg", "rb")
```

---

### Generate an Image

```python
from g4f.client import Client

client = Client()

response = client.images.generate(
    prompt="a white siamese cat sleeping on a couch",
    model="flux"
)

# Get the URL of the generated image
image_url = response.data[0].url
print(image_url)
```

---

## Settings You Can Change

| Setting | What It Does | Example |
|---------|--------------|---------|
| `model` | Chooses the AI model | `"gpt-4o"`, `"claude"`, `"gemini"` |
| `provider` | Chooses which company runs the AI | `g4f.Provider.OpenaiChat` |
| `web_search` | Lets the AI search the internet | `web_search=True` |

---

## Speed: Seeing the Answer as It Types

Instead of waiting for the whole answer, you can watch it appear word by word.

```python
from g4f.client import Client

client = Client()

stream = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Tell me a story"}],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

---

## Common Errors and Fixes

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| "No response" | The provider is down | Try a different `provider` or `model` |
| Slow answers | Heavy traffic | Try `gpt-4o-mini` instead of larger models |
| Image fails | Provider does not support images | Use a vision-capable provider like `CopilotAccount` |

---

## Tips for Better Results

1. **Be specific.** "Explain Python dictionaries like I'm 10" works better than "Tell me about Python."
2. **Use system messages.** Add `{"role": "system", "content": "You are a helpful tutor."}` to guide the AI's style.
3. **Try different models.** If one gives bad answers, another might work better for your task.

---

[Back to main docs](README.md)
