# G4F.dev - OpenWeb UI Integration

This repository contains the web interface and documentation for g4f (GPT4Free).

## OpenWeb UI Integration

### Quick Setup

To integrate g4f with Open WebUI, use the automated setup:

```bash
./setup-openwebui.sh
```

Or for HTTP-based MCP server:

```bash
./setup-openwebui.sh --http --port 8765
```

### Configuration Files

- **`openwebui-config.json`** - Complete OpenWeb UI configuration including:
  - Pre-configured g4f models (Gemini, DeepSeek, Groq, etc.)
  - MCP server setup for web search, scraping, and image generation
  - Provider capabilities and rate limits
  - Alternative configurations for HTTP mode and local backends

- **`setup-openwebui.sh`** - Automated setup script that:
  - Installs g4f if needed
  - Creates MCP configuration
  - Starts MCP server (HTTP mode)
  - Provides next steps

### Documentation

Complete integration guide: [docs/openwebui-integration.md](docs/openwebui-integration.md)

Or view online: https://g4f.dev/docs/openwebui-integration.html

### Features

- ✅ **MCP Server Tools**: Web search, web scraping, image generation
- ✅ **Multiple Providers**: Gemini, DeepSeek, Groq, Ollama, OpenRouter, and more
- ✅ **Live & Custom Providers**: Direct access or custom endpoints
- ✅ **Backend URL Support**: Use g4f.space API or local backend
- ✅ **Conversation Context**: Proper message history management

### Quick Example

Add g4f as a model in Open WebUI:

```json
{
  "name": "G4F Auto",
  "baseUrl": "https://g4f.space/api",
  "apiKey": "not-required"
}
```

With MCP server (stdio mode):

```json
{
  "mcpServers": {
    "g4f": {
      "command": "python",
      "args": ["-m", "g4f.mcp"]
    }
  }
}
```

### Support

- Documentation: https://g4f.dev/docs
- Issues: https://github.com/gpt4free/g4f.dev/issues
- GitHub: https://github.com/gpt4free/g4f.dev

## Other Documentation

- [MCP Integration](docs/mcp-integration.md)
- [MCP Usage Guide](docs/mcp-usage-guide.md)
- [Backend API Documentation](docs/backend_api_documentation.md)
- [Chat Conversation Context Guide](docs/review/context.md)
