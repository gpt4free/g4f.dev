# Old API Version (Legacy)

## What This Means
This is the older way to use the tool. It still works, but the new API is recommended.

## Old Python Usage
```python
from tool import ChatCompletion

response = ChatCompletion.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello"}]
)
```

## New Way (Recommended)
```python
from tool import Client

client = Client()
response = client.ask("Hello")
```

## Key Differences

| Old Way | New Way |
|---------|---------|
| `ChatCompletion.create()` | `client.ask()` |
| Direct function call | Object-based |
| Limited features | Full features |

## Should You Switch?
- **New projects:** Use the new way
- **Existing code:** Old way still works
- **Both:** Can be mixed in same project

## Old API Docs
Full old docs: See the main README for current API reference.
