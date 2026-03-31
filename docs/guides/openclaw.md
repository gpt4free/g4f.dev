### OpenClaw with model routing (gpt4free)

OpenClaw is a self-hosted gateway that connects your favorite chat apps — WhatsApp, Telegram, Discord, iMessage, and more — to AI coding agents like Pi. You run a single gateway process on your own machine (or a server), and it becomes the bridge between your messaging apps and an always-available AI assistant.

Who is it for? Developers and power users who want a personal AI assistant they can message from anywhere — without giving up control of their data or relying on a hosted service.

This guide shows how to define an `openclaw` named model route in `gpt4free` using `config.yaml`, set provider API keys in `.env`, and verify behavior.

---

## 1. Why `openclaw`?

## 2. Add route to `config.yaml`

Edit your `cookies/config.yaml` (or `~/.config/g4f/cookies/config.yaml`):

```yaml
models:
  - name: "openclaw"
    providers:
      - provider: "GeminiCLI"
        model: "gemini-3-flash-preview"
        condition: "quota.models.gemini-3-flash-preview.remaining > 0 and error_count < 3"
      - provider: "Antigravity"
        model: "gemini-3-flash"
        condition: "quota.models.gemini-3-flash.quotaInfo.remainingFraction > 0 and error_count < 3"
      - provider: "PollinationsAI"
        model: "openai"
        condition: "balance > 0 or error_count < 3"
```

### Notes
- `condition` is optional; if not provided the provider is always eligible.
- Missing quota fields are treated as `0.0`.
- `error_count` tracks recent failures for each provider (last hour).

## 3. Set API keys in `.env`

In your project root or cookies folder:

```env
GEMINI_API_KEY=your_gemini_key
ANTIGRAVITY_API_KEY=your_antigravity_key
POLLINATIONS_API_KEY=your_pollinations_key
OPENAI_API_KEY=your_openai_key
```

Providers may require additional environment variables; consult individual provider docs in `g4f/Provider/`.

## 4. Use the route in code

```python
from g4f.client import Client
client = Client()

res = client.chat.completions.create(
    model="openclaw",
    messages=[{"role": "user", "content": "Hello from OpenClaw"}],
)
print(res.choices[0].message.content)
```

Or CLI:

```bash
g4f client "Hello" --model openclaw --debug
```

## 5. Debug and verify

- `--debug` logs show selected provider and route decisions.
- `openclaw` will try each provider in order and fallback when conditions fail.
- Use `g4f client --model openclaw` to validate end-to-end.

## 6. Advanced

- Add other providers (`OpenAI`, `Yupp`, etc.) under the same `openclaw` route.
- Use `condition: "error_count < 3"` for generic resiliency.
- If you need special provider settings, set them in `g4f/config.py` or provider-specific environment variables.

### Quick startup (Pollinations-style)

1. Get API key from `pollinations.ai` (or another provider).
2. Set it in `.env` as above.
3. Choose your run mode and model in `config.yaml`:

```yaml
models:
  - name: "openclaw"
    providers:
      - provider: "GeminiCLI"
        model: "gemini-3-flash-preview"
      - provider: "Antigravity"
        model: "gemini-3-flash"
      - provider: "PollinationsAI"
        model: "openai"
```

4. Call with `model="openclaw"` and fallback happens automatically.

### Optional tooling

- add web search by configuring `g4f` provider flags (e.g. `web_search=True` where supported)
- add vision tools via provider-specific params or additional providers
- for script driven setup, run an install script that writes `config.yaml` from a template

#### gpt4free setup script

Use the included script:

```bash
curl -fsSL https://raw.githubusercontent.com/xtekky/gpt4free/main/scripts/setup-openclaw.sh | bash -s -- <POLLINATIONS_API_KEY>
```

### OpenClaw builder flow

- API + key retrieval: `pollinations.ai` account, free credits
- model router: `openclaw` route
- custom model from gpt4free is a provider chain instead of a service URL

---

[Return to Documentation](../README.md)
