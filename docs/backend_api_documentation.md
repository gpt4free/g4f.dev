# Backend Server Guide

The backend server runs on your computer and lets other apps talk to the tool.

---

## Start the Server

```python
from g4f.api import run_api

# Start the server
run_api()
```

Or use the command line:
```bash
g4f api
```

The server runs at: `http://localhost:8080`

---

## What You Can Do

### Ask a Question

```bash
curl http://localhost:8080/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### See Available Services

```bash
curl http://localhost:8080/models
```

### See Available Providers

```bash
curl http://localhost:8080/providers
```

---

## Web Interface

The server also shows a web page:

1. Open your browser
2. Go to: `http://localhost:8080`
3. You'll see a chat interface

---

## Settings

| Setting | What It Does | How to Change |
|---------|--------------|---------------|
| Port | Which web address to use | `run_api(port=9000)` |
| Debug | Show detailed error messages | `run_api(debug=True)` |

---

## Example: Python Script

```python
import requests

# Ask the local server a question
response = requests.post("http://localhost:8080/chat/completions", json={
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "What is Python?"}]
})

# Print the answer
print(response.json()["choices"][0]["message"]["content"])
```

---

## Keep in Mind

- The server only runs while your program is running
- Other apps on your computer can use it
- It does NOT work from other computers unless you configure your network
