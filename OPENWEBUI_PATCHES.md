# OpenWeb UI - G4F Integration Patches

This directory contains patches and hooks for integrating g4f with OpenWeb UI.

## Files

### 1. Provider & Model Selection Hook (`openwebui_provider_hook.py`)

Python hook for exposing g4f providers and models to OpenWeb UI backend.

**Features:**
- Loads provider configuration from `openwebui-config.json`
- Exposes providers and models in OpenWeb UI compatible format
- Parses capability tags (🎨 Images, 👓 Vision, 🎧 Audio, 🦙 Local, 📟 Performance)
- Provides model lookup and filtering functions

**Usage:**
```python
from openwebui_provider_hook import get_models_list, get_providers_list

# Get all models
models = get_models_list()

# Get all providers
providers = get_providers_list()

# Get model capabilities
from openwebui_provider_hook import get_model_capabilities
caps = get_model_capabilities("g4f-gemini-flash")
```

### 2. Context Management Patch (`openwebui_context_patch.py`)

Python module for managing conversation context across chat sessions.

**Features:**
- Message-based conversation management
- Support for system, user, and assistant roles
- Context window management with message limits
- Conversation export/import as JSON
- Compatible with both message history and conversation ID patterns

**Usage:**
```python
from openwebui_context_patch import (
    create_chat_context,
    add_message_to_context,
    get_conversation_context
)

# Create a new conversation
create_chat_context(
    conversation_id="conv_123",
    provider="g4f",
    model="g4f-auto",
    system_prompt="You are a helpful assistant."
)

# Add messages
add_message_to_context("conv_123", "user", "Hello!")
add_message_to_context("conv_123", "assistant", "Hi! How can I help?")

# Get context for API call
messages = get_conversation_context("conv_123", max_messages=10)
```

### 3. UI Selector Component (`openwebui_selector_component.js`)

JavaScript UI component for provider and model selection in OpenWeb UI frontend.

**Features:**
- Dynamic provider and model dropdowns
- Real-time model search/filtering
- Capability badges display
- Provider information panel
- Event handlers for selection changes

**Usage:**
```html
<div id="g4f-provider-selector"></div>

<script>
const selector = new G4FProviderSelector({
    containerId: 'g4f-provider-selector',
    onProviderChange: (providerId, provider) => {
        console.log('Provider changed:', provider);
    },
    onModelChange: (modelId, model) => {
        console.log('Model changed:', model);
    }
});
</script>
```

## Installation

### Option 1: Automatic Installation

Use the setup script to automatically configure the patches:

```bash
./setup-openwebui.sh --patches
```

### Option 2: Manual Installation

#### For OpenWeb UI Backend (Python)

1. Copy the Python hooks to OpenWeb UI's backend directory:
```bash
cp openwebui_provider_hook.py /path/to/open-webui/backend/apps/webui/
cp openwebui_context_patch.py /path/to/open-webui/backend/apps/webui/
```

2. Add imports to OpenWeb UI's main application file:
```python
# In backend/apps/webui/main.py or similar
from .openwebui_provider_hook import get_models_list, get_providers_list
from .openwebui_context_patch import (
    create_chat_context,
    add_message_to_context,
    get_conversation_context
)
```

3. Create API endpoints for provider/model listing:
```python
@app.get("/api/g4f/models")
async def get_g4f_models():
    return get_models_list()

@app.get("/api/g4f/providers")
async def get_g4f_providers():
    return get_providers_list()
```

#### For OpenWeb UI Frontend (JavaScript)

1. Copy the UI component to OpenWeb UI's frontend directory:
```bash
cp openwebui_selector_component.js /path/to/open-webui/src/lib/components/g4f/
```

2. Import and use in OpenWeb UI's chat interface:
```javascript
// In src/lib/components/chat/Settings.svelte or similar
import G4FProviderSelector from '$lib/components/g4f/openwebui_selector_component.js';

// Add to component
<div id="g4f-provider-selector"></div>

<script>
  onMount(() => {
    new G4FProviderSelector({
      containerId: 'g4f-provider-selector',
      onProviderChange: handleProviderChange,
      onModelChange: handleModelChange
    });
  });
</script>
```

## Configuration

Ensure `openwebui-config.json` is accessible:

```bash
# Copy config to OpenWeb UI data directory
cp openwebui-config.json ~/.config/openwebui/g4f-config.json

# Or make it accessible via web server
cp openwebui-config.json /path/to/open-webui/backend/static/
```

## Integration Points

### Backend Integration

The patches integrate with OpenWeb UI at these points:

1. **Model Listing** - Hook into model retrieval to add g4f models
2. **Provider Selection** - Add g4f providers to provider list
3. **Context Management** - Manage conversation history for g4f chats
4. **API Routing** - Route requests to appropriate g4f endpoints

### Frontend Integration

The UI component integrates at these points:

1. **Settings Panel** - Add provider/model selector to chat settings
2. **Chat Interface** - Display selected provider/model in chat header
3. **Model Switcher** - Allow switching models mid-conversation
4. **Capability Display** - Show model capabilities as badges

## API Compatibility

All patches maintain compatibility with OpenWeb UI's existing API structure:

- Models follow OpenWeb UI model schema
- Providers follow OpenWeb UI provider schema
- Context management uses standard message format
- UI components use standard DOM events

## Context Management Pattern

The context patch supports two patterns used by different providers:

### Pattern 1: Message History (Most Common)
```python
# Full conversation history sent with each request
messages = [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hello!"},
    {"role": "assistant", "content": "Hi!"},
    {"role": "user", "content": "How are you?"}
]
```

### Pattern 2: Conversation ID (OpenaiAccount)
```python
# Only latest message + conversation ID
{
    "messages": [{"role": "user", "content": "How are you?"}],
    "conversation": "conv_abc123"  # Tracks full history server-side
}
```

Both patterns are supported. See [docs/review/context.md](docs/review/context.md) for details.

## Testing

Test the integration:

```bash
# Test provider hook
python3 -c "from openwebui_provider_hook import get_providers_list; print(get_providers_list())"

# Test context management
python3 -c "from openwebui_context_patch import create_chat_context; print(create_chat_context('test', 'g4f', 'auto'))"

# Test UI component (in browser console)
# const selector = new G4FProviderSelector({containerId: 'test'});
```

## Troubleshooting

### Providers not showing
- Verify `openwebui-config.json` is accessible
- Check browser console for loading errors
- Ensure paths are correct in configuration

### Context not persisting
- Check conversation IDs are consistent
- Verify context manager is singleton
- Review message format matches API requirements

### UI component not rendering
- Ensure container element exists
- Check for JavaScript errors in console
- Verify styles are being injected

## Support

For issues or questions:
- Documentation: https://g4f.dev/docs/openwebui-integration.html
- Issues: https://github.com/gpt4free/g4f.dev/issues
- Context Guide: https://g4f.dev/docs/review/context.html

## License

These patches are part of the g4f.dev project and follow the same license.
