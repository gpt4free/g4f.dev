# G4F - Backend API Documentation

## Overview

This documentation covers the `backend_api.py` module in the GPT4Free project, which serves as the core backend API handler for the web interface. It provides endpoints for interacting with language models, managing files, handling conversations, and processing media.

## API Endpoints

### Models and Providers

#### Get Available Models
```
GET /backend-api/v2/models
```
Returns a list of all available models with their capabilities (image, vision, audio, video) and compatible providers.

#### Get Provider-Specific Models
```
GET /backend-api/v2/models/<provider>
```
Returns models available for a specific provider.

#### Get Available Providers
```
GET /backend-api/v2/providers
```
Returns a list of all available providers with their capabilities and authentication requirements.

#### Get Version Information
```
GET /backend-api/v2/version
```
Returns current and latest version information.

### Conversation Handling

#### Create Conversation
```
POST /backend-api/v2/conversation
```
Handles conversation requests and streams responses. Supports text, images, and other media.

**Request Body:**
```json
{
    "model": "gpt-3.5-turbo",
    "provider": "OpenAI",
    "messages": [
        {"role": "user", "content": "Hello, how are you?"}
    ],
    "download_media": true
}
```

#### Quick Create
```
GET /backend-api/v2/create
```
Creates a simple conversation with optional web search integration.

**Query Parameters:**
- `model`: Model to use
- `prompt`: User prompt
- `provider`: Provider to use
- `web_search`: Enable web search (true/false or search query)
- `filter_markdown`: Filter markdown in response

#### Log Usage
```
POST /backend-api/v2/usage
```
Logs usage data for analytics.

#### Log Events
```
POST /backend-api/v2/log
```
Logs client-side events.

### File Management

#### Manage File Buckets
```
GET/DELETE /backend-api/v2/files/<bucket_id>
```
Retrieves or deletes file buckets.

#### Upload Files
```
POST /backend-api/v2/files/<bucket_id>
```
Uploads files to a bucket. Supports various file types including documents and media.

#### Get Media Files
```
GET /files/<bucket_id>/media/<filename>
```
Retrieves media files from a bucket.

#### Search Media
```
GET /search/<search>
```
Searches for media files based on search terms.

#### Upload Cookies
```
POST /backend-api/v2/upload_cookies
```
Uploads cookie files for authentication with providers.

### Chat Sharing

#### Get Shared Chat
```
GET /backend-api/v2/chat/<share_id>
```
Retrieves a shared chat by ID.

#### Save/Update Shared Chat
```
POST /backend-api/v2/chat/<share_id>
```
Uploads or updates a shared chat.

### Memory Management

#### Add Memory Items
```
POST /backend-api/v2/memory/<user_id>
```
Adds memory items for a user.

#### Get Memory Items
```
GET /backend-api/v2/memory/<user_id>
```
Retrieves memory items for a user with optional search and filtering.

### Media Handling

#### Serve Images
```
GET /images/<path:name>
GET /media/<path:name>
```
Serves image and media files.

#### Audio Synthesis
```
GET /backend-api/v2/synthesize/<provider>
```
Handles audio synthesis requests for text-to-speech functionality.

## Usage Examples

### Basic Conversation

```javascript
// Example using fetch API
fetch('/backend-api/v2/conversation', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'gpt-3.5-turbo',
    provider: 'OpenAI',
    messages: [
      {role: 'user', content: 'What is artificial intelligence?'}
    ]
  })
})
.then(response => {
  // Handle streaming response
  const reader = response.body.getReader();
  // Process chunks...
})
```

### File Upload

```javascript
// Example using FormData
const formData = new FormData();
formData.append('files', fileObject);

fetch('/backend-api/v2/files/my-bucket', {
  method: 'POST',
  body: formData
})
.then(response => response.json())
.then(data => console.log(data));
```

### Using Web Search

```javascript
fetch('/backend-api/v2/create?model=gpt-3.5-turbo&prompt=Latest news about AI&web_search=true', {
  method: 'GET'
})
.then(response => {
  // Handle streaming response with web search results
})
```

## Response Formats

The API uses a consistent JSON format for responses with a `type` field indicating the kind of response:

- `content`: Text content from the model
- `provider`: Information about the selected provider
- `conversation`: Conversation state
- `preview`: Preview of content
- `error`: Error information
- `auth`: Authentication requirements
- `parameters`: Model parameters
- `finish`: Finish reason
- `usage`: Token usage information
- `reasoning`: Reasoning process
- `suggestions`: Suggested follow-up questions
- `log`: Debug logs

## Notes

- The API supports streaming responses for real-time interaction
- File uploads can be automatically converted to markdown if MarkItDown is available
- Media files are stored in a dedicated directory structure with caching
- Web search functionality enhances responses with real-world information
- The system includes caching mechanisms for improved performance

This documentation provides an overview of the main functionality in the Backend API. For more detailed information, refer to the code or reach out to the development team.

---

[Return to Documentation](README.md)
