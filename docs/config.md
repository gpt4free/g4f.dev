# Settings Guide

How to change settings and connect to services that need passwords.

---

## API Keys (Passwords for Services)

Some services need an API key (like a password) to work.

### Set Them Up

**On Mac/Linux:**
```bash
export OPENAI_API_KEY="your_key_here"
export GEMINI_API_KEY="your_key_here"
```

**On Windows:**
```cmd
set OPENAI_API_KEY=your_key_here
```

### Use Them in Code

```python
import os
from g4f.client import Client
from g4f.Provider import OpenaiAPI

# The tool picks up the key automatically
client = Client(provider=OpenaiAPI)
```

---

## Cookies (For Free Web Services)

Some free services (like Bing) need cookies from your browser.

### Get Cookies

1. Install "EditThisCookie" browser extension
2. Go to the service (bing.com, etc.)
3. Copy the cookie values

### Set Cookies in Code

```python
from g4f.cookies import set_cookies

# Bing needs a "_U" cookie
set_cookies(".bing.com", {"_U": "your_cookie_value"})
```

---

## Debug Mode

See what's happening behind the scenes:

```python
from g4f import debug

debug.logging = True  # Shows detailed logs
```

---

## Proxy Setup

If your internet needs a proxy:

```python
from g4f import set_proxy

set_proxy("http://proxy.example.com:8080")
```

---

## Web Interface Password

Protect the web interface with a password:

```python
from g4f.gui import run_gui

run_gui(password="your_secret_password")
```

---

## Summary Table

| What You Need | How to Set It |
|--------------|---------------|
| API Keys | Environment variables or .env file |
| Cookies | Browser extension + set_cookies() |
| Debug Mode | debug.logging = True |
| Proxy | set_proxy() function |
| Web Password | run_gui(password=...) |
