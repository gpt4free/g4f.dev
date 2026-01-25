# OpenWeb UI - G4F Integration Guide

This guide explains how to integrate the g4f (GPT4Free) service with Open WebUI, enabling you to use g4f's providers, models, and MCP server tools.

## Quick Start

For automated setup, use the provided setup script and configuration:

```bash
# Clone or download the repository
git clone https://github.com/gpt4free/g4f.dev.git
cd g4f.dev

# Run the setup script
./setup-openwebui.sh

# Or for HTTP mode:
./setup-openwebui.sh --http --port 8765
```

The setup script will:
- Install g4f if not already installed
- Create MCP configuration for Open WebUI
- Start the MCP server (if using HTTP mode)
- Provide next steps for configuring Open WebUI

**Configuration files:**
- `openwebui-config.json` - Complete configuration with all providers and models
- `setup-openwebui.sh` - Automated setup script

## Overview

G4F provides multiple integration points with Open WebUI:

1. **MCP Server Integration** - Access to web search, web scraping, and image generation tools
2. **Custom Provider Configuration** - Use g4f as an OpenAI-compatible API endpoint
3. **Live Provider Support** - Direct access to multiple AI providers through g4f
4. **Conversation Context Management** - Proper handling of chat history and context

For detailed conversation context handling, see [Chat Conversation Context Guide](review/context.md).

## Integration Methods

### Method 1: MCP Server Integration (Recommended)

The Model Context Protocol (MCP) server allows Open WebUI to access g4f tools like web search, scraping, and image generation.

#### Setup MCP Server

1. **Start the g4f MCP Server**:

   Using stdio transport (default):
   ```bash
   python3 -m g4f.mcp
   ```

   Or using HTTP transport:
   ```bash
   python3 -m g4f.mcp --http --port 8765 --host 0.0.0.0
   ```

2. **Configure Open WebUI**:

   Add to Open WebUI's MCP configuration file:

   **For stdio mode** (`~/.config/openwebui/mcp-config.json` or similar):
   ```json
   {
     "mcpServers": {
       "g4f": {
         "command": "python3",
         "args": ["-m", "g4f.mcp"],
         "description": "GPT4Free tools for web search, scraping, and image generation"
       }
     }
   }
   ```
   
   **Note:** Use `python3` or `python` depending on your system. The setup script automatically detects the correct command.

   **For HTTP mode**:
   ```json
   {
     "mcpServers": {
       "g4f": {
         "url": "http://localhost:8765/mcp",
         "transport": "http",
         "description": "GPT4Free tools for web search, scraping, and image generation"
       }
     }
   }
   ```

#### Available MCP Tools

Once configured, Open WebUI will have access to these tools:

- **web_search** - Search the web using DuckDuckGo
  ```json
  {
    "query": "latest AI developments",
    "max_results": 5
  }
  ```

- **web_scrape** - Extract and clean text from web pages
  ```json
  {
    "url": "https://example.com/article",
    "max_words": 1000
  }
  ```

- **image_generation** - Generate images from text prompts
  ```json
  {
    "prompt": "A serene mountain landscape at sunset",
    "width": 1024,
    "height": 1024
  }
  ```

For more details, see [MCP Usage Guide](mcp-usage-guide.md).

### Method 2: Custom Provider (OpenAI-Compatible API)

Use g4f as a custom OpenAI-compatible provider in Open WebUI.

#### Backend URL Configuration

1. **Using g4f.space API** (hosted service):

   In Open WebUI settings, add a new custom provider:
   - **Name**: G4F
   - **Base URL**: `https://g4f.space/api`
   - **API Key**: Not required (or use a dummy value)
   - **Model**: `auto` or specific model like `gpt-4o-mini`

2. **Using Local g4f Backend**:

   If running g4f backend locally:
   - **Base URL**: `http://localhost:1337/v1` (adjust port as needed)
   - **API Key**: Not required
   - **Model**: Any supported model

#### Provider Types

G4F supports multiple provider types that can be configured in Open WebUI:

##### Live Providers

Direct access to third-party AI services:

| Provider | Base URL | Tags | Notes |
|----------|----------|------|-------|
| **api.airforce** | `https://api.airforce/v1` | 🎨 👓 | Images, Vision |
| **pollinations** | `https://pollinations.ai` | 🎨 👓 | Images, Vision |
| **gemini** | `https://generativelanguage.googleapis.com/v1beta/openai` | 👓 | Vision |
| **groq** | `https://api.groq.com/openai/v1` | - | Fast inference |
| **nvidia** | `https://integrate.api.nvidia.com/v1` | 📟 | High performance |
| **ollama** | `https://ollama.g4f-dev.workers.dev` | 🦙 | Local models |
| **openrouter** | `https://openrouter.ai/api/v1` | 👓 | Multiple models |
| **deepinfra** | Default | 🎨 👓 | Images, Vision |

##### Custom Provider

Configure any OpenAI-compatible endpoint:

```json
{
  "provider": "custom",
  "baseUrl": "http://your-custom-endpoint/v1",
  "apiKey": "your-api-key",
  "model": "your-model-name"
}
```

##### Backend URL Provider

Use g4f's centralized API gateway:

```json
{
  "provider": "default",
  "baseUrl": "https://g4f.space/api/{model}",
  "backupUrl": "https://g4f.space/api/{model}",
  "model": "auto"
}
```

The `{model}` placeholder is automatically replaced with the selected model.

### Method 3: Direct Model Selection

Open WebUI can directly use g4f models by configuring the provider endpoints.

#### Default Models by Provider

```json
{
  "pollinations": "openai",
  "azure": "model-router3",
  "gemini": "models/gemini-2.5-flash",
  "openrouter": "openai/gpt-oss-120b:free",
  "nvidia": "deepseek-ai/deepseek-v3.2",
  "ollama": "deepseek-v3.2",
  "groq": "openai/gpt-oss-120b",
  "puter": "gpt-5.2-chat-latest"
}
```

## Configuration Examples

### Complete Open WebUI Configuration

Example Open WebUI configuration with g4f integration:

```json
{
  "models": [
    {
      "id": "g4f-auto",
      "name": "G4F Auto",
      "provider": "g4f",
      "baseUrl": "https://g4f.space/api",
      "apiKey": "not-required"
    },
    {
      "id": "g4f-gemini",
      "name": "G4F Gemini 2.5 Flash",
      "provider": "g4f",
      "baseUrl": "https://g4f.space/api/gemini",
      "apiKey": "not-required",
      "model": "models/gemini-2.5-flash"
    }
  ],
  "mcpServers": {
    "g4f": {
      "command": "python3",
      "args": ["-m", "g4f.mcp"],
      "description": "GPT4Free MCP server with web search, scraping, and image generation"
    }
  }
}
```

### Environment Variables

If needed, configure these environment variables for Open WebUI:

```bash
# For custom g4f backend
export OPENAI_API_BASE_URL=https://g4f.space/api
export OPENAI_API_KEY=not-required

# For MCP server
export G4F_MCP_PORT=8765
```

## API Endpoints

When using g4f as a backend, the following endpoints are available:

### Models and Providers

- `GET /backend-api/v2/models` - List all available models
- `GET /backend-api/v2/models/<provider>` - List models for specific provider
- `GET /backend-api/v2/providers` - List all providers

### Conversation

- `POST /backend-api/v2/conversation` - Create/continue conversation
- `GET /backend-api/v2/create` - Quick conversation creation

For complete API documentation, see [Backend API Documentation](backend_api_documentation.md).

## Conversation Context Management

G4F handles conversation context in two ways:

### 1. Message History (Most Providers)

Most providers use the standard OpenAI message format:

```python
messages = [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hello!"},
    {"role": "assistant", "content": "Hi! How can I help you?"},
    {"role": "user", "content": "What's the weather?"}
]
```

Open WebUI automatically manages this history.

### 2. Conversation Objects (OpenaiAccount)

Some providers use conversation IDs:

```python
{
    "messages": [{"role": "user", "content": "Hello"}],
    "conversation": "conv_abc123"  # Returned from previous response
}
```

For detailed examples, see [Chat Conversation Context Guide](review/context.md).

## Features

### Supported Capabilities

- ✅ Text generation
- ✅ Streaming responses
- ✅ Multi-turn conversations
- ✅ System prompts
- ✅ Vision models (👓 tagged providers)
- ✅ Image generation (🎨 tagged providers)
- ✅ Audio models (🎧 tagged providers)
- ✅ Web search via MCP
- ✅ Web scraping via MCP
- ✅ Tool calling

### Rate Limiting

Some providers have rate limiting configured (via `sleep` parameter):

- `api.airforce`: 60 seconds
- `master`: 10 seconds
- `audio`, `azure`, `ollama`: 10 seconds

## Troubleshooting

### MCP Server Not Connecting

1. Verify the MCP server is running:
   ```bash
   python3 -m g4f.mcp --http --port 8765
   curl -X POST http://localhost:8765/mcp \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
   ```

2. Check Open WebUI MCP configuration path
3. Ensure CORS is enabled if using HTTP mode

### API Connection Issues

1. Verify the base URL is correct
2. Check if the provider is rate-limited (check console logs)
3. Try the backup URL if available
4. Test with curl:
   ```bash
   curl -X POST https://g4f.space/api/chat/completions \
     -H "Content-Type: application/json" \
     -d '{"model":"auto","messages":[{"role":"user","content":"Hello"}]}'
   ```

### Models Not Appearing

1. Check provider configuration in Open WebUI
2. Verify API endpoint is accessible
3. Review Open WebUI logs for errors

## Security Considerations

- **API Keys**: Most g4f providers don't require API keys, but some do (check `providerLocalStorage` in providers.json)
- **CORS**: Required for browser-based MCP clients
- **Rate Limiting**: Respect provider rate limits to avoid blocks
- **Local vs Hosted**: Consider privacy when choosing between local and hosted options

## Advanced Configuration

### Custom Provider with API Key

```json
{
  "id": "g4f-openrouter",
  "name": "G4F via OpenRouter",
  "provider": "g4f",
  "baseUrl": "https://openrouter.ai/api/v1",
  "apiKey": "your-openrouter-api-key",
  "model": "openai/gpt-oss-120b:free"
}
```

### Multiple Provider Fallback

Configure multiple providers with fallback:

```json
{
  "providers": [
    {
      "baseUrl": "https://g4f.space/api/gemini",
      "model": "models/gemini-2.5-flash",
      "priority": 1
    },
    {
      "baseUrl": "https://g4f.space/api/groq",
      "model": "openai/gpt-oss-120b",
      "priority": 2
    }
  ]
}
```

## Related Documentation

- [MCP Integration](mcp-integration.md) - Detailed MCP implementation
- [MCP Usage Guide](mcp-usage-guide.md) - How to use MCP server
- [Chat Conversation Context Guide](review/context.md) - Context handling
- [Backend API Documentation](backend_api_documentation.md) - API reference
- [Client JavaScript](client_js.md) - Browser client usage

## Examples

### Complete Open WebUI Setup Script

```bash
#!/bin/bash
# Setup g4f integration with Open WebUI

# 1. Install g4f (if not already installed)
python3 -m pip install g4f

# 2. Start MCP server in background
nohup python3 -m g4f.mcp --http --port 8765 > mcp.log 2>&1 &

# 3. Create Open WebUI config directory
mkdir -p ~/.config/openwebui

# 4. Write MCP configuration
cat > ~/.config/openwebui/mcp-config.json << EOF
{
  "mcpServers": {
    "g4f": {
      "url": "http://localhost:8765/mcp",
      "transport": "http",
      "description": "GPT4Free MCP server"
    }
  }
}
EOF

# 5. Start Open WebUI with g4f provider
docker run -d -p 3000:8080 \
  -e OPENAI_API_BASE_URL=https://g4f.space/api \
  -e OPENAI_API_KEY=not-required \
  -v ~/.config/openwebui:/app/backend/data \
  --name open-webui \
  ghcr.io/open-webui/open-webui:main

echo "Setup complete! Open WebUI available at http://localhost:3000"
echo "MCP server running on http://localhost:8765"
```

### Testing the Integration

```bash
# Test MCP server
curl -X POST http://localhost:8765/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "web_search",
      "arguments": {
        "query": "latest AI news",
        "max_results": 3
      }
    }
  }'

# Test API endpoint
curl -X POST https://g4f.space/api/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ],
    "stream": false
  }'
```

## Support

For issues and questions:

- GitHub Issues: [gpt4free/g4f.dev](https://github.com/gpt4free/g4f.dev/issues)
- Documentation: [g4f.dev/docs](https://g4f.dev/docs)
- MCP Protocol: [modelcontextprotocol.io](https://modelcontextprotocol.io)
