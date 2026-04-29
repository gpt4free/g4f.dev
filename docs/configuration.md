# Configuration

## Quick Start

The easiest way to set things up is to use the included configuration file.

**Step 1: Copy the sample file**

Locate the file called `config_sample.yml` in the project folder and copy it as `config.yml`.

**Step 2: Edit settings**

Open `config.yml` in a text editor and adjust the values to your preference.

## Manual Setup

If you prefer, you can also set everything up using system environment variables.

---

## `config.yml` Settings

| Setting | Description | Example |
|---|---|---|
| `api_key` | Secret key to protect your server | `your-secret-key-here` |
| `model` | Default service to use | `g4f` |
| `provider` | Default provider name | `OpenaiChat` |
| `image_provider` | Where images come from | `None` (uses default) |
| `image_size` | Image dimensions | `256x256` |
| `proxy` | Network proxy address | `http://user:password@ip:port` |
| `timeout` | How long to wait for a response (seconds) | `30` |
| `chat_config` | Path to your conversation settings | `.../chat-config.json` |
| `conversations` | Your saved conversation history | `.../conversations` |
| `cookies_dir` | Folder containing login cookies | `.../har_and_cookies` |
| `confirm` | Ask before running extra tools | `true` |
| `version` | Which settings version this is | `1` |

---

## Environment Variables

| Variable | What it does |
|---|---|
| `G4F_API_KEY` | Your server's secret key |
| `G4F_MODEL` | The default service to use |
| `G4F_PROVIDER` | The default provider |
| `G4F_IMAGE_PROVIDER` | Where to get images |
| `G4F_IMAGE_SIZE` | Image dimensions |
| `G4F_PROXY` | Proxy address |
| `G4F_TIMEOUT` | Timeout in seconds |

---

## Cookie Login

Some providers require you to log in. You can do this by importing your browser's saved cookies.

**Supported browsers:** Chrome, Firefox, Edge, Opera, Brave

1. Open `config.yml`
2. Find the `cookies` section
3. Add the provider name and your cookie file location

**Example:**

```yaml
cookies:
  - provider: bing
    cookies_dir: /home/user/.g4f/har_and_cookies
    cookie_files:
      - /home/user/.g4f/har_and_cookies/bing.json
      - /home/user/.g4f/har_and_cookies/hugging_chat.json
```

For advanced setup (using `.har` files or detailed cookie instructions), see the full setup guide in the project repository.
