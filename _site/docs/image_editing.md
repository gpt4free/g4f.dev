## GPT4Free Image Editing Variation Documentation

This guide explains how to use the image editing variation feature in **GPT4Free (g4f.dev)**. It covers generating variations of images using different providers, handling local file uploads, and showcasing example results.

---

## Table of Contents

1. [Overview](#overview)
2. [Providers and Models](#providers-and-models)
3. [Using Local File Uploads](#using-local-file-uploads)
4. [Example Results](#example-results)
5. [Code Examples](#code-examples)
6. [Troubleshooting](#troubleshooting)
7. [Conclusion](#conclusion)

---

## Overview

The `g4f` library allows you to generate variations of an input image based on a textual prompt. You can use either:
- A URL to a remote image
- A local file path
- Uploaded files from your local server

The library supports multiple providers, including those that require local file access.

---

## Providers and Models

| Provider | Input Type | Notes |
|----------|------------|-------|
| **PollinationsAI** | URL | Uses `flux-kontext` model |
| **Together** | URL | Uses `flux-kontext-pro` model |
| **HuggingSpace** | Local file | Uses `flux-kontext-dev` model |
| **Azure** | Local file | Requires authentication |
| **OpenaiAccount** | Local file | Requires authentication |
| **CopilotAccount** | Local file | Requires authentication |

---

## Using Local File Uploads

GPT4Free allows you to upload image files to your local server. These uploaded files can be used with all providers, including those that normally require local files.

### JavaScript Upload Example:
```javascript
async function upload_files(fileInput) {
    const bucket_id = generateUUID();
    
    const formData = new FormData();
    Array.from(fileInput.files).forEach(file => {
        formData.append('files', file);
    });
    
    const response = await fetch(
        `${framework.backendUrl}/backend-api/v2/files/${bucket_id}`, 
        {
            method: 'POST',
            body: formData
        }
    );
    
    const result = await response.json();
    if (result.media) {
        result.media.forEach((part) => {
            part = part.name ? part : {name: part};
            const url = `${framework.backendUrl}/files/${bucket_id}/media/${part.name}`;
            console.log("Uploaded media:", url);
        });
    }
}
```

---

## Example Results

| Original Image |
|----------------|
| <img src="images/strawberry.jpg" alt="Original" height="160"> |

| OpenAI Variant | Together Variant |
|----------------|------------------|
| <img src="images/strawberry_openai.png" alt="OpenAI" height="160"> | <img src="images/strawberry_copilot.png" alt="Together" height="160"> |
| *Prompt: "Change to green"* | *Prompt: "Generate a variant"* |

| Pollinations.AI Variant | Microsoft Copilot Variant |
|-------------------------|------------------------|
| <img src="images/strawberry_pollinations.png" alt="Pollinations.AI" height="160"> | <img src="images/strawberry_together.jpg" alt="Copilot" height="160"> |
| *Prompt: "Remove background"* | *Prompt: "Add nature background"* |

| Azure Variant | HuggingSpace Variant |
|----------------|------------------|
| <img src="images/strawberry_azure.png" alt="Azure" height="160"> | <img src="images/strawberry_hugging_space.webp" alt="HuggingSpace" height="160"> |
 | *Prompt: "Add text 'Hello World'"* | *Prompt: "Change to black & white"* |

---

## Code Examples

### Basic Usage with Local File
```python
import asyncio
from pathlib import Path
from g4f.client import AsyncClient
from g4f.Provider import OpenaiAccount, CopilotAccount

client = AsyncClient()

async def main_with_openai():
    result = await client.images.create_variation(
        image=Path("g4f.dev/docs/images/strawberry.jpg"),
        provider=OpenaiAccount,
        prompt="Change food color to green",
        response_format="url"
    )
    print(result)

async def main_with_copilot():
    result = await client.images.create_variation(
        image=Path("g4f.dev/docs/images/strawberry.jpg"),
        provider=CopilotAccount,
        prompt="Generate a variant of this image",
        response_format="url"
    )
    print(result)

asyncio.run(main_with_openai())
```

### Examples with Azure and HuggingSpace provider
```python
import asyncio
from pathlib import Path
from g4f.client import AsyncClient
from g4f.Provider import HuggingSpace, Azure
from g4f.cookies import read_cookie_files

# Read cookies and environment variables
read_cookie_files()

client = AsyncClient()

async def main_with_hugging_space():
    result = await client.images.create_variation(
        image=Path("g4f.dev/docs/images/strawberry.jpg"),
        provider=HuggingSpace,
        model="flux-kontext-dev",
        prompt="Change color to black and white",
        response_format="url"
    )
    print(result)

async def main_with_azure():
    result = await client.images.create_variation(
        image=Path("g4f.dev/docs/images/strawberry.jpg"),
        provider=Azure,
        model="flux-kontext",
        prompt="Add text 'Hello World' in the center",
        response_format="url"
    )
    print(result)

asyncio.run(main_with_azure())
```

### URL-based Providers
```python
import asyncio
from g4f.client import AsyncClient
from g4f.Provider import PollinationsAI, Together

client = AsyncClient()

async def main_pollinations():
    result = await client.images.create_variation(
        image="https://g4f.dev/docs/images/strawberry.jpg",
        provider=PollinationsAI,
        prompt="Remove background",
        model="kontext",
        response_format="url"
    )
    print(result)

async def main_with_together():
    result = await client.images.create_variation(
        image="https://g4f.dev/docs/images/strawberry.jpg",
        provider=Together,
        model="flux-kontext-pro",
        prompt="Add nature background",
        response_format="url"
    )
    print(result)

asyncio.run(main_with_together())
```

---

## Troubleshooting

- **File Not Found**: Verify file paths exist
- **Authentication Errors**: Check provider credentials
- **Provider Limits**: Some providers have rate limits
- **Model Compatibility**: Not all models support all features

---

## Conclusion

GPT4Free offers flexible image variation generation through multiple providers. Key features include:
- Support for both local and remote images
- Automatic handling of file uploads
- Multiple provider options with different capabilities

[Return to Documentation](README.md)