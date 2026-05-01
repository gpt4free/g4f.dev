# G4F – Complete Configuration Guide

This is the **all-in-one reference** for configuring **GPT4Free**:  
Authentication, API Keys, Cookies, `.har` files, Debug Mode, Proxy Setup, and GUI Authentication.  

---

## **1. Environment Variable & API Key Configuration**

Create a `.env` file in your cookies/config directory:

```env
HUGGINGFACE_API_KEY=
POLLINATIONS_API_KEY=
GEMINI_API_KEY=
TOGETHER_API_KEY=
DEEPINFRA_API_KEY=
OPENAI_API_KEY=
GROQ_API_KEY=
OPENROUTER_API_KEY=
```

---

## **2. API Key Setup**

Set keys as **environment variables**:

```bash
# macOS / Linux
export OPENAI_API_KEY="your_key"
export GEMINI_API_KEY="your_key"

# Windows CMD
set OPENAI_API_KEY=your_key

# Windows PowerShell
$env:OPENAI_API_KEY = "your_key"
```

**Example in Python:**
```python
import os
from g4f.client import Client
from g4f.Provider import OpenaiAPI
client = Client(provider=OpenaiAPI, api_key=os.getenv("OPENAI_API_KEY"))
```

---

## **3. Cookie Configuration**

Some providers (Bing, Meta AI, Google Gemini, Microsoft Designer) require cookies.

**Required Cookies:**
- **Bing** → `_U`
- **Google** → all cookies starting with `__Secure-1PSID`

**Set Cookies in Code:**
```python
from g4f.cookies import set_cookies
set_cookies(".bing.com", {"_U": "cookie_value"})
set_cookies(".google.com", {"__Secure-1PSID": "cookie_value"})
```

**From JSON/HAR Files:**
- Store `.json` or `.har` files in your config/directory.
- Use [EditThisCookie extension](https://chromewebstore.google.com/detail/editthiscookie-v3/ojfebgpkimhlhcblbalbfjblapadhbol) to export cookies

**Load Cookies in Python:**
```python
import os
from g4f.cookies import set_cookies_dir, read_cookie_files
cookies_dir = os.path.join(os.path.dirname(__file__), "har_and_cookies")
set_cookies_dir(cookies_dir)
read_cookie_files()
```

**Check Current Cookies Directory Path:**
```python
from g4f.cookies import get_cookies_dir
print(get_cookies_dir())
```

**💡 One-liner (CLI):**
```bash
python -c "from g4f.cookies import get_cookies_dir; print(get_cookies_dir())"
```

---

## **4. `.HAR` File Setup**

### **What is a `.HAR` File?**
A `.HAR` file (HTTP Archive) captures **all network requests and cookies** from a session.  
Some providers like **`OpenaiChat`** require a `.HAR` file to authenticate without an API key.

### **Creating a `.HAR` File:**
1. **Login** to the target provider (e.g., [https://chatgpt.com/](https://chatgpt.com/))  
2. **Open Developer Tools** (Right-click → Inspect OR `F12`)  
3. Go to the **Network** tab  
4. **Reload** the page to capture activity  
5. Perform at least **one chat action/message**  
6. Right-click inside the Network requests list →  
   **Save all as HAR with content**  
7. Save it as `provider_name.har` inside:  
   ```
   ./har_and_cookies/
   ```

🔒 **Security Note:** `.HAR` files contain sensitive cookies — never share them.

**Example Auto-Loading HAR in Python:**
```python
from g4f.cookies import read_cookie_files
read_cookie_files()  # Auto-loads all .har and .json cookie files in the cookies dir
```

---

## **5. Debug Mode**

Enable debug output:
```python
import g4f.debug
g4f.debug.logging = True
```

Example Debug Log:
```
Read .har file: ./har_and_cookies/you.com.har
Cookies added: 10 from .you.com
Read cookie file: ./har_and_cookies/google.json
Cookies added: 16 from .google.com
```

---

## **6. Proxy Configuration**

Set a global proxy to hide/change your IP:

**macOS / Linux:**
```bash
export G4F_PROXY="http://host:port"
```
**Windows CMD:**
```cmd
set G4F_PROXY=http://host:port
```

---

## **7. GUI Authentication**

Set a password:
```bash
export G4F_API_KEY="mypassword"
```

Run the server:
```bash
python -m g4f --debug --port 8080 --g4f-api-key $G4F_API_KEY
```

Access web UI:
- Go to: `http://localhost:8080/chat/`  
- Username: **anything** (e.g., `admin`)  
- Password: **your G4F_API_KEY**

---

## **8. Best Practices**
- 🔒 Never hardcode credentials — use `.env` or environment variables
- 🔄 Rotate keys every 90 days
- 🛡 Secure `.har` and `.json` cookie files
- 📊 Use rate limiting in production

---

[Return to Documentation](README.md)