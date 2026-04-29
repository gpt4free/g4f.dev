# Working with Images

## What This Means
Some sources can look at pictures and describe them or answer questions about them.

## Supported Sources
- OpenAI (GPT-4 with Vision)
- Gemini (Google)
- Qwen (Alibaba)

## How to Send an Image

**Python:**
```python
from tool import Client

client = Client()
response = client.ask(
    "What's in this picture?",
    image="path/to/photo.jpg"
)
```

**API:**
```bash
curl -X POST http://localhost:8080/v1/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "What is this?"}],
    "image": "data:image/jpeg;base64,/9j/4AAQ..."
  }'
```

## Image Format
- **File:** Just give the file path
- **URL:** Paste the web link
- **Base64:** Encode the image as text

## Size Limits
Most sources accept images up to 5MB. Larger files may be rejected.
