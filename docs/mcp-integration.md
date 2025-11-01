# MCP Server Integration

This implementation adds support for Model Context Protocol (MCP) servers in the G4F chat interface, allowing the AI assistant to use external tools.

## Features

- **MCP Server Management**: Add, remove, and enable/disable MCP servers
- **Tool Discovery**: Automatically fetch available tools from MCP servers
- **Tool Selection**: Choose which tools to make available to the AI
- **Seamless Integration**: Tools are automatically passed to chat completions
- **Tool Execution**: Execute tool calls and display results in the chat
- **Persistent Configuration**: Server and tool selections are saved in localStorage

## How to Use

### 1. Add an MCP Server

1. Open the chat settings (click the gear icon)
2. Scroll to the "MCP Servers" section
3. Click the "+" button
4. Enter:
   - **Server Name**: A friendly name for the server (e.g., "Local Tools")
   - **Server URL**: The base URL of the MCP server (e.g., `http://localhost:3001`)
5. The server will be added and enabled by default

### 2. Fetch Tools

1. After adding a server, click the refresh icon (🔄) in the "MCP Tools" section
2. Available tools from all enabled servers will be fetched and displayed
3. Tools are grouped by server name

### 3. Select Tools

1. In the "MCP Tools" section, you'll see all available tools
2. Check the boxes next to the tools you want to enable
3. The AI will only be able to use the selected tools

### 4. Use Tools in Chat

Once tools are selected, the AI can automatically use them during conversations:

```
User: What's the weather in New York?
Assistant: [Uses get_weather tool]
🔧 Tool Call: `get_weather`
```json
{
  "location": "New York, NY",
  "unit": "celsius"
}
```
✅ Tool Result: `get_weather`
```json
{
  "location": "New York, NY",
  "temperature": 22,
  "unit": "celsius",
  "conditions": "Partly Cloudy"
}
```

The current weather in New York is 22°C and partly cloudy.
```

## MCP Server Protocol

MCP servers must implement the following endpoints:

### GET /tools

Returns a list of available tools.

**Response:**
```json
{
  "tools": [
    {
      "name": "tool_name",
      "description": "Tool description",
      "inputSchema": {
        "type": "object",
        "properties": {
          "param": {
            "type": "string",
            "description": "Parameter description"
          }
        },
        "required": ["param"]
      }
    }
  ]
}
```

### POST /tools/{toolName}/execute

Executes a tool with the given arguments.

**Request:**
```json
{
  "arguments": {
    "param": "value"
  }
}
```

**Response:**
```json
{
  "content": {
    "result": "Tool execution result"
  }
}
```

## Example MCP Server

A test MCP server is included at `/tmp/test-mcp-server.js` that provides example tools:

- **get_weather**: Get weather for a location
- **calculate**: Perform mathematical calculations
- **search_web**: Search the web (mocked)

To run it:

```bash
node /tmp/test-mcp-server.js
```

Then add it in the chat UI:
- Name: "Test Server"
- URL: "http://localhost:3001"

## Technical Details

### Files Modified

1. **`/dist/js/mcp-client.js`**: Core MCP client implementation
2. **`/chat/index.html`**: Added MCP UI sections
3. **`/dist/js/chat.v1.js`**: Integrated MCP into chat flow
4. **`/dist/css/style.css`**: Styling for MCP UI

### Storage

- **MCP Servers**: Stored in `localStorage` as `mcp_servers`
- **Selected Tools**: Stored in `localStorage` as `mcp_selected_tools`

### API Integration

The implementation uses the existing OpenAI-compatible tools API:

```javascript
{
  model: "gpt-4",
  messages: [...],
  tools: [
    {
      type: "function",
      function: {
        name: "tool_name",
        description: "...",
        parameters: {...}
      }
    }
  ]
}
```

When the AI wants to use a tool, it returns a `tool_calls` field in the response, which is then executed via the MCP server.

## Security Considerations

- **CORS**: MCP servers must allow CORS requests from the chat UI
- **Authentication**: Currently no authentication is implemented - add as needed
- **Validation**: Tool inputs should be validated by the MCP server
- **Sandboxing**: MCP servers should run in isolated environments

## Future Enhancements

- [ ] Authentication/API keys for MCP servers
- [ ] Tool parameter validation and UI
- [ ] Tool usage history and statistics
- [ ] Import/export MCP configurations
- [ ] Server health monitoring
- [ ] Tool result caching
