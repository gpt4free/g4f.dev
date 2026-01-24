"""
OpenWeb UI - G4F Context Management Patch
This patch provides conversation context management for g4f integration with OpenWeb UI.
"""

from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field
from datetime import datetime
import json
import logging

# Setup logging
logger = logging.getLogger(__name__)


@dataclass
class Message:
    """Represents a chat message"""
    role: str  # "system", "user", "assistant"
    content: str
    timestamp: datetime = field(default_factory=datetime.now)
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API calls"""
        return {
            "role": self.role,
            "content": self.content
        }


@dataclass
class Conversation:
    """Represents a conversation with context management"""
    id: str
    messages: List[Message] = field(default_factory=list)
    provider: str = "g4f"
    model: str = "auto"
    conversation_id: Optional[str] = None  # For providers that use conversation IDs
    metadata: Dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)
    
    def add_message(self, role: str, content: str, metadata: Optional[Dict[str, Any]] = None) -> Message:
        """
        Add a message to the conversation
        
        Args:
            role: Message role (system, user, assistant)
            content: Message content
            metadata: Optional metadata
            
        Returns:
            The created Message object
        """
        message = Message(
            role=role,
            content=content,
            metadata=metadata or {}
        )
        self.messages.append(message)
        self.updated_at = datetime.now()
        return message
    
    def get_messages_for_api(self, include_system: bool = True) -> List[Dict[str, Any]]:
        """
        Get messages formatted for API calls
        
        Args:
            include_system: Whether to include system messages
            
        Returns:
            List of message dictionaries
        """
        messages = []
        for msg in self.messages:
            if not include_system and msg.role == "system":
                continue
            messages.append(msg.to_dict())
        return messages
    
    def get_context_window(self, max_messages: Optional[int] = None) -> List[Dict[str, Any]]:
        """
        Get a context window of recent messages
        
        Args:
            max_messages: Maximum number of messages to include
            
        Returns:
            List of recent messages
        """
        messages = self.get_messages_for_api()
        if max_messages and len(messages) > max_messages:
            # Keep system message if present, then most recent messages
            system_msgs = [m for m in messages if m["role"] == "system"]
            other_msgs = [m for m in messages if m["role"] != "system"]
            
            if system_msgs:
                return system_msgs + other_msgs[-(max_messages - len(system_msgs)):]
            else:
                return other_msgs[-max_messages:]
        return messages
    
    def clear_history(self, keep_system: bool = True):
        """
        Clear conversation history
        
        Args:
            keep_system: Whether to keep system messages
        """
        if keep_system:
            self.messages = [m for m in self.messages if m.role == "system"]
        else:
            self.messages = []
        self.updated_at = datetime.now()
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for storage/serialization"""
        return {
            "id": self.id,
            "provider": self.provider,
            "model": self.model,
            "conversation_id": self.conversation_id,
            "messages": [
                {
                    "role": m.role,
                    "content": m.content,
                    "timestamp": m.timestamp.isoformat(),
                    "metadata": m.metadata
                }
                for m in self.messages
            ],
            "metadata": self.metadata,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat()
        }


class ContextManager:
    """Manages multiple conversations and their contexts"""
    
    def __init__(self):
        self.conversations: Dict[str, Conversation] = {}
        self.active_conversation_id: Optional[str] = None
    
    def create_conversation(
        self, 
        conversation_id: str,
        provider: str = "g4f",
        model: str = "auto",
        system_message: Optional[str] = None
    ) -> Conversation:
        """
        Create a new conversation
        
        Args:
            conversation_id: Unique conversation ID
            provider: Provider to use
            model: Model to use
            system_message: Optional system message
            
        Returns:
            The created Conversation object
        """
        conversation = Conversation(
            id=conversation_id,
            provider=provider,
            model=model
        )
        
        if system_message:
            conversation.add_message("system", system_message)
        
        self.conversations[conversation_id] = conversation
        self.active_conversation_id = conversation_id
        return conversation
    
    def get_conversation(self, conversation_id: str) -> Optional[Conversation]:
        """Get a conversation by ID"""
        return self.conversations.get(conversation_id)
    
    def get_active_conversation(self) -> Optional[Conversation]:
        """Get the currently active conversation"""
        if self.active_conversation_id:
            return self.conversations.get(self.active_conversation_id)
        return None
    
    def set_active_conversation(self, conversation_id: str) -> bool:
        """
        Set the active conversation
        
        Args:
            conversation_id: Conversation ID to set as active
            
        Returns:
            True if successful, False if conversation not found
        """
        if conversation_id in self.conversations:
            self.active_conversation_id = conversation_id
            return True
        return False
    
    def delete_conversation(self, conversation_id: str) -> bool:
        """
        Delete a conversation
        
        Args:
            conversation_id: Conversation ID to delete
            
        Returns:
            True if deleted, False if not found
        """
        if conversation_id in self.conversations:
            del self.conversations[conversation_id]
            if self.active_conversation_id == conversation_id:
                self.active_conversation_id = None
            return True
        return False
    
    def get_or_create_conversation(
        self,
        conversation_id: str,
        provider: str = "g4f",
        model: str = "auto",
        system_message: Optional[str] = None
    ) -> Conversation:
        """
        Get an existing conversation or create a new one
        
        Args:
            conversation_id: Conversation ID
            provider: Provider to use (for new conversations)
            model: Model to use (for new conversations)
            system_message: System message (for new conversations)
            
        Returns:
            The Conversation object
        """
        conversation = self.get_conversation(conversation_id)
        if conversation is None:
            conversation = self.create_conversation(
                conversation_id, provider, model, system_message
            )
        return conversation
    
    def export_conversation(self, conversation_id: str) -> Optional[str]:
        """
        Export a conversation as JSON
        
        Args:
            conversation_id: Conversation ID to export
            
        Returns:
            JSON string or None if not found
        """
        conversation = self.get_conversation(conversation_id)
        if conversation:
            return json.dumps(conversation.to_dict(), indent=2)
        return None
    
    def import_conversation(self, json_str: str) -> Optional[Conversation]:
        """
        Import a conversation from JSON
        
        Args:
            json_str: JSON string to import
            
        Returns:
            The imported Conversation object or None on error
        """
        try:
            data = json.loads(json_str)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON: {e}")
            return None
        
        try:
            conversation = Conversation(
                id=data["id"],
                provider=data.get("provider", "g4f"),
                model=data.get("model", "auto"),
                conversation_id=data.get("conversation_id"),
                metadata=data.get("metadata", {}),
                created_at=datetime.fromisoformat(data["created_at"]),
                updated_at=datetime.fromisoformat(data["updated_at"])
            )
            
            for msg_data in data["messages"]:
                msg = Message(
                    role=msg_data["role"],
                    content=msg_data["content"],
                    timestamp=datetime.fromisoformat(msg_data["timestamp"]),
                    metadata=msg_data.get("metadata", {})
                )
                conversation.messages.append(msg)
            
            self.conversations[conversation.id] = conversation
            return conversation
        except (KeyError, ValueError) as e:
            logger.error(f"Failed to import conversation: missing or invalid field - {e}")
            return None


# Singleton instance
_context_manager = None

def get_context_manager() -> ContextManager:
    """Get the singleton context manager instance"""
    global _context_manager
    if _context_manager is None:
        _context_manager = ContextManager()
    return _context_manager


# OpenWeb UI Integration Functions
def create_chat_context(
    conversation_id: str,
    provider: str = "g4f",
    model: str = "auto",
    system_prompt: Optional[str] = None
) -> Dict[str, Any]:
    """
    OpenWeb UI compatible function to create a chat context
    
    Args:
        conversation_id: Unique conversation ID
        provider: Provider to use
        model: Model to use
        system_prompt: Optional system prompt
        
    Returns:
        Conversation data dictionary
    """
    manager = get_context_manager()
    conversation = manager.create_conversation(
        conversation_id, provider, model, system_prompt
    )
    return conversation.to_dict()


def add_message_to_context(
    conversation_id: str,
    role: str,
    content: str
) -> Dict[str, Any]:
    """
    OpenWeb UI compatible function to add a message to context
    
    Args:
        conversation_id: Conversation ID
        role: Message role (user, assistant, system)
        content: Message content
        
    Returns:
        Updated conversation data
    """
    manager = get_context_manager()
    conversation = manager.get_or_create_conversation(conversation_id)
    conversation.add_message(role, content)
    return conversation.to_dict()


def get_conversation_context(
    conversation_id: str,
    max_messages: Optional[int] = None
) -> List[Dict[str, Any]]:
    """
    OpenWeb UI compatible function to get conversation context
    
    Args:
        conversation_id: Conversation ID
        max_messages: Maximum number of messages to include
        
    Returns:
        List of messages for API calls
    """
    manager = get_context_manager()
    conversation = manager.get_conversation(conversation_id)
    if conversation:
        return conversation.get_context_window(max_messages)
    return []


def clear_conversation_context(conversation_id: str, keep_system: bool = True):
    """
    OpenWeb UI compatible function to clear conversation history
    
    Args:
        conversation_id: Conversation ID
        keep_system: Whether to keep system messages
    """
    manager = get_context_manager()
    conversation = manager.get_conversation(conversation_id)
    if conversation:
        conversation.clear_history(keep_system)
