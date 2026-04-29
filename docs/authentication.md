# Login & Passwords Guide

How to connect to services that need passwords or browser cookies.

---

## API Keys (Service Passwords)

### What You Need
- Python installed
- The tool installed (`pip install g4f`)
- API keys from services you want to use

### Get Your Keys
Sign up at these services to get free or paid keys:
- OpenAI
- Google (Gemini)
- Anthropic
- HuggingFace
- And others...

### Set Up Keys

**Mac/Linux (Terminal):**
```bash
export OPENAI_API_KEY="paste-your-key-here"
export GEMINI_API_KEY="paste-your-key-here"
```

**Windows (Command Prompt):**
```cmd
set OPENAI_API_KEY=paste-your-key-here
```

### Use Keys in Your Code

```python
import os
from g4f.client import Client
from g4f.Provider import OpenaiAPI

# Just create the client - it finds keys automatically
client = Client(provider=OpenaiAPI)

# Now ask something
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

---

## Browser Cookies (For Free Services)

Some services don't need keys - they use your browser login.

### Which Services Need Cookies?
- **Bing** → needs `_U` cookie
- **Google** → needs `__Secure-1PSID` cookie
- **Meta AI** → needs Facebook cookies

### How to Get Cookies

1. Install "EditThisCookie" extension in Chrome/Firefox
2. Go to the website (bing.com, google.com, etc.)
3. Log in normally
4. Click the extension icon
5. Copy the cookie values

### Use Cookies in Code

```python
from g4f.cookies import set_cookies

# Set Bing cookie
set_cookies(".bing.com", {"_U": "your_cookie_value_here"})

# Set Google cookie
set_cookies(".google.com", {"__Secure-1PSID": "your_cookie_value_here"})
```

---

## Web Interface Password

Protect your local web interface so others can't use it:

```python
from g4f.gui import run_gui

# Start with password protection
run_gui(password="my_secret_password")
```

Now when someone visits the web page, they must enter this password.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "API key not found" | Check that you set the environment variable |
| "Cookie invalid" | Log in again and copy fresh cookies |
| "Rate limited" | Wait a few minutes or use a different service |
| "Access denied" | Check that your password is correct |
