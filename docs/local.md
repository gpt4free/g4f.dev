# Running Models Locally

## What This Means
Instead of using the internet to get responses, you can run AI models directly on your own computer. This is completely free and private.

## Requirements

**Hardware:**
- At least 8GB RAM (16GB+ recommended)
- Modern CPU or NVIDIA GPU
- ~5GB free disk space per model

**Software:**
- Python 3.8+
- Optional: CUDA (for NVIDIA GPU speed boost)

## Setup

1. Install dependencies:
```bash
pip install tool[local]
```

2. Download a model:
```bash
python -m tool.Local model download llama-3-8b
```

3. Start the local server:
```bash
python -m tool.Local server start
```

## Using Local Models

Once running, use it like normal:
```python
from tool import Client

client = Client()
client.api_base = "http://localhost:8000"
response = client.ask("Hello!")
```

## Pros & Cons

| Good | Not So Good |
|------|-------------|
| Completely free | Needs good hardware |
| Fully private | Slower than cloud |
| Works offline | Fewer model choices |

## Troubleshooting
- **Out of memory:** Use a smaller model
- **Slow:** Enable GPU support if available
- **Won't start:** Check Python version is 3.8+
