## G4F - Inference API Usage Guide

## Table of Contents
   - [Introduction](#introduction)
   - [Running the Inference API](#running-the-interference-api)
   - [From PyPI Package](#from-pypi-package)
   - [From Repository](#from-repository)
   - [Using the Inference API](#using-the-interference-api)
   - [Basic Usage](#basic-usage)
   - [Using the OpenAI Library](#using-the-openai-library)
   - [With Requests Library](#with-requests-library)
   - [Selecting a Provider](#selecting-a-provider)
   - [Key Points](#key-points)
   - [Conclusion](#conclusion)

## Introduction
The G4F Inference API is a powerful tool that allows you to serve other OpenAI integrations using G4F (Gpt4free). It acts as a proxy, translating requests intended for the OpenAI API into requests compatible with G4F providers. This guide will walk you through the process of setting up, running, and using the Inference API effectively.
  

## Running the Inference API
**You can run the Inference API in two ways:** using the PyPI package or from the repository.
  

### From PyPI Package
**To run the Inference API directly from the G4F PyPI package, use the following Python code:**

```python
from g4f.api import run_api

run_api()
```

  
### From Repository
**If you prefer to run the Inference API from the cloned repository, you have two options:**

1. **Using the command line:**
```bash
g4f api
```

2. **Using Python:**
```bash
python -m g4f.api.run
```

**Once running, the API will be accessible at:** `http://localhost:1337/v1`

**(Advanced) Bind to custom port:**
```bash
python -m g4f.cli api --bind "0.0.0.0:2400" 
```

**(Advanced) Custom cookies directory:**
```bash
# override default (~/.config/g4f/cookies/)
python -m g4f.cli api --cookies-dir /path/to/har_and_cookies
```

You can also see a full list of CLI options by running `g4f api --help`.

## Using the Inference API

### Basic Usage
**You can interact with the Inference API using curl commands for both text and image generation:**

**For text generation:**
```bash
curl -X POST "http://localhost:1337/v1/chat/completions" \
     -H "Content-Type: application/json" \
     -d '{
           "messages": [
             {
               "role": "user",
               "content": "Hello"
             }
           ],
           "model": "gpt-4o-mini"
         }'
```

**For image generation:**
1. **url:**
```bash
curl -X POST "http://localhost:1337/v1/images/generate" \
     -H "Content-Type: application/json" \
     -d '{
           "prompt": "a white siamese cat",
           "model": "flux",
           "response_format": "url"
         }'
```

2. **b64_json**
```bash
curl -X POST "http://localhost:1337/v1/images/generate" \
     -H "Content-Type: application/json" \
     -d '{
           "prompt": "a white siamese cat",
           "model": "flux",
           "response_format": "b64_json"
         }'
```

---

### Using the OpenAI Library

**To utilize the Inference API with the OpenAI Python library, you can specify the `base_url` to point to your endpoint:**

```python
from openai import OpenAI

# Initialize the OpenAI client
client = OpenAI(
    api_key="secret",  # Set an API key (use "secret" if your provider doesn't require one)
    base_url="http://localhost:1337/v1"  # Point to your local or custom API endpoint
)

# Create a chat completion request
response = client.chat.completions.create(
    model="gpt-4o-mini",  # Specify the model to use
    messages=[{"role": "user", "content": "Write a poem about a tree"}],  # Define the input message
    stream=True,  # Enable streaming for real-time responses
)

# Handle the response
if isinstance(response, dict):
    # Non-streaming response
    print(response.choices[0].message.content)
else:
    # Streaming response
    for token in response:
        content = token.choices[0].delta.content
        if content is not None:
            print(content, end="", flush=True)
```

**Notes:**
- The `api_key` is required by the OpenAI Python library. If your provider does not require an API key, you can set it to `"secret"`. This value will be ignored by providers in G4F.
- Replace `"http://localhost:1337/v1"` with the appropriate URL for your custom or local interference API.

---
  

### With Requests Library

**You can also send requests directly to the Inference API using the `requests` library:**
```python
import requests

url = "http://localhost:1337/v1/chat/completions"

body = {
    "model": "gpt-4o-mini",
    "stream": False,
    "messages": [
        {"role": "assistant", "content": "What can you do?"}
    ]
}

json_response = requests.post(url, json=body).json().get('choices', [])

for choice in json_response:
    print(choice.get('message', {}).get('content', ''))

```

## Selecting a Provider

**Provider Selection**: [How to Specify a Provider?](selecting_a_provider)

Selecting the right provider is a key step in configuring the G4F Inference API to suit your needs. Refer to the guide linked above for detailed instructions on choosing and specifying a provider.

## Key Points
   - The Inference API translates OpenAI API requests into G4F provider requests.
   - It can be run from either the PyPI package or the cloned repository.
   - The API supports usage with the OpenAI Python library by changing the `base_url`.
   - Direct requests can be sent to the API endpoints using libraries like `requests`.
   - Both text and image generation are supported.

  
## Conclusion
The G4F Inference API provides a seamless way to integrate G4F with existing OpenAI-based applications and tools. By following this guide, you should now be able to set up, run, and use the Inference API effectively. Whether you're using it for text generation, image creation, or as a drop-in replacement for OpenAI in your projects, the Inference API offers flexibility and power for your AI-driven applications.

---

[Return to Documentation](README.md)