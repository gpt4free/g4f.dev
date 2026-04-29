# Choosing a Data Source

## What This Means
The tool lets you pick where your response comes from — different "sources" have different strengths.

## Built-In Sources

| Source | What It's Good At | Free? | Needs Login? |
|--------|-------------------|-------|--------------|
| OpenAI | General knowledge | No | Yes (API key) |
| DeepSeek | Coding and logic | No | Yes |
| Gemini | Google ecosystem | No | Yes |
| ChatGLM | Chinese language | Yes | No |
| Qwen | Alibaba models | Yes | No |
| DDG (DuckDuckGo) | Quick searches | Yes | No |

## How to Pick One

**In Python:**
```python
from tool import Client
from tool.Provider import OpenAI, DeepSeek

client = Client()
client.providers = [DeepSeek]  # Only use DeepSeek
```

**In Command Line:**
```bash
tool-cli ask "Hello" --provider DeepSeek
```

**Via API:**
```json
{
  "model": "deepseek-chat"
}
```

## Automatic Picking
If you don't specify one, the tool automatically tries sources in order until one works.

## Tips
- Free sources sometimes have rate limits
- Paid sources usually give better results
- Mix free + paid for best balance
