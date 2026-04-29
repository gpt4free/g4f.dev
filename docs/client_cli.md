# Command Line Guide

Talk to the assistant directly from your computer's terminal. No browser needed.

---

## Install

```bash
pip install g4f
```

## Quick Start

Ask anything:
```bash
g4f client "Explain the moon landing in simple terms"
```

The answer appears right in your terminal.

---

## Common Uses

### Ask a question
```bash
g4f client "What are good beginner plants for gardening?"
```

### Describe an image
```bash
g4f client my-photo.jpg "What's in this picture?"
```

### Create an image
```bash
g4f client -m flux -O my-art.jpg "A peaceful mountain lake at sunset"
```

### Continue a conversation
Your last few messages are remembered automatically, so you can follow up:
```bash
g4f client "Now explain it like I'm five"
```

---

## Useful Options

| Option | What It Does |
|--------|-------------|
| `-h`, `--help` | Show all available options |
| `--debug` | Show detailed technical info if something goes wrong |
| `-p NAME` | Pick which service to use (e.g., `OpenaiChat`, `Gemini`) |
| `-m NAME` | Pick which assistant model to use |
| `-O FILE` | Save the answer to a file |
| `-i TEXT` | Give the assistant special instructions, like "You are a math tutor" |
| `-C` | Start fresh, forget previous messages |

---

## Examples

**Get a science explanation with a custom tone:**
```bash
g4f client -p PollinationsAI -i "You are a helpful science tutor" "Explain photosynthesis"
```

**Save a response to a file:**
```bash
g4f client -O story.txt "Write a short bedtime story"
```

**Start a completely new conversation:**
```bash
g4f client -C "Tell me a joke"
```

---

## Where Conversations Are Saved

- Conversation history: `~/.config/g4f/conversation.json`
- Login cookies (if needed): `~/.config/g4f/cookies/`

---

## Tips

- For creating images, use a model that supports it (like `flux`)
- Some services may ask you to log in through a browser first
- The model you last used is saved automatically for next time
