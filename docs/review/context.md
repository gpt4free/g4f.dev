# Chat Conversation Context Guide

This guide explains how different G4F providers handle conversation context, message formatting, and conversation management.

## Message Format

### Standard Message Structure
```python
messages = [
    {
        "role": "system",    # or "user", "assistant"
        "content": "message content"
    }
]
```

## Provider-Specific Conversation Handling

### 1. Models Using Message History (Most Common)
```python
from g4f.client import AsyncClient

class ConversationManager:
    def __init__(self):
        self.client = AsyncClient()
        self.history = [
            {"role": "system", "content": "You are a helpful assistant."}
        ]
    
    async def chat(self, message):
        self.history.append({"role": "user", "content": message})
        
        response = await self.client.chat.completions.create(
            model="gpt-4o-mini",
            messages=self.history
        )
        
        assistant_response = response.choices[0].message.content
        self.history.append({"role": "assistant", "content": assistant_response})
        return assistant_response
```

### 2. Models Using Conversation Objects (Like OpenaiAccount)
```python
from g4f.client import AsyncClient
from g4f.Provider import OpenaiAccount

class ConversationManager:
    def __init__(self):
        self.client = AsyncClient(provider=OpenaiAccount)
        self.conversation = None
    
    async def chat(self, message):
        if self.conversation:
            response = await self.client.chat.completions.create(
                messages=message,
                conversation=self.conversation
            )
        else:
            response = await self.client.chat.completions.create(
                messages=message
            )
        if response.conversation is not None:
            self.conversation = response.conversation
        
        return response.choices[0].message.content
```

## Usage Examples

### Example 1: Basic Usage
```python
async def main():
    chat = ConversationManager()
    
    # Chat normally
    response1 = await chat.send_message("Hello!")
    print("AI:", response1)
    
    response2 = await chat.send_message("How are you?")
    print("AI:", response2)

asyncio.run(main())
```

## Key Points

1. **Message History Providers**: Most providers use the `messages` parameter with full conversation history
2. **Conversation Object Providers**: Some providers (like OpenaiAccount) use conversation IDs and only need the latest message