/**
 * MCP (Model Context Protocol) Client
 * Handles communication with MCP servers to fetch and use tools
 */

const MCP_TOOL_CACHE_KEY = 'mcp_tools_cache';
const MCP_REQUEST_TIMEOUT_MS = 20000;

class MCPClient {
    constructor(options = {}) {
        this.servers = this.loadServers();
        this.tools = this.loadToolCache(); // server -> tools mapping
        this.selectedTools = this.loadSelectedTools();
        this.requestTimeoutMs = options.requestTimeoutMs || MCP_REQUEST_TIMEOUT_MS;
        this._fetchToolsPromises = new Map();
        this._fetchAllPromise = null;
    }

    /**
     * Default headers for tool execution
     */
    _getDefaultAcceptHeader() {
        return 'application/json, text/event-stream';
    }

    /**
     * Load cached tool lists so the UI can render immediately on startup.
     * The cache is refreshed from the server in the background.
     */
    loadToolCache() {
        try {
            const stored = localStorage.getItem(MCP_TOOL_CACHE_KEY);
            const entries = stored ? JSON.parse(stored) : [];
            return new Map(Array.isArray(entries) ? entries : []);
        } catch {
            return new Map();
        }
    }

    /**
     * Persist the tool lists so subsequent loads do not have to wait on the
     * network before showing anything.
     */
    saveToolCache() {
        try {
            const entries = [...this.tools].filter(([url]) => !url.startsWith('webmcp://'));
            localStorage.setItem(MCP_TOOL_CACHE_KEY, JSON.stringify(entries));
        } catch {
            // Cache persistence is best-effort (quota/private mode).
        }
    }

    _nextRequestId() {
        return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    /**
     * Parse a single SSE event into a JSON-RPC payload.
     */
    _parseSseEvent(eventText) {
        if (!eventText || !eventText.trim()) return null;

        const dataLines = eventText
            .split(/\r?\n/)
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).replace(/^ /, ''));

        const payload = dataLines.length > 0 ? dataLines.join('\n') : eventText;
        try {
            return JSON.parse(payload);
        } catch {
            return null;
        }
    }

    /**
     * Check whether a payload is the response for the given request id.
     * Servers that omit ids (or return a bare result object) are still
     * accepted once they carry a result/error/tools payload.
     */
    _isResponseFor(payload, expectedId) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return false;
        }
        if (payload.id !== undefined && payload.id !== null) {
            return String(payload.id) === String(expectedId);
        }
        return Object.prototype.hasOwnProperty.call(payload, 'result')
            || Object.prototype.hasOwnProperty.call(payload, 'error')
            || Array.isArray(payload.tools);
    }

    /**
     * Read a JSON-RPC response from an MCP server.
     *
     * SSE streams may stay open after the response has been sent (for
     * server-sent events or long-lived sessions). Reading until the stream
     * closes makes tool loading appear to hang, so return as soon as the
     * matching response event arrives and cancel the remaining stream.
     */
    async _readJsonRpcResponse(response, expectedId) {
        const contentType = response.headers.get('content-type') || '';
        const isEventStream = contentType.includes('text/event-stream');

        if (!isEventStream || !response.body || typeof response.body.getReader !== 'function') {
            return response.json();
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let raw = '';
        let lastPayload = null;

        const handleEvent = (eventText) => {
            const payload = this._parseSseEvent(eventText);
            if (!payload) return null;
            lastPayload = payload;
            return this._isResponseFor(payload, expectedId) ? payload : null;
        };

        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                const text = decoder.decode(value, { stream: true });
                buffer += text;
                raw += text;

                let separator = /\r?\n\r?\n/.exec(buffer);
                while (separator) {
                    const eventText = buffer.slice(0, separator.index);
                    buffer = buffer.slice(separator.index + separator[0].length);

                    const payload = handleEvent(eventText);
                    if (payload) return payload;

                    separator = /\r?\n\r?\n/.exec(buffer);
                }
            }

            buffer += decoder.decode();
            if (buffer.trim()) {
                const payload = handleEvent(buffer);
                if (payload) return payload;
            }

            // Some servers ignore the Accept header and return plain JSON
            // even though the content type claims event-stream.
            const trimmed = raw.trim();
            if (trimmed) {
                try {
                    const payload = JSON.parse(trimmed);
                    lastPayload = payload;
                    if (this._isResponseFor(payload, expectedId)) return payload;
                } catch {
                    // Not plain JSON; fall through to the last parsed event.
                }
            }

            if (lastPayload) return lastPayload;
            throw new Error('Empty response from MCP server');
        } finally {
            // Stop reading immediately instead of waiting for the server to
            // close a long-lived SSE connection.
            try {
                await reader.cancel();
            } catch {
                // Ignore cancellation errors.
            }
        }
    }

    /**
     * Send a JSON-RPC request and return the decoded response payload.
     * The timeout covers both the initial request and reading the response.
     */
    async _requestJsonRpc(serverUrl, method, params, acceptHeader) {
        const id = this._nextRequestId();
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeoutMs = this.requestTimeoutMs;
        const timer = controller
            ? setTimeout(() => controller.abort(), timeoutMs)
            : null;

        try {
            const response = await fetch(serverUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': acceptHeader || this._getDefaultAcceptHeader()
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method,
                    params: params || {},
                    id
                }),
                signal: controller ? controller.signal : undefined
            });

            if (!response.ok) {
                throw new Error(`Request failed: ${response.status}`);
            }

            return await this._readJsonRpcResponse(response, id);
        } catch (error) {
            if (error && error.name === 'AbortError') {
                throw new Error(`Request timed out after ${timeoutMs}ms`);
            }
            throw error;
        } finally {
            if (timer) clearTimeout(timer);
        }
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

        const entry = {
            id: Date.now().toString(),
            name: server.name,
            url: server.url,
            enabled: true
        };
        if (server.auto) {
            entry.auto = true;
        }
        if (server.serverSseAcceptHeader) {
            entry.serverSseAcceptHeader = server.serverSseAcceptHeader;
        }
        this.servers.push(entry);
        this.saveServers();
        
        // Fetch tools from the new server
        this.fetchTools(server.url).catch(() => {
            // The UI reports unreachable servers when its refresh completes.
        });
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
            this.saveToolCache();
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
     * Fetch tools from an MCP server using JSON-RPC.
     * Concurrent requests for the same server share one network call.
     * @param {string} serverUrl - Server URL
     * @returns {Promise<Array>} List of tools
     */
    async fetchTools(serverUrl) {
        const inflight = this._fetchToolsPromises.get(serverUrl);
        if (inflight) return inflight;

        const promise = this._fetchTools(serverUrl)
            .finally(() => {
                this._fetchToolsPromises.delete(serverUrl);
            });
        this._fetchToolsPromises.set(serverUrl, promise);
        return promise;
    }

    async _fetchTools(serverUrl) {
        try {
            const data = await this._requestJsonRpc(
                serverUrl,
                'tools/list',
                {},
                this._getDefaultAcceptHeader()
            );

            if (data && data.error) {
                throw new Error(`JSON-RPC error: ${data.error.message}`);
            }

            const tools = data?.result?.tools || data?.result || data?.tools || [];

            this.tools.set(serverUrl, tools);
            this.saveToolCache();
            return tools;
        } catch (error) {
            console.error(`Error fetching tools from ${serverUrl}:`, error);
            throw error;
        }
    }

    /**
     * Fetch tools from all enabled servers including WebMCP browser tools.
     * Concurrent refreshes share the same in-flight request.
     * @returns {Promise<Map>} Map of server URL to tools
     */
    async fetchAllTools() {
        if (this._fetchAllPromise) return this._fetchAllPromise;

        this._fetchAllPromise = this._fetchAllTools()
            .finally(() => {
                this._fetchAllPromise = null;
            });
        return this._fetchAllPromise;
    }

    async _fetchAllTools() {
        const promises = this.servers
            .filter(s => s.enabled)
            .map(server => 
                this.fetchTools(server.url)
                    .catch(err => {
                        return [];
                    })
            );

        await Promise.all(promises);

        // Fetch WebMCP browser native tools if available
        if (typeof window !== 'undefined') {
            const webMcp = window.webMCP || (navigator && navigator.modelContext);
            if (webMcp && typeof webMcp.listTools === 'function') {
                try {
                    const webTools = webMcp.listTools() || [];
                    this.tools.set('webmcp://browser', webTools);
                } catch (err) {
                    console.warn('Failed to list WebMCP browser tools:', err);
                }
            }
        }

        return this.tools;
    }

    /**
     * Get all available tools from enabled servers and WebMCP
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

        // Add WebMCP browser native tools
        if (typeof window !== 'undefined') {
            const webMcp = window.webMCP || (navigator && navigator.modelContext);
            if (webMcp && typeof webMcp.listTools === 'function') {
                try {
                    const webMcpTools = webMcp.listTools() || [];
                    for (const tool of webMcpTools) {
                        allTools.push({
                            ...tool,
                            serverId: 'webmcp',
                            serverName: 'WebMCP (Browser)',
                            serverUrl: 'webmcp://browser',
                            isWebMCP: true,
                            toolId: `webmcp:${tool.name}`
                        });
                    }
                } catch (e) {
                    console.warn('Error reading WebMCP tools:', e);
                }
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
     * Convert a single MCP content block into plain text.
     * @param {*} block - MCP content block
     * @returns {string}
     */
    _contentBlockToText(block) {
        if (block === null || block === undefined) return '';
        if (typeof block === 'string') return block;
        if (typeof block !== 'object') return String(block);

        if (block.type === 'text') {
            return typeof block.text === 'string'
                ? block.text
                : JSON.stringify(block.text ?? '');
        }
        if (block.type === 'resource') {
            const resource = block.resource || {};
            return typeof resource.text === 'string'
                ? resource.text
                : JSON.stringify(resource);
        }
        if (block.type === 'image') {
            return `[image${block.mimeType ? `: ${block.mimeType}` : ''}]`;
        }
        return JSON.stringify(block);
    }

    /**
     * Convert a tool response into the string expected by OpenAI-style tool
     * messages. MCP servers return ``{content: [...], isError, structuredContent}``
     * while legacy servers return the raw tool payload. Prefer the structured
     * payload so callers keep access to all fields, then fall back to the
     * textual content blocks.
     * @param {*} result - JSON-RPC result payload
     * @returns {string}
     */
    _formatToolResult(result) {
        if (result && typeof result === 'object' && !Array.isArray(result)) {
            if (Object.prototype.hasOwnProperty.call(result, 'structuredContent') &&
                result.structuredContent !== undefined &&
                result.structuredContent !== null) {
                return typeof result.structuredContent === 'string'
                    ? result.structuredContent
                    : JSON.stringify(result.structuredContent);
            }

            if (Array.isArray(result.content)) {
                return result.content
                    .map(block => this._contentBlockToText(block))
                    .filter(text => text !== '')
                    .join('\n');
            }

            if (Object.prototype.hasOwnProperty.call(result, 'content')) {
                return typeof result.content === 'string'
                    ? result.content
                    : JSON.stringify(result.content);
            }
        }

        return typeof result === 'string' ? result : JSON.stringify(result);
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
        let allTools = this.getAllTools();
        let tool = allTools.find(t => t.name === toolName);

        // Tools may not have been fetched yet (e.g. the workspace addon scan
        // runs before refreshMCPTools() finishes). Refresh the tool list once
        // before giving up on the "not found" error.
        if (!tool && typeof this.fetchAllTools === 'function') {
            await this.fetchAllTools();
            allTools = this.getAllTools();
            tool = allTools.find(t => t.name === toolName);
        }

        if (!tool) {
            throw new Error(`Tool ${toolName} not found`);
        }

        // Handle WebMCP browser native tool execution
        if (tool.isWebMCP || tool.serverUrl === 'webmcp://browser') {
            try {
                const webMcp = typeof window !== 'undefined' ? (window.webMCP || (navigator && navigator.modelContext)) : null;
                if (!webMcp || typeof webMcp.callTool !== 'function') {
                    throw new Error('WebMCP runtime not found in browser');
                }
                const execResult = await webMcp.callTool(toolName, args);
                if (!execResult.success) {
                    throw new Error(execResult.error || 'WebMCP execution failed');
                }
                return {
                    tool_call_id: toolCall.id,
                    role: 'tool',
                    name: toolName,
                    content: this._formatToolResult(execResult.result)
                };
            } catch (error) {
                console.error(`Error executing WebMCP tool ${toolName}:`, error);
                return {
                    tool_call_id: toolCall.id,
                    role: 'tool',
                    name: toolName,
                    content: JSON.stringify({ error: error.message })
                };
            }
        }

        try {
            const accept = tool.serverSseAcceptHeader || this._getDefaultAcceptHeader();
            const data = await this._requestJsonRpc(
                tool.serverUrl,
                'tools/call',
                {
                    name: toolName,
                    arguments: args
                },
                accept
            );

            // Handle JSON-RPC response
            if (data && data.error) {
                throw new Error(`JSON-RPC error: ${data.error.message}`);
            }

            const result = data.result;
            return {
                tool_call_id: toolCall.id,
                role: 'tool',
                name: toolName,
                content: this._formatToolResult(result)
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

// Export for use in Node/CommonJS and Browser environments
if (typeof window !== 'undefined') {
    window.MCPClient = MCPClient;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MCPClient;
    module.exports.default = MCPClient;
}
