# G4F - Providers and Models

## Table of Contents
- [Introduction](#introduction)
- [Understanding Providers](#understanding-providers)
- [Viewing Available Providers](#viewing-available-providers)
  - [Interactive Provider List](#interactive-provider-list)
  - [Via API](#via-api)
  - [Via Python Client](#via-python-client)
  - [Via JavaScript Client](#via-javascript-client)
- [Provider Types](#provider-types)
- [Provider Capabilities](#provider-capabilities)
- [Model Support](#model-support)
- [Selecting Providers](#selecting-providers)
- [Best Practices](#best-practices)

## Introduction

GPT4Free (G4F) provides access to multiple AI providers and their models through a unified interface. This document explains how to discover and use the available providers and models.

## Understanding Providers

Providers are the backends that power G4F's AI capabilities. Each provider:
- Offers different AI models (text, image, audio, video)
- Has unique characteristics (speed, quality, capabilities)
- May require different authentication methods
- Supports different features (vision, streaming, web search)

## Viewing Available Providers

### Interactive Provider List

The easiest way to explore providers and models is through our interactive web interface:

**[View Providers & Models →](https://g4f.dev/docs/providers-and-models.html)**

This page displays:
- **JS Providers**: JavaScript client library providers with integrated functionality
- **Core Providers**: Backend API providers loaded dynamically from the server

Each provider shows:
- 🤗 HuggingFace Space integration
- 🌐 Browser automation support
- 🔑 Authentication required
- 🟢 Currently active/live
- 🎨 Image generation support
- 👓 Vision capabilities
- 🎧 Audio support
- 🎥 Video support

### Via API

You can query available providers programmatically:

#### List All Providers

```bash
curl https://g4f.dev/backend-api/v2/providers
```

Or using the v1 endpoint:

```bash
curl http://localhost:1337/v1/providers
```

Response format:
```json
[
  {
    "id": "OpenaiChat",
    "object": "provider",
    "created": 1234567890,
    "url": "https://chat.openai.com",
    "label": "OpenAI ChatGPT"
  },
  ...
]
```

#### Get Provider Details

```bash
curl http://localhost:1337/v1/providers/OpenaiChat
```

Response format:
```json
{
  "id": "OpenaiChat",
  "object": "provider",
  "created": 1234567890,
  "url": "https://chat.openai.com",
  "label": "OpenAI ChatGPT",
  "models": ["gpt-4", "gpt-4-turbo", "gpt-3.5-turbo"],
  "image_models": ["dall-e-3"],
  "vision_models": ["gpt-4-vision"],
  "params": ["api_key", "temperature", "max_tokens"]
}
```

#### List All Models

```bash
curl http://localhost:1337/v1/models
```

Response format:
```json
[
  {
    "id": "gpt-4",
    "object": "model",
    "created": 1234567890,
    "owned_by": "openai"
  },
  ...
]
```

### Via Python Client

```python
import requests

# List all providers
response = requests.get("http://localhost:1337/v1/providers")
providers = response.json()

for provider in providers:
    print(f"Provider: {provider['label']} ({provider['id']})")
    print(f"URL: {provider['url']}\n")

# Get details for a specific provider
provider_id = "OpenaiChat"
response = requests.get(f"http://localhost:1337/v1/providers/{provider_id}")
details = response.json()

print(f"\nProvider: {details['label']}")
print(f"Supported Models: {', '.join(details['models'])}")
print(f"Image Models: {', '.join(details['image_models'])}")
print(f"Vision Models: {', '.join(details['vision_models'])}")
print(f"Required Parameters: {', '.join(details['params'])}")
```

### Via JavaScript Client

```javascript
// List all providers
async function listProviders() {
    const response = await fetch('http://localhost:1337/v1/providers');
    const providers = await response.json();
    
    providers.forEach(provider => {
        console.log(`Provider: ${provider.label} (${provider.id})`);
        console.log(`URL: ${provider.url}\n`);
    });
}

// Get details for a specific provider
async function getProviderDetails(providerId) {
    const response = await fetch(`http://localhost:1337/v1/providers/${providerId}`);
    const details = await response.json();
    
    console.log(`\nProvider: ${details.label}`);
    console.log(`Supported Models: ${details.models.join(', ')}`);
    console.log(`Image Models: ${details.image_models.join(', ')}`);
    console.log(`Vision Models: ${details.vision_models.join(', ')}`);
    console.log(`Required Parameters: ${details.params.join(', ')}`);
}

await listProviders();
await getProviderDetails('OpenaiChat');
```

## Provider Types

### JS Providers (Client-Side)

These providers work directly in the browser using the JavaScript client:

```javascript
import Client from 'https://g4f.dev/dist/js/client.js';

const client = new Client();
const response = await client.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Hello!' }]
});
```

**Advantages:**
- No backend server required
- Works directly in the browser
- Reduced latency for certain operations
- Easy integration into web apps

### Core Providers (Server-Side)

These providers run on the backend server and are accessed via the API:

```python
from g4f.client import Client
from g4f.Provider import OpenaiChat, Gemini

client = Client(
    provider=OpenaiChat,  # Specify a provider
    image_provider=Gemini  # Different provider for images
)
```

**Advantages:**
- More providers available
- Better performance for complex operations
- API key management on server
- Consistent behavior across clients

## Provider Capabilities

### Text Generation Providers

Most providers support text generation. Common models include:
- `gpt-4`, `gpt-4-turbo`, `gpt-4o`
- `gpt-3.5-turbo`
- `claude-3-opus`, `claude-3-sonnet`
- `gemini-pro`, `gemini-1.5-pro`
- `llama-2`, `llama-3`
- `mistral-large`, `mistral-medium`
- `deepseek-v3`

### Image Generation Providers

Providers with image generation capabilities:
- `dall-e-3` (OpenAI)
- `flux` (Multiple providers)
- `stable-diffusion` (Multiple providers)
- `midjourney` (Selected providers)

### Vision-Enabled Providers

Providers that can analyze images:
- `gpt-4-vision` (OpenAI)
- `claude-3-opus` (Anthropic)
- `gemini-pro-vision` (Google)
- `llava` (Open source)

### Audio Support

Providers with audio capabilities:
- Speech-to-text (transcription)
- Text-to-speech (synthesis)
- Audio understanding

### Video Support

Experimental providers with video generation or analysis capabilities.

## Model Support

### Querying Model Support

To check which models a provider supports:

```python
import requests

provider_id = "OpenaiChat"
response = requests.get(f"http://localhost:1337/v1/providers/{provider_id}")
provider_details = response.json()

print("Text Models:", provider_details.get('models', []))
print("Image Models:", provider_details.get('image_models', []))
print("Vision Models:", provider_details.get('vision_models', []))
```

### Model Aliases

Many models have aliases that point to the same underlying model:
- `gpt-4` → `gpt-4-0613`
- `gpt-3.5-turbo` → `gpt-3.5-turbo-0125`
- `claude-3-opus` → `claude-3-opus-20240229`

Using the base alias (e.g., `gpt-4`) automatically uses the latest version.

## Selecting Providers

### Automatic Provider Selection

By default, G4F automatically selects the best available provider:

```python
from g4f.client import Client

client = Client()  # Automatic provider selection
response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello"}]
)
```

### Explicit Provider Selection

Specify a provider explicitly:

```python
from g4f.client import Client
from g4f.Provider import OpenaiChat

client = Client(provider=OpenaiChat)
response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello"}]
)
```

### Provider via API Parameter

Use the `provider` query parameter:

```bash
curl -X POST http://localhost:1337/v1/chat/completions?provider=OpenaiChat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### Multiple Providers with Retry

Use `RetryProvider` to try multiple providers in sequence:

```python
from g4f.client import Client
from g4f.Provider import RetryProvider, OpenaiChat, Gemini, Claude

client = Client(
    provider=RetryProvider([OpenaiChat, Gemini, Claude], shuffle=False)
)

response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello"}]
)
```

### Provider Selection via String

You can also specify providers using space-separated strings:

```python
response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello"}],
    provider="OpenaiChat Gemini"  # Try these providers in order
)
```

## Best Practices

### 1. Let G4F Choose

For most use cases, let G4F automatically select the best provider:

```python
client = Client()  # No provider specified
```

**Advantages:**
- Automatic failover
- Load balancing
- Always uses available providers

### 2. Use RetryProvider for Reliability

For production applications, use multiple providers:

```python
from g4f.Provider import RetryProvider, Provider1, Provider2, Provider3

client = Client(
    provider=RetryProvider([Provider1, Provider2, Provider3])
)
```

### 3. Choose Providers by Capability

Select providers based on your needs:

```python
# For vision tasks
from g4f.Provider import ProviderWithVision

# For fast responses
from g4f.Provider import FastProvider

# For high-quality output
from g4f.Provider import QualityProvider
```

### 4. Monitor Provider Availability

Providers may occasionally be unavailable. Always implement error handling:

```python
try:
    response = client.chat.completions.create(
        model="gpt-4",
        messages=[{"role": "user", "content": "Hello"}]
    )
except Exception as e:
    print(f"Error: {e}")
    # Implement fallback logic
```

### 5. Check Provider Status

Use the interactive provider page to check current status:
- [https://g4f.dev/docs/providers-and-models.html](https://g4f.dev/docs/providers-and-models.html)

### 6. Consider Rate Limits

Different providers have different rate limits:
- Free providers: May have stricter limits
- API-based providers: Follow API tier limits
- Browser-based providers: May be slower but more available

### 7. Match Model to Provider

Not all providers support all models. Check compatibility:

```python
# Check if provider supports model
response = requests.get(f"http://localhost:1337/v1/providers/{provider_id}")
details = response.json()
if model_name in details['models']:
    print(f"{provider_id} supports {model_name}")
```

## Related Documentation

- [Selecting a Provider](selecting_a_provider.md) - Detailed provider selection guide
- [Client API Guide](client.md) - Python client documentation
- [JavaScript Client](client_js.md) - Browser-based usage
- [API Documentation](/api-docs) - Full API specification
- [Configuration Guide](config.md) - Authentication and settings

---

**Note**: Provider availability and model support may change over time. Always refer to the [live provider page](https://g4f.dev/docs/providers-and-models.html) for the most current information.
