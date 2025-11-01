# G4F - Tool Usage Documentation

## Table of Contents
- [Introduction](#introduction)
- [Overview](#overview)
- [Search Tool](#search-tool)
  - [Basic Usage](#basic-usage)
  - [Parameters](#parameters)
  - [Python Example](#python-example)
  - [JavaScript Example](#javascript-example)
- [Custom Tools](#custom-tools)
- [Tool Response Format](#tool-response-format)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Introduction

Tools in GPT4Free enable AI models to perform actions beyond simple text generation. The most common tool is the **search tool**, which allows models to retrieve real-time information from the web during a conversation.

## Overview

Tools are passed to the chat completion API using the `tool_calls` parameter. Each tool call specifies:
- **Type**: The type of tool (currently `"function"`)
- **Function name**: The name of the tool to invoke (e.g., `"search_tool"`)
- **Arguments**: A dictionary of parameters specific to that tool

Unlike the `web_search` parameter which is provider-dependent, tools work with any provider and offer more granular control.

---

## Search Tool

The `search_tool` enables models to perform web searches and incorporate real-time information into their responses.

### Basic Usage

The search tool is invoked by including it in the `tool_calls` array when making a chat completion request.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | - | The search query to execute |
| `max_results` | integer | No | 5 | Maximum number of search results to retrieve |
| `max_words` | integer | No | 2500 | Maximum number of words in the search response |
| `backend` | string | No | "auto" | Search backend to use (`"api"`, `"html"`, `"lite"`, or `"auto"`) |
| `add_text` | boolean | No | true | Whether to include text snippets from search results |
| `timeout` | integer | No | 5 | Maximum time (in seconds) for the search operation |

### Python Example

```python
from g4f.client import Client

client = Client()

# Define the search tool
tool_calls = [
    {
        "function": {
            "arguments": {
                "query": "Latest developments in quantum computing 2024",
                "max_results": 5,
                "max_words": 2500,
                "backend": "auto",
                "add_text": True,
                "timeout": 5
            },
            "name": "search_tool"
        },
        "type": "function"
    }
]

# Make a request with the search tool
response = client.chat.completions.create(
    model="gpt-4",
    messages=[
        {
            "role": "user",
            "content": "What are the latest developments in quantum computing?"
        }
    ],
    tool_calls=tool_calls
)

print(response.choices[0].message.content)
```

### JavaScript Example

```javascript
import Client from 'https://g4f.dev/dist/js/client.js';

const client = new Client();

// Define the search tool
const toolCalls = [
    {
        function: {
            arguments: {
                query: "Latest developments in quantum computing 2024",
                max_results: 5,
                max_words: 2500,
                backend: "auto",
                add_text: true,
                timeout: 5
            },
            name: "search_tool"
        },
        type: "function"
    }
];

// Make a request with the search tool
const response = await client.chat.completions.create({
    model: "gpt-4",
    messages: [
        {
            role: "user",
            content: "What are the latest developments in quantum computing?"
        }
    ],
    tool_calls: toolCalls
});

console.log(response.choices[0].message.content);
```

---

## Custom Tools

While the `search_tool` is currently the primary tool available, the architecture supports custom tools. Future versions may include additional tools such as:

- **Calculator tools**: For mathematical computations
- **Code execution tools**: For running code snippets
- **Data retrieval tools**: For accessing structured data sources
- **Image analysis tools**: For processing images

Check the [API documentation](/api-docs) for the latest available tools.

---

## Tool Response Format

When tools are used, the response format remains consistent with standard chat completions:

```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "gpt-4",
  "provider": "OpenaiChat",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Based on recent information...",
        "tool_calls": []
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 56,
    "completion_tokens": 31,
    "total_tokens": 87
  }
}
```

---

## Best Practices

1. **Use Specific Queries**: Make search queries as specific as possible for better results
   ```python
   # Good
   "query": "Python 3.12 new features release date"
   
   # Less effective
   "query": "Python features"
   ```

2. **Adjust max_results**: Use fewer results for faster responses, more for comprehensive answers
   ```python
   # For quick facts
   "max_results": 3
   
   # For detailed research
   "max_results": 10
   ```

3. **Set Appropriate Timeouts**: Balance between getting results and response time
   ```python
   # For quick responses
   "timeout": 3
   
   # For comprehensive searches
   "timeout": 10
   ```

4. **Choose the Right Backend**:
   - `"auto"`: Let the system choose (recommended)
   - `"api"`: Faster, structured results
   - `"html"`: More comprehensive, slower
   - `"lite"`: Minimal processing, fastest

5. **Combine with System Messages**: Guide the model on how to use search results
   ```python
   messages=[
       {
           "role": "system",
           "content": "Use the search results to provide accurate, up-to-date information. Cite sources when possible."
       },
       {
           "role": "user",
           "content": "What's the latest news about space exploration?"
       }
   ]
   ```

---

## Troubleshooting

### Common Issues

**Issue**: Search returns no results
- **Solution**: Check your query for typos, try broader terms, or increase `timeout`

**Issue**: Response takes too long
- **Solution**: Reduce `max_results`, decrease `max_words`, or lower `timeout`

**Issue**: Tool not being invoked
- **Solution**: Ensure `tool_calls` is properly formatted and the function name is exactly `"search_tool"`

**Issue**: Backend-specific errors
- **Solution**: Try switching `backend` to `"auto"` or a different option

### Example Error Handling

```python
from g4f.client import Client

client = Client()

try:
    tool_calls = [
        {
            "function": {
                "arguments": {
                    "query": "search query",
                    "timeout": 5
                },
                "name": "search_tool"
            },
            "type": "function"
        }
    ]
    
    response = client.chat.completions.create(
        model="gpt-4",
        messages=[{"role": "user", "content": "Search for something"}],
        tool_calls=tool_calls
    )
    
    print(response.choices[0].message.content)
    
except Exception as e:
    print(f"Error using search tool: {e}")
    # Fallback to without tools
    response = client.chat.completions.create(
        model="gpt-4",
        messages=[{"role": "user", "content": "Search for something"}]
    )
```

---

## Advantages Over web_search Parameter

The `tool_calls` approach offers several advantages over the simple `web_search=True` parameter:

1. **Provider Independence**: Works with any provider, not just those that support native web search
2. **Fine-grained Control**: Customize search parameters like timeout, result count, and backend
3. **Consistent Behavior**: Predictable search behavior across all providers
4. **Extensibility**: Architecture supports adding custom tools beyond search
5. **Better Error Handling**: More control over error scenarios and fallback options

---

## Related Documentation

- [Client API Guide](client.md) - Complete Python client documentation
- [Async Client](async_client.md) - Asynchronous client usage
- [JavaScript Client](client_js.md) - Browser-based JavaScript usage
- [API Documentation](/api-docs) - Full API specification
- [Providers & Models](providers-and-models.html) - Available providers and models

---

For more examples and advanced usage, check the [main documentation hub](README.md).
