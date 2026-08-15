I'll help you create a document about obtaining headers from that Gemini/Bard API endpoint. Let me search for current information about this topic.Based on the research, I'll create a comprehensive document on how to obtain the headers for the Gemini web API endpoint.

# How to Obtain Headers from `/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate` in Gemini Web

## Overview

The `/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate` endpoint is used by Google's Gemini (formerly Bard) web interface to handle chat requests. This document explains how to extract the required headers and authentication information needed to interact with this unofficial API [[13]].

**Important Note**: This is an unofficial, reverse-engineered API. Google does not provide official documentation for this endpoint, and it may change without notice [[27]][[28]].

---

## Required Headers

### Standard Request Headers

```python
REQUEST_HEADERS = {
    "accept": "*/*",
    "authority": "gemini.google.com",
    "origin": "https://gemini.google.com",
    "referer": "https://gemini.google.com/",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    "x-same-domain": "1"
}
```

### Additional Headers (Context-Dependent)

Depending on your session and request type, you may also need:

```python
{
    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    "Authorization": "SAPISIDHASH {timestamp}_{hash}",  # Optional, for authenticated sessions
    "X-Goog-AuthUser": "{auth_user_id}",  # For multi-account sessions
    "x-goog-ext-73010989-jspb": "[0]",  # Model-specific header
    "x-goog-ext-525005358-jspb": '["{request_uuid}",1]'  # Request tracking
}
```

---

## Authentication Requirements

### Primary Authentication: Cookies

The most critical component is the **cookie authentication**. You need to extract specific cookies from your browser session [[20]].

#### Required Cookies (in order of priority):

1. **`__Secure-1PSID`** - Primary session cookie (most important)
2. **`__Secure-1PSIDTS`** - Session timestamp cookie
3. **`__Secure-1PSIDCC`** - Alternative session cookie
4. **`NID`** - Google identification cookie

**Note**: Cookie requirements may vary by account or region. Try `__Secure-1PSIDCC` alone first, then combine with others if needed [[3]].

### Secondary Authentication: XSRF Token (`at` parameter)

The `at` parameter (also known as SNlM0e) is extracted from the page source and included in form data [[11]][[13]].

---

## Step-by-Step Guide to Extract Headers

### Method 1: Using Browser Developer Tools (Recommended)

#### Step 1: Open Gemini Web Interface
1. Navigate to [https://gemini.google.com](https://gemini.google.com)
2. Log in with your Google account
3. Keep the browser window open

#### Step 2: Open Developer Tools
- Press **F12** or right-click → **Inspect**
- Navigate to the **Network** tab
- Ensure "Preserve log" is checked

#### Step 3: Trigger a Request
1. Send any message/prompt to Gemini in the chat interface
2. Watch the Network tab for new requests

#### Step 4: Locate the StreamGenerate Request
- Look for a POST request to:
  ```
  https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate
  ```
- Click on this request to view details [[4]]

#### Step 5: Extract Headers

##### A. Request Headers Tab
Copy all headers, especially:
- `Cookie` (contains all authentication cookies)
- `User-Agent`
- `Referer`
- `Origin`
- `Content-Type`
- Any `x-*` headers

##### B. Payload/Form Data Tab
Look for:
- **`at`** - The XSRF token value
- **`f.req`** - The JSON-encoded request payload
- **`bl`** - Build label parameter (e.g., `boq_assistant-bard-web-server_20260525.09_p0`)

#### Step 6: Extract Cookies Manually
Alternatively, go to:
- **Application** tab → **Cookies** → `https://gemini.google.com`
- Copy values for:
  - `__Secure-1PSID`
  - `__Secure-1PSIDTS`
  - `__Secure-1PSIDCC`
  - `NID`

---

### Method 2: Automated Cookie Extraction

#### Using Python Libraries

Several community-created libraries can automatically extract cookies:

```python
from gemini import Gemini

# Auto-collect cookies from browser
client = Gemini(auto_cookies=True)

# Or specify target cookies
client = Gemini(
    auto_cookies=True, 
    target_cookies=["__Secure-1PSID", "__Secure-1PSIDTS"]
)
```

#### Using Browser Extensions
1. Install a cookie export extension (e.g., "ExportThisCookies" for Chrome)
2. Export cookies from gemini.google.com
3. Copy the exported JSON/text file contents [[3]]

---

## Complete Example: Making a Request

### Python Implementation

```python
import requests
import json
import random

class GeminiClient:
    def __init__(self, cookies_dict):
        self.session = requests.Session()
        
        # Set up headers
        self.session.headers = {
            "accept": "*/*",
            "authority": "gemini.google.com",
            "origin": "https://gemini.google.com",
            "referer": "https://gemini.google.com/",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
            "x-same-domain": "1",
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8"
        }
        
        # Set cookies
        for key, value in cookies_dict.items():
            self.session.cookies.set(key, value)
        
        # Extract XSRF token (SNlM0e) from page
        self.at_token = self._get_xsrf_token()
    
    def _get_xsrf_token(self):
        response = self.session.get("https://gemini.google.com/app")
        # Parse SNlM0e from response HTML
        # Pattern: SNlM0e":"VALUE"
        import re
        match = re.search(r'SNlM0e(?:?"|"):?"(.*?)(?:?"|")', response.text)
        return match.group(1) if match else None
    
    def send_message(self, prompt, conversation_id="", response_id="", choice_id=""):
        # Build request parameters
        params = {
            "bl": "boq_assistant-bard-web-server_20260525.09_p0",
            "hl": "en",
            "_reqid": random.randint(100000, 999999),
            "rt": "c"
        }
        
        # Build request payload
        request_data = [
            None,
            json.dumps([
                None,
                json.dumps([
                    [prompt, 0, None, [], None, None, 0],  # Message
                    ["en"],  # Language
                    [conversation_id, response_id, choice_id, None, None, None, None, None, None, ""],  # Conversation context
                    None,
                    None,
                    [1],
                    1,
                    None,
                    None,
                    None,
                    1,
                    0,
                    None,
                    0,
                    1,
                    [4],
                    [1],
                    0,
                    None,
                    [],
                    2,
                    1,  # Model mode (1=Flash, 3=Pro)
                    1,  # Thinking mode
                    0,
                    1  # First turn indicator
                ])
            ])
        ]
        
        data = {
            "f.req": json.dumps(request_data),
            "at": self.at_token
        }
        
        # Make POST request
        response = self.session.post(
            "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate",
            params=params,
            data=data,
            timeout=120
        )
        
        return response.text

# Usage
cookies = {
    "__Secure-1PSID": "your_psid_value",
    "__Secure-1PSIDTS": "your_psidts_value",
    "__Secure-1PSIDCC": "your_psidcc_value",
    "NID": "your_nid_value"
}

client = GeminiClient(cookies)
response = client.send_message("Hello, Gemini!")
print(response)
```

---

## Important Parameters Explained

### URL Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `bl` | Build label (changes periodically) | `boq_assistant-bard-web-server_20260525.09_p0` |
| `hl` | Language code | `en`, `es`, `fr` |
| `_reqid` | Random request ID | `123456` |
| `rt` | Request type | `c` |
| `f.sid` | Session ID (optional) | Retrieved from page source |

### Form Data Fields

| Field | Description |
|-------|-------------|
| `f.req` | JSON-encoded request array containing prompt and metadata |
| `at` | XSRF token (SNlM0e) extracted from page source |

### Request Payload Structure (Field 79 - Model Selection)

| Value | Model |
|-------|-------|
| 1 | Gemini Flash |
| 3 | Gemini Pro |
| 6 | Gemini Flash Lite |

---

## Troubleshooting

### Common Issues

1. **400 Bad Request**
   - Verify cookies are valid and not expired
   - Check that `at` token is current
   - Ensure `bl` parameter matches current build

2. **401 Unauthorized**
   - Cookies have expired; re-extract them
   - Try rotating cookies using the RotateCookies endpoint

3. **429 Too Many Requests**
   - Rate limiting; wait before retrying
   - Implement exponential backoff

4. **Invalid XSRF Token**
   - Refresh the Gemini page
   - Re-extract the `at` token from page source

### Cookie Rotation

For long-running sessions, implement automatic cookie rotation:

```python
async def rotate_cookies(session_cookies):
    response = requests.post(
        "https://accounts.google.com/RotateCookies",
        headers={"Content-Type": "application/json"},
        cookies=session_cookies,
        data='[000,"-0000000000000000000"]'
    )
    # Update cookies with new values from response
    return response.cookies
```

---

## Security Considerations

⚠️ **Warning**: 
- Never share your `__Secure-1PSID` cookie publicly
- These cookies provide full access to your Google account
- Store credentials securely (environment variables, encrypted storage)
- This is an unofficial API; use at your own risk
- Google may block automated access or change the API without notice

---

## Alternative: Official Gemini API

For production applications, consider using the **official Gemini API**:

- **Documentation**: [Google AI for Developers](https://ai.google.dev/api/generate-content) [[2]]
- **Authentication**: API key-based (more secure and stable)
- **Endpoint**: `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- **Benefits**: Officially supported, documented, rate-limited fairly [[1]]

To get an API key:
1. Visit [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Generate your API key
3. Use it in the `Authorization` header or as a query parameter [[8]]

---

## References

- Community GitHub repositories for reverse-engineered APIs [[3]][[27]][[28]]
- Network traffic analysis documentation [[15]]
- Official Gemini API documentation [[1]][[2]]
- Python implementation examples [[11]][[13]]

---

**Last Updated**: August 15, 2026  
**Disclaimer**: This document describes unofficial methods for interacting with Gemini's web interface. For production use, always prefer the official Gemini API.