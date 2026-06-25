/**
 * MCP (Model Context Protocol) Client
 * Handles communication with MCP servers to fetch and use tools
 */

class MCPClient {
    constructor() {
        this.servers = this.loadServers();
        this.tools = new Map(); // server -> tools mapping
        this.selectedTools = this.loadSelectedTools();
    }

    /**
     * Default headers for tool execution
     */
    _getDefaultAcceptHeader() {
        return 'application/json, text/event-stream';
    }

    /**
     * SSE/stream fetch helper.
     * Uses a different Accept header when communicating with servers that stream
     * (e.g. text/event-stream). If the server does not actually stream, it will
     * likely still return JSON.
     */
    async _fetchWithAccept(serverUrl, jsonRpcBody, acceptHeader) {
        const response = await fetch(serverUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': acceptHeader
            },
            body: JSON.stringify(jsonRpcBody)
        });

        if (!response.ok) {
            throw new Error(`Request failed: ${response.status}`);
        }

        return response;
    }

    /**
     * Load MCP servers from localStorage
     */
    loadServers() {
        const stored = localStorage.getItem('mcp_servers');
        return stored ? JSON.parse(stored) : [];
    }

    /**
     * Save MCP servers to localStorage
     */
    saveServers() {
        localStorage.setItem('mcp_servers', JSON.stringify(this.servers));
    }

    /**
     * Load selected tools from localStorage
     */
    loadSelectedTools() {
        const stored = localStorage.getItem('mcp_selected_tools');
        return stored ? JSON.parse(stored) : [];
    }

    /**
     * Save selected tools to localStorage
     */
    saveSelectedTools() {
        localStorage.setItem('mcp_selected_tools', JSON.stringify(this.selectedTools));
    }

    /**
     * Add an MCP server
     * @param {Object} server - Server configuration { name, url }
     */
    addServer(server) {
        if (!server.name || !server.url) {
            throw new Error('Server must have name and url');
        }

        server.url = (new URL('/mcp', server.url)).toString();
        
        // Check if server already exists
        const exists = this.servers.some(s => s.url === server.url);
        if (exists) {
            throw new Error('Server with this URL already exists');
        }

        this.servers.push({
            id: Date.now().toString(),
            name: server.name,
            url: server.url,
            enabled: true
        });
        this.saveServers();
        
        // Fetch tools from the new server
        this.fetchTools(server.url);
    }

    /**
     * Remove an MCP server
     * @param {string} serverId - Server ID to remove
     */
    removeServer(serverId) {
        // Find the server before removing it
        const server = this.servers.find(s => s.id === serverId);
        
        // Remove server from list
        this.servers = this.servers.filter(s => s.id !== serverId);
        this.saveServers();
        
        // Remove tools from this server
        if (server) {
            this.tools.delete(server.url);
        }
        
        // Remove selected tools from this server
        this.selectedTools = this.selectedTools.filter(toolId => {
            return !toolId.startsWith(`${serverId}:`);
        });
        this.saveSelectedTools();
    }

    /**
     * Toggle server enabled state
     * @param {string} serverId - Server ID
     */
    toggleServer(serverId) {
        const server = this.servers.find(s => s.id === serverId);
        if (server) {
            server.enabled = !server.enabled;
            this.saveServers();
        }
    }

    /**
     * Fetch tools from an MCP server using JSON-RPC
     * @param {string} serverUrl - Server URL
     * @returns {Promise<Array>} List of tools
     */
    async fetchTools(serverUrl) {
        try {
            // JSON-RPC request to list tools
            const response = await fetch(serverUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'tools/list',
                    params: {},
                    id: Date.now()
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch tools: ${response.status}`);
            }

            const data = await response.json();
            
            // Handle JSON-RPC response
            if (data.error) {
                throw new Error(`JSON-RPC error: ${data.error.message}`);
            }
            
            const tools = data.result?.tools || data.result || [];
            
            this.tools.set(serverUrl, tools);
            return tools;
        } catch (error) {
            console.error(`Error fetching tools from ${serverUrl}:`, error);
            throw error;
        }
    }

    /**
     * Fetch tools from all enabled servers
     * @returns {Promise<Map>} Map of server URL to tools
     */
    async fetchAllTools() {
        const promises = this.servers
            .filter(s => s.enabled)
            .map(server => 
                this.fetchTools(server.url)
                    .catch(err => {
                        console.error(`Failed to fetch tools from ${server.name}:`, err);
                        return [];
                    })
            );

        await Promise.all(promises);
        return this.tools;
    }

    /**
     * Get all available tools from enabled servers
     * @returns {Array} List of all tools with server info
     */
    getAllTools() {
        const allTools = [];
        
        for (const server of this.servers.filter(s => s.enabled)) {
            const serverTools = this.tools.get(server.url) || [];
            for (const tool of serverTools) {
                allTools.push({
                    ...tool,
                    serverId: server.id,
                    serverName: server.name,
                    serverUrl: server.url,
                    // Optional per-server Accept header for streaming tool execution.
                    // If absent, we fall back to application/json.
                    serverSseAcceptHeader: server.serverSseAcceptHeader,
                    toolId: `${server.id}:${tool.name}`
                });
            }
        }
        
        return allTools;
    }

    /**
     * Get selected tools for chat completion
     * @returns {Array} OpenAI-compatible tools array
     */
    getSelectedToolsForAPI() {
        const allTools = this.getAllTools();
        
        return allTools
            .filter(tool => this.selectedTools.includes(tool.toolId))
            .map(tool => ({
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description || '',
                    parameters: tool.inputSchema || tool.parameters || {
                        type: 'object',
                        properties: {},
                        required: []
                    }
                }
            }));
    }

    /**
     * Toggle tool selection
     * @param {string} toolId - Tool ID (serverId:toolName)
     */
    toggleToolSelection(toolId) {
        const index = this.selectedTools.indexOf(toolId);
        if (index > -1) {
            this.selectedTools.splice(index, 1);
        } else {
            this.selectedTools.push(toolId);
        }
        this.saveSelectedTools();
    }

    /**
     * Check if a tool is selected
     * @param {string} toolId - Tool ID
     * @returns {boolean}
     */
    isToolSelected(toolId) {
        return this.selectedTools.includes(toolId);
    }

    /**
     * Execute a tool call via MCP server
     * @param {Object} toolCall - Tool call from assistant
     * @returns {Promise<Object>} Tool execution result
     */
    async executeToolCall(toolCall) {
        const toolName = toolCall.function.name;
        const args = typeof toolCall.function.arguments === 'string' ? JSON.parse(toolCall.function.arguments) : toolCall.function.arguments;
        
        // Find which server has this tool
        const allTools = this.getAllTools();
        const tool = allTools.find(t => t.name === toolName);
        
        if (!tool) {
            throw new Error(`Tool ${toolName} not found`);
        }

        try {
            // JSON-RPC request to execute tool
            const accept = tool.serverSseAcceptHeader || this._getDefaultAcceptHeader();
            const response = await this._fetchWithAccept(
                tool.serverUrl,
                {
                    jsonrpc: '2.0',
                    method: 'tools/call',
                    params: {
                        name: toolName,
                        arguments: args
                    },
                    id: Date.now()
                },
                accept
            );

            const contentType = response.headers.get('content-type') || '';
            const isEventStream = contentType.includes('text/event-stream') || accept.includes('text/event-stream');

            // If server returns SSE, collect the full stream into a single string.
            // (If you want true incremental streaming into the UI, we need to
            // wire the consumer to read from response.body.)
            let data;
            if (isEventStream && response.body) {
                const reader = response.body.getReader();
                let chunks = '';
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    chunks += new TextDecoder().decode(value, { stream: true });
                }
                // Try to parse as JSON-RPC if possible, otherwise keep raw SSE.
                try {
                    data = JSON.parse(chunks);
                } catch {
                    data = { result: { content: chunks } };
                }
            } else {
                data = await response.json();
            }
            
            // Handle JSON-RPC response
            if (data.error) {
                throw new Error(`JSON-RPC error: ${data.error.message}`);
            }
            
            const result = data.result;
            return {
                tool_call_id: toolCall.id,
                role: 'tool',
                name: toolName,
                content: JSON.stringify(result.content || result)
            };
        } catch (error) {
            console.error(`Error executing tool ${toolName}:`, error);
            return {
                tool_call_id: toolCall.id,
                role: 'tool',
                name: toolName,
                content: JSON.stringify({ error: error.message })
            };
        }
    }

    /**
     * Execute multiple tool calls
     * @param {Array} toolCalls - Array of tool calls
     * @returns {Promise<Array>} Array of tool results
     */
    async executeToolCalls(toolCalls) {
        const promises = toolCalls.map(tc => this.executeToolCall(tc));
        return Promise.all(promises);
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MCPClient;
}
