# Using G4F from JavaScript / Node.js

If you prefer JavaScript over Python, you can use G4F in your JS projects too.

## What You Need

- Node.js installed on your computer
- A project folder

## Setup

1. Make a new folder for your project and open it in your terminal.
2. Install the G4F package:

```bash
npm install g4f
```

## Simple Example

This sends a message to an AI and prints the reply:

```javascript
const { G4F } = require("g4f");
const g4f = new G4F();

const messages = [
    { role: "user", content: "Hello! Can you help me write an email?" }
];

(async () => {
    const response = await g4f.chatCompletion(messages);
    console.log(response);
})();
```

## Streaming Replies

Streaming means you see the answer appear word-by-word, like a real conversation.

```javascript
const { G4F } = require("g4f");
const g4f = new G4F();

const messages = [
    { role: "user", content: "Tell me a short story." }
];

const options = {
    provider: g4f.providers.GPT,
    stream: true
};

(async () => {
    const response = await g4f.chatCompletion(messages, options);
    for await (const chunk of response) {
        process.stdout.write(chunk);
    }
})();
```

## Choosing a Provider

Providers are the services that actually run the AI. Pick one when you need a specific model.

```javascript
const options = {
    provider: g4f.providers.Bing,
    model: "gpt-4"
};
```

## Sending Images

You can show the AI a picture and ask about it.

```javascript
const fs = require('fs');
const { G4F } = require("g4f");
const g4f = new G4F();

const imageBuffer = fs.readFileSync("photo.jpg");
const imageBase64 = imageBuffer.toString('base64');

const messages = [
    {
        role: "user",
        content: "What do you see in this image?",
        image: imageBase64
    }
];

(async () => {
    const response = await g4f.chatCompletion(messages);
    console.log(response);
})();
```

## Creating Images

Turn text into pictures:

```javascript
const { G4F } = require("g4f");
const g4f = new G4F();

(async () => {
    const image = await g4f.imageGeneration("a cat wearing a space suit");
    console.log(image);
})();
```

## Common Issues

- **"Module not found"**: Make sure you ran `npm install g4f`.
- **Network errors**: Check your internet connection. Some providers may be blocked in your region.
- **Slow responses**: Try a different provider if one is taking too long.

---

[Back to main docs](README.md)
