"""
OpenWeb UI - G4F Provider & Model Selection Hook
This patch integrates g4f provider and model selection into OpenWeb UI.
"""

import json
from typing import Dict, List, Any, Optional
from pathlib import Path

class G4FProviderHook:
    """Hook for integrating g4f providers into OpenWeb UI"""
    
    def __init__(self, config_path: Optional[str] = None):
        """
        Initialize the provider hook
        
        Args:
            config_path: Path to openwebui-config.json (optional)
        """
        self.config_path = config_path or self._find_config()
        self.config = self._load_config()
        self.providers = self._extract_providers()
        self.models = self._extract_models()
    
    def _find_config(self) -> str:
        """Find the openwebui-config.json file"""
        possible_paths = [
            Path(__file__).parent.parent / "openwebui-config.json",
            Path.home() / ".config" / "openwebui" / "g4f-config.json",
            Path("/etc/openwebui/g4f-config.json"),
        ]
        
        for path in possible_paths:
            if path.exists():
                return str(path)
        
        # Show searched paths in error message
        searched = "\n  - ".join(str(p) for p in possible_paths)
        raise FileNotFoundError(
            f"openwebui-config.json not found. Searched paths:\n  - {searched}"
        )
    
    def _load_config(self) -> Dict[str, Any]:
        """Load the configuration file"""
        with open(self.config_path, 'r') as f:
            return json.load(f)
    
    def _extract_providers(self) -> Dict[str, Dict[str, Any]]:
        """Extract provider configurations"""
        return self.config.get("providerCapabilities", {})
    
    def _extract_models(self) -> List[Dict[str, Any]]:
        """Extract model configurations"""
        return self.config.get("openwebui", {}).get("models", [])
    
    def get_providers(self) -> List[Dict[str, Any]]:
        """
        Get list of available providers for OpenWeb UI
        
        Returns:
            List of provider dictionaries with UI-friendly format
        """
        providers_list = []
        
        for name, config in self.providers.items():
            provider = {
                "id": name,
                "name": config.get("label", name.title()),
                "tags": config.get("tags", []),
                "baseUrl": config.get("baseUrl", ""),
                "models": config.get("models", []),
                "rateLimit": config.get("rateLimit"),
                "capabilities": self._parse_tags(config.get("tags", []))
            }
            providers_list.append(provider)
        
        return providers_list
    
    def get_models(self, provider: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Get list of available models, optionally filtered by provider
        
        Args:
            provider: Optional provider ID to filter models
            
        Returns:
            List of model dictionaries
        """
        if provider:
            # Filter models for specific provider
            return [m for m in self.models if m.get("provider") == provider]
        return self.models
    
    def _parse_tags(self, tags: Any) -> Dict[str, bool]:
        """
        Parse provider tags into capability flags
        
        Args:
            tags: Tags string or list
            
        Returns:
            Dictionary of capability flags
        """
        if isinstance(tags, str):
            tag_str = tags
        elif isinstance(tags, list):
            tag_str = " ".join(tags)
        else:
            tag_str = ""
        
        return {
            "vision": "👓" in tag_str or "Vision" in tag_str,
            "images": "🎨" in tag_str or "Images" in tag_str,
            "audio": "🎧" in tag_str or "Audio" in tag_str,
            "local": "🦙" in tag_str or "Local" in tag_str,
            "performance": "📟" in tag_str or "Performance" in tag_str,
        }
    
    def get_model_info(self, model_id: str) -> Optional[Dict[str, Any]]:
        """
        Get detailed information about a specific model
        
        Args:
            model_id: The model ID
            
        Returns:
            Model information dictionary or None if not found
        """
        for model in self.models:
            if model.get("id") == model_id:
                return model
        return None
    
    def get_provider_for_model(self, model_id: str) -> Optional[str]:
        """
        Get the provider for a given model
        
        Args:
            model_id: The model ID
            
        Returns:
            Provider ID or None if not found
        """
        model = self.get_model_info(model_id)
        return model.get("provider") if model else None
    
    def to_openwebui_format(self) -> Dict[str, Any]:
        """
        Convert g4f configuration to OpenWeb UI native format
        
        Returns:
            Configuration dictionary for OpenWeb UI
        """
        return {
            "models": [
                {
                    "id": model["id"],
                    "name": model["name"],
                    "provider": {
                        "id": model["provider"],
                        "name": model["provider"],
                        "baseUrl": model.get("baseUrl", ""),
                    },
                    "meta": {
                        "description": model.get("description", ""),
                        "capabilities": self._get_model_capabilities(model),
                    }
                }
                for model in self.models
            ],
            "providers": self.get_providers()
        }
    
    def _get_model_capabilities(self, model: Dict[str, Any]) -> List[str]:
        """Get capabilities for a model based on its provider"""
        provider = model.get("provider")
        if not provider or provider not in self.providers:
            return []
        
        caps = self._parse_tags(self.providers[provider].get("tags", []))
        return [k for k, v in caps.items() if v]


# Singleton instance for easy import
_hook_instance = None

def get_provider_hook() -> G4FProviderHook:
    """Get the singleton provider hook instance"""
    global _hook_instance
    if _hook_instance is None:
        _hook_instance = G4FProviderHook()
    return _hook_instance


# OpenWeb UI Integration Functions
def get_models_list() -> List[Dict[str, Any]]:
    """
    OpenWeb UI compatible function to get models list
    This function can be called directly from OpenWeb UI
    """
    hook = get_provider_hook()
    return hook.to_openwebui_format()["models"]


def get_providers_list() -> List[Dict[str, Any]]:
    """
    OpenWeb UI compatible function to get providers list
    This function can be called directly from OpenWeb UI
    """
    hook = get_provider_hook()
    return hook.get_providers()


def get_model_capabilities(model_id: str) -> Dict[str, bool]:
    """
    OpenWeb UI compatible function to get model capabilities
    
    Args:
        model_id: The model ID
        
    Returns:
        Dictionary of capability flags
    """
    hook = get_provider_hook()
    model = hook.get_model_info(model_id)
    if not model:
        return {}
    
    return {
        "vision": "vision" in hook._get_model_capabilities(model),
        "image_generation": "images" in hook._get_model_capabilities(model),
        "audio": "audio" in hook._get_model_capabilities(model),
    }
