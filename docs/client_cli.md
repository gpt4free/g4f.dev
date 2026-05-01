# G4F CLI Client

A command-line interface for interacting with various AI providers and models, supporting text and image generation with conversation history.

## Installation

```bash
pip install g4f[all]
```

Call it in your terminal:

```bash
g4f client "Explain generative AI"
```

Or with:

```bash
python -m g4f.cli.client "Explain quantum computing"
```

## Usage

```text
usage: g4f [-h] [--debug] [-p PROVIDER] [-m MODEL] [-O [FILE]] [-i INSTRUCTIONS] [-c COOKIES_DIR]
           [--conversation-file CONVERSATION_FILE] [-C]
           [input ...]
```

### Basic Examples

1. **Text generation**:
   ```bash
   g4f client "Explain quantum computing in simple terms"
   ```

2. **Image description**:
   ```bash
   g4f client image.jpg "Describe this image"
   ```

3. **Image generation** (with supported models):
   ```bash
   g4f client -m flux -O output.jpg "A futuristic cityscape"
   ```

4. **Continue conversation**:
   ```bash
   g4f client "Now explain it like I'm five"
   ```

### Options

| Option | Description |
|--------|-------------|
| `-h`, `--help` | Show help message |
| `--debug`, `-d` | Enable verbose logging |
| `-p PROVIDER`, `--provider PROVIDER` | Specify provider (e.g., `OpenaiChat`, `Gemini`, `Grok`) |
| `-m MODEL`, `--model MODEL` | Specify model (provider-specific) |
| `-O [FILE]`, `--output [FILE]` | Save response to file (for text or image generation) |
| `-i INSTRUCTIONS`, `--instructions INSTRUCTIONS` | Add custom system instructions |
| `-c COOKIES_DIR`, `--cookies-dir COOKIES_DIR` | Directory for authenticated providers |
| `--conversation-file FILE` | Custom conversation state file |
| `-C`, `--clear-history` | Clear conversation history before starting |

### Features

- **Multi-modal support**: Process both text and images
- **Conversation history**: Maintains context between queries
- **Multiple providers**: Supports 50+ AI providers
- **Image generation**: With supported models (e.g., `flux`)
- **Persistent settings**: Saves selected model in conversation file

### Advanced Usage

1. **Custom provider with instructions**:
   ```bash
   g4f client -p PollinationsAI -i "You are a helpful science tutor" "Explain photosynthesis"
   ```

2. **Debug mode**:
   ```bash
   g4f client --debug "What's the weather today?"
   ```

3. **Clear history and start fresh**:
   ```bash
   g4f client -C "New conversation"
   ```

4. **Save response to file**:
   ```bash
   g4f client -O generator.js "Write a poem generator in js"
   ```

## Configuration

- Default conversation file: `~/.config/g4f/conversation.json`
- Default cookies directory: `~/.config/g4f/cookies/`

## Supported Providers

The CLI supports numerous providers including:
- Anthropic, BingCreateImages, Blackbox, Copilot, DeepSeek, Gemini, Grok, HuggingChat, MetaAI, OpenaiChat, PerplexityLabs, and many more.

Run `g4f --help` to see the complete list.

## Notes

- For image generation, ensure you select a model that supports it (e.g., `flux`)
- Some providers may require authentication via cookies
- The selected model is automatically saved in the conversation file