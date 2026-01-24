/**
 * OpenWeb UI - G4F Provider & Model Selection UI Component
 * This patch provides UI components for provider and model selection in OpenWeb UI
 */

class G4FProviderSelector {
    constructor(config) {
        this.config = config || {};
        this.providers = [];
        this.models = [];
        this.selectedProvider = null;
        this.selectedModel = null;
        this.onProviderChange = config.onProviderChange || (() => {});
        this.onModelChange = config.onModelChange || (() => {});
        
        this.init();
    }
    
    async init() {
        await this.loadConfiguration();
        this.render();
        this.attachEventListeners();
    }
    
    async loadConfiguration() {
        // Load from openwebui-config.json or API endpoint
        try {
            const response = await fetch('/openwebui-config.json');
            
            if (!response.ok) {
                if (response.status === 404) {
                    console.warn('Configuration file not found at /openwebui-config.json');
                } else {
                    console.error(`Failed to load configuration: HTTP ${response.status}`);
                }
                this.loadDefaultConfiguration();
                return;
            }
            
            const config = await response.json();
            this.providers = this.parseProviders(config.providerCapabilities || {});
            this.models = config.openwebui?.models || [];
        } catch (error) {
            console.error('Failed to load g4f configuration:', error);
            // Fallback to default configuration
            this.loadDefaultConfiguration();
        }
    }
    
    parseProviders(providerCapabilities) {
        return Object.entries(providerCapabilities).map(([id, config]) => ({
            id: id,
            name: config.label || id,
            tags: config.tags || [],
            baseUrl: config.baseUrl || '',
            models: config.models || [],
            rateLimit: config.rateLimit,
            capabilities: this.parseTags(config.tags || [])
        }));
    }
    
    parseTags(tags) {
        const tagStr = Array.isArray(tags) ? tags.join(' ') : tags;
        return {
            vision: tagStr.includes('👓') || tagStr.includes('Vision'),
            images: tagStr.includes('🎨') || tagStr.includes('Images'),
            audio: tagStr.includes('🎧') || tagStr.includes('Audio'),
            local: tagStr.includes('🦙') || tagStr.includes('Local'),
            performance: tagStr.includes('📟') || tagStr.includes('Performance')
        };
    }
    
    loadDefaultConfiguration() {
        // Default g4f configuration
        this.providers = [
            {
                id: 'default',
                name: 'G4F Auto',
                tags: [],
                baseUrl: 'https://g4f.space/api',
                models: ['auto'],
                capabilities: {}
            }
        ];
        
        this.models = [
            {
                id: 'g4f-auto',
                name: 'G4F Auto',
                provider: 'default',
                baseUrl: 'https://g4f.space/api',
                model: 'auto'
            }
        ];
    }
    
    render() {
        const containerId = this.config.containerId || 'g4f-provider-selector';
        const container = document.getElementById(containerId);
        
        if (!container) {
            console.error(`Container #${containerId} not found`);
            return;
        }
        
        container.innerHTML = `
            <div class="g4f-selector-container">
                <div class="g4f-provider-section">
                    <label for="g4f-provider-select" class="g4f-label">
                        Provider
                        <span class="g4f-label-hint">Choose AI provider</span>
                    </label>
                    <select id="g4f-provider-select" class="g4f-select">
                        <option value="">Select Provider</option>
                        ${this.renderProviderOptions()}
                    </select>
                    <div id="g4f-provider-info" class="g4f-info"></div>
                </div>
                
                <div class="g4f-model-section">
                    <label for="g4f-model-select" class="g4f-label">
                        Model
                        <span class="g4f-label-hint">Choose AI model</span>
                    </label>
                    <div class="g4f-model-search-container">
                        <input 
                            type="text" 
                            id="g4f-model-search" 
                            class="g4f-search"
                            placeholder="Search models..."
                        />
                    </div>
                    <select id="g4f-model-select" class="g4f-select">
                        <option value="">Select Model</option>
                        ${this.renderModelOptions()}
                    </select>
                    <div id="g4f-model-info" class="g4f-info"></div>
                </div>
                
                <div class="g4f-capabilities">
                    <div id="g4f-capabilities-badges"></div>
                </div>
            </div>
        `;
        
        this.injectStyles();
    }
    
    renderProviderOptions() {
        return this.providers.map(provider => `
            <option value="${provider.id}" data-tags="${provider.tags}">
                ${provider.name} ${provider.tags.join(' ')}
            </option>
        `).join('');
    }
    
    renderModelOptions(providerId = null) {
        let models = this.models;
        
        if (providerId) {
            models = models.filter(m => m.provider === providerId);
        }
        
        return models.map(model => `
            <option value="${model.id}" data-provider="${model.provider}">
                ${model.name}
            </option>
        `).join('');
    }
    
    attachEventListeners() {
        const providerSelect = document.getElementById('g4f-provider-select');
        const modelSelect = document.getElementById('g4f-model-select');
        const modelSearch = document.getElementById('g4f-model-search');
        
        if (providerSelect) {
            providerSelect.addEventListener('change', (e) => {
                this.handleProviderChange(e.target.value);
            });
        }
        
        if (modelSelect) {
            modelSelect.addEventListener('change', (e) => {
                this.handleModelChange(e.target.value);
            });
        }
        
        if (modelSearch) {
            modelSearch.addEventListener('input', (e) => {
                this.handleModelSearch(e.target.value);
            });
        }
    }
    
    handleProviderChange(providerId) {
        this.selectedProvider = providerId;
        
        const provider = this.providers.find(p => p.id === providerId);
        
        if (provider) {
            this.updateProviderInfo(provider);
            this.updateModelOptions(providerId);
        }
        
        this.onProviderChange(providerId, provider);
    }
    
    handleModelChange(modelId) {
        this.selectedModel = modelId;
        
        const model = this.models.find(m => m.id === modelId);
        
        if (model) {
            this.updateModelInfo(model);
            this.updateCapabilitiesBadges(model);
        }
        
        this.onModelChange(modelId, model);
    }
    
    handleModelSearch(query) {
        const modelSelect = document.getElementById('g4f-model-select');
        const options = modelSelect.querySelectorAll('option');
        
        options.forEach(option => {
            const text = option.textContent.toLowerCase();
            const matches = text.includes(query.toLowerCase());
            option.style.display = matches || option.value === '' ? 'block' : 'none';
        });
    }
    
    updateProviderInfo(provider) {
        const infoDiv = document.getElementById('g4f-provider-info');
        if (!infoDiv) return;
        
        const capabilities = Object.entries(provider.capabilities)
            .filter(([_, enabled]) => enabled)
            .map(([cap, _]) => cap);
        
        infoDiv.innerHTML = `
            <div class="g4f-provider-details">
                ${provider.baseUrl ? `<p><strong>Endpoint:</strong> ${provider.baseUrl}</p>` : ''}
                ${capabilities.length > 0 ? `<p><strong>Capabilities:</strong> ${capabilities.join(', ')}</p>` : ''}
                ${provider.rateLimit ? `<p><strong>Rate Limit:</strong> ${provider.rateLimit}</p>` : ''}
            </div>
        `;
    }
    
    updateModelInfo(model) {
        const infoDiv = document.getElementById('g4f-model-info');
        if (!infoDiv) return;
        
        infoDiv.innerHTML = `
            <div class="g4f-model-details">
                ${model.description ? `<p>${model.description}</p>` : ''}
                ${model.baseUrl ? `<p><strong>Endpoint:</strong> ${model.baseUrl}</p>` : ''}
            </div>
        `;
    }
    
    updateModelOptions(providerId) {
        const modelSelect = document.getElementById('g4f-model-select');
        if (!modelSelect) return;
        
        modelSelect.innerHTML = `
            <option value="">Select Model</option>
            ${this.renderModelOptions(providerId)}
        `;
    }
    
    updateCapabilitiesBadges(model) {
        const badgesDiv = document.getElementById('g4f-capabilities-badges');
        if (!badgesDiv) return;
        
        const provider = this.providers.find(p => p.id === model.provider);
        if (!provider) return;
        
        const badges = Object.entries(provider.capabilities)
            .filter(([_, enabled]) => enabled)
            .map(([cap, _]) => this.getCapabilityBadge(cap))
            .join('');
        
        badgesDiv.innerHTML = badges;
    }
    
    getCapabilityBadge(capability) {
        const badges = {
            vision: '👓 Vision',
            images: '🎨 Images',
            audio: '🎧 Audio',
            local: '🦙 Local',
            performance: '📟 Performance'
        };
        
        const text = badges[capability] || capability;
        
        return `<span class="g4f-capability-badge">${text}</span>`;
    }
    
    injectStyles() {
        if (document.getElementById('g4f-selector-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'g4f-selector-styles';
        style.textContent = `
            .g4f-selector-container {
                display: flex;
                flex-direction: column;
                gap: 1.5rem;
                padding: 1rem;
                background: var(--bg-secondary, #f5f5f5);
                border-radius: 8px;
            }
            
            .g4f-provider-section,
            .g4f-model-section {
                display: flex;
                flex-direction: column;
                gap: 0.5rem;
            }
            
            .g4f-label {
                font-weight: 600;
                font-size: 0.9rem;
                color: var(--text-primary, #333);
                display: flex;
                align-items: center;
                gap: 0.5rem;
            }
            
            .g4f-label-hint {
                font-weight: 400;
                font-size: 0.8rem;
                color: var(--text-secondary, #666);
            }
            
            .g4f-select,
            .g4f-search {
                padding: 0.5rem;
                border: 1px solid var(--border-color, #ddd);
                border-radius: 4px;
                font-size: 0.9rem;
                background: var(--bg-primary, white);
                color: var(--text-primary, #333);
            }
            
            .g4f-select:focus,
            .g4f-search:focus {
                outline: none;
                border-color: var(--accent-color, #8b3dff);
                box-shadow: 0 0 0 2px rgba(139, 61, 255, 0.1);
            }
            
            .g4f-info {
                font-size: 0.85rem;
                color: var(--text-secondary, #666);
                padding: 0.5rem;
                background: var(--bg-tertiary, #fafafa);
                border-radius: 4px;
                min-height: 40px;
            }
            
            .g4f-capabilities {
                display: flex;
                flex-wrap: wrap;
                gap: 0.5rem;
            }
            
            .g4f-capability-badge {
                display: inline-block;
                padding: 0.25rem 0.75rem;
                background: var(--accent-color, #8b3dff);
                color: white;
                border-radius: 12px;
                font-size: 0.8rem;
                font-weight: 500;
            }
            
            @media (max-width: 768px) {
                .g4f-selector-container {
                    padding: 0.75rem;
                }
            }
        `;
        
        document.head.appendChild(style);
    }
    
    // Public API
    getSelectedProvider() {
        return this.selectedProvider;
    }
    
    getSelectedModel() {
        return this.selectedModel;
    }
    
    setProvider(providerId) {
        const providerSelect = document.getElementById('g4f-provider-select');
        if (providerSelect) {
            providerSelect.value = providerId;
            this.handleProviderChange(providerId);
        }
    }
    
    setModel(modelId) {
        const modelSelect = document.getElementById('g4f-model-select');
        if (modelSelect) {
            modelSelect.value = modelId;
            this.handleModelChange(modelId);
        }
    }
}

// Export for use in OpenWeb UI
if (typeof module !== 'undefined' && module.exports) {
    module.exports = G4FProviderSelector;
}
