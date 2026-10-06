/**
 * WebMCP (Web Model Context Protocol) JS SDK & Polyfill
 * Provides browser-native tool registration for AI agents (navigator.modelContext / window.webMCP)
 */
(function (global, factory) {
    if (typeof exports === 'object' && typeof module !== 'undefined') {
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        define(factory);
    } else {
        global = typeof globalThis !== 'undefined' ? globalThis : global || self;
        global.WebMCP = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    class WebMCP {
        constructor() {
            this.tools = new Map();
            this.listeners = new Set();
        }

        /**
         * Register a browser tool for WebMCP
         * @param {Object} tool - Tool definition { name, description, parameters, execute }
         */
        registerTool(tool) {
            if (!tool || !tool.name) {
                throw new Error('WebMCP tool must have a name');
            }
            if (typeof tool.execute !== 'function' && typeof tool.handler !== 'function') {
                throw new Error('WebMCP tool must have an execute function');
            }

            const toolEntry = {
                name: tool.name,
                description: tool.description || '',
                parameters: tool.parameters || tool.inputSchema || {
                    type: 'object',
                    properties: {},
                    required: []
                },
                inputSchema: tool.parameters || tool.inputSchema || {
                    type: 'object',
                    properties: {},
                    required: []
                },
                execute: tool.execute || tool.handler
            };

            this.tools.set(tool.name, toolEntry);
            this._notifyListeners();
            return true;
        }

        /**
         * Unregister a WebMCP tool by name
         * @param {string} name 
         */
        unregisterTool(name) {
            const deleted = this.tools.delete(name);
            if (deleted) {
                this._notifyListeners();
            }
            return deleted;
        }

        /**
         * List all registered WebMCP tools
         * @returns {Array<Object>}
         */
        listTools() {
            const result = [];
            for (const [name, tool] of this.tools.entries()) {
                result.push({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                    inputSchema: tool.inputSchema
                });
            }
            return result;
        }

        /**
         * Get tool details by name
         * @param {string} name 
         */
        getTool(name) {
            const tool = this.tools.get(name);
            if (!tool) return null;
            return {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
                inputSchema: tool.inputSchema
            };
        }

        /**
         * Call a registered WebMCP tool
         * @param {string} name 
         * @param {Object} args 
         * @returns {Promise<Object>} Execution result { success, result/error }
         */
        async callTool(name, args = {}) {
            const tool = this.tools.get(name);
            if (!tool) {
                throw new Error(`WebMCP tool '${name}' not found`);
            }

            try {
                const result = await tool.execute(args);
                return {
                    success: true,
                    result: result
                };
            } catch (err) {
                return {
                    success: false,
                    error: err.message || String(err)
                };
            }
        }

        /**
         * Subscribe to tool registry changes
         * @param {Function} callback 
         * @returns {Function} Unsubscribe function
         */
        onChange(callback) {
            this.listeners.add(callback);
            return () => this.listeners.delete(callback);
        }

        _notifyListeners() {
            const toolList = this.listTools();
            for (const cb of this.listeners) {
                try {
                    cb(toolList);
                } catch (e) {
                    console.error('WebMCP change listener error:', e);
                }
            }
            if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
                window.dispatchEvent(new CustomEvent('webmcp:tools_changed', {
                    detail: toolList
                }));
            }
        }
    }

    // Auto-mount global WebMCP / navigator.modelContext in browser environment
    if (typeof window !== 'undefined') {
        const instance = new WebMCP();
        if (!window.webMCP) {
            window.webMCP = instance;
        }
        if (typeof navigator !== 'undefined' && !navigator.modelContext) {
            navigator.modelContext = window.webMCP;
        }
    }

    return WebMCP;
});

