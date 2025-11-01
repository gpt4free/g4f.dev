## GPT4Free Documentation Hub
<img src="https://image.pollinations.ai/prompt/Create%2Ba%2BBanner%2Bwith%2Bthe%2Bbird%2Band%2Bthe%2Btext%2B%22GPT4Free%22?width=480&height=832&model=kontext&nologo=true&private=false&enhance=false&safe=false&referrer=https%3A//g4f.dev/&image=https%3A//host.g4f.dev/files/fa019e9d-67ab-471c-b0c1-4fe189f157cd/media/1000040005.jpg&seed=2377457896" height="300"/>

Welcome to the official docs for **GPT4Free** – free and convenient AI endpoints you can use directly in your apps, scripts, and even right in your browser.

Here you’ll find a clear overview, quick examples, and entry points to deeper docs for every major feature.

---

## Installation & Setup

For full install guides—choose your method:

- [Git Install](git.md)
- [Docker](docker.md)
- [Requirements](requirements.md)

For rapid starts, you can use either **Python** or **JavaScript** (web).

---

## Getting Started

### 📝 Text Generation

Python example for chat completion (with and without web search):

```python
from g4f.client import Client

client = Client()
response = client.chat.completions.create(
    model="gpt-4.1",  # Try "gpt-4o", "deepseek-v3", etc.
    messages=[{"role": "user", "content": "Hello"}],
    web_search=False
)
print(response.choices[0].message.content)
```
**Output:**
```
Hello! How can I assist you today?
```

---

### 🎨  Image Generation

Generate images with a single call (returns URLs or base64):

```python
from g4f.client import Client

client = Client()
response = client.images.generate(
    model="flux",  # Other models: 'dalle-3', 'gpt-image', etc.
    prompt="a white siamese cat",
    response_format="url"
)
print(f"Generated image URL: {response.data[0].url}")
```

[More Python client info →](client.md)

[and Async client →](async_client.md)

---

### 🧙‍♂️ Using GPT4Free.js

Use the **official JS client** right in the browser—no backend needed.

For text generation:
```html
<script type="module">
    import Client from 'https://g4f.dev/dist/js/client.js';

    const client = new Client();
    const result = await client.chat.completions.create({
        model: 'gpt-4.1',  // Or "gpt-4o", "deepseek-v3"
        messages: [{ role: 'user', content: 'Explain quantum computing' }]
    });
    console.log(result.choices[0].message.content);
</script>
```

And for image generation:
```html
<script type="module">
    import Client from 'https://g4f.dev/dist/js/client.js';

    const client = new Client();
    const response = await client.images.generate({
        model: "flux", // Or "dalle-3", "gpt-image"
        prompt: "a white siamese cat"
    });
    const imageUrl = response.data[0].url;
    console.log(`Generated Image URL: ${imageUrl}`);
    // Example: document.body.innerHTML += `<img src="${imageUrl}" />`;
</script>
```

[See more JS client usage →](client_js.md)

### 💻 Using CLI Client

Examples

1. **Text generation**:
   ```bash
   g4f client "Explain quantum computing in simple terms"
   ```

2. **Image description**:
   ```bash
   g4f client image.jpg "Describe this image"
   ```

3. **Image generation** (with supported models):
   ```bash
   g4f client -m flux -O output.jpg "A futuristic cityscape"
   ```

[CLI Client documentation →](client_cli.md)

---

## Deep Dives

- [API endpoints and usage](ready_to_use.md) ***new**
- [Tool Usage Documentation](tools.md) - Search tools and custom tools
- [Available Providers & Models](providers-and-models.md) - Complete provider and model reference
- [Interactive Providers & Models](https://g4f.dev/docs/providers-and-models.html) - Live provider status
- [Selecting a Provider](selecting_a_provider.md)
- [API docs (full spec)](/api-docs)
- [File API Documentation (Files and Documents)](file.md)
- [Media Documentation (Audio, Image and Video)](media.md)
- [Vision Support (Image Upload)](vision.md)
- [Image Editing & Variation](image_editing.md)
- [Authentication, Configuration Guide (.har and cookies)](config.md)
- [Advanced: Create your own Provider](guides/create_provider.md)
- [Integrations: LangChain, PydanticAI](pydantic_ai.md)
- [GUI/WebUI](gui.md), [Phone](guides/phone.md), [Backend API](backend_api_documentation.md)
- [Troubleshooting](https://github.com/gpt4free/g4f.dev/issues)

---

## Community & Links

- **Open Source:** [GitHub: gpt4free/g4f.dev](https://github.com/gpt4free/g4f.dev)
- **Contribute & Report Bugs:** PRs & issues are welcome!
- **Project Website:** [https://g4f.dev/](https://g4f.dev/)
- **Pollinations AI:**  
  <img src="https://image.pollinations.ai/prompt/Create+a+logo+for+Pollinations+AI+featuring+an+abstract+flower+blooming+digital+petals+glowing+center+futuristic+font+Pollinations+AI?width=512&height=256&nologo=true" height="80">

  [GitHub: pollinations/pollinations](https://github.com/pollinations/pollinations)

---

GPT4Free and g4f.dev are continuously improving. Have fun building, and let the bots do the heavy lifting for you!

[← Back to GPT4Free GitHub](https://github.com/xtekky/gpt4free)
