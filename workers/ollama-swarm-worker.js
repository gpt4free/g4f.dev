/**
 * OllamaSwarm Cloudflare Worker
 *
 * OpenAI-compatible proxy that routes requests across hundreds of public Ollama
 * servers discovered from a seed list and cached in Workers KV.
 *
 * Endpoints:
 *   GET  /v1/models                – list available models (sorted by availability)
 *   POST /v1/chat/completions      – chat completions with streaming support
 *   POST /refresh                  – force re-discovery (useful for cron warm-up)
 *
 * Environment bindings (wrangler.toml):
 *   OLLAMA_CACHE   – Workers KV namespace (optional but strongly recommended)
 *   API_KEY        – Bearer token to restrict access (optional)
 */

// ---------------------------------------------------------------------------
// Seed servers — public Ollama instances
// Duplicates are deduplicated at runtime via Set.
// ---------------------------------------------------------------------------
const _SEED_LIST = {
  "http://38.76.189.31.nip.io:11434": [
    "qwen3-embedding:0.6b",
    "nomic-embed-text:latest",
    "nomic-embed-text-v2-moe:latest",
    "deepseek-v4-pro:cloud",
    "WhiteRabbitNeo/Llama-3.1-WhiteRabbitNeo-2-8B:latest",
    "wrn-33b:latest"
  ],
  "http://38.76.189.74.nip.io:11434": [
    "qwen3-embedding:0.6b",
    "nomic-embed-text-v2-moe:latest",
    "nomic-embed-text:latest",
    "deepseek-v4-pro:cloud",
    "WhiteRabbitNeo/Llama-3.1-WhiteRabbitNeo-2-8B:latest",
    "wrn-33b:latest"
  ],
  "http://62.238.14.177.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "llama3.2:3b"
  ],
  "http://13.140.143.210.nip.io:11434": [
    "nemesis-ia-v3:latest",
    "nemesis-ia:latest",
    "llama3.2:3b"
  ],
  "http://38.76.189.45.nip.io:11434": [
    "qwen3-embedding:0.6b",
    "nomic-embed-text:latest",
    "nomic-embed-text-v2-moe:latest",
    "deepseek-v4-pro:cloud",
    "WhiteRabbitNeo/Llama-3.1-WhiteRabbitNeo-2-8B:latest",
    "wrn-33b:latest"
  ],
  "http://167.71.147.184.nip.io:11434": [
    "deepseek-r1:671b",
    "llama3.3:70b",
    "dolphin-mixtral:8x7b",
    "wizard-vicuna-uncensored:13b",
    "qwen2.5:72b",
    "codestral:22b",
    "llama3:8b",
    "mistral:7b",
    "deepseek-r1:7b",
    "gemma3:27b",
    "phi-4:14b",
    "dolphin-2.9-llama3:8b",
    "llama3.1-abliterated:8b",
    "qwen3:235b-a22b"
  ],
  "http://136.243.60.49.nip.io:11434": [
    "qwen2.5:0.5b"
  ],
  "http://213.136.76.182.nip.io:11434": [
    "x/flux2-klein:latest",
    "deepseek-v4-pro:cloud",
    "llama3.2:latest",
    "mistral-nemo:latest"
  ],
  "http://38.76.189.19.nip.io:11434": [
    "qwen3-embedding:0.6b",
    "nomic-embed-text:latest",
    "nomic-embed-text-v2-moe:latest",
    "deepseek-v4-pro:cloud",
    "WhiteRabbitNeo/Llama-3.1-WhiteRabbitNeo-2-8B:latest",
    "wrn-33b:latest"
  ],
  "http://90.149.239.71.nip.io:11434": [
    "huihui_ai/qwen3.5-abliterated:27b",
    "gemma4:26b",
    "nomic-embed-text-v2-moe:latest",
    "huihui_ai/gemma-4-abliterated:26b",
    "huihui_ai/qwen3.6-abliterated:27b",
    "huihui_ai/gpt-oss-abliterated:latest",
    "nomic-embed-text:latest",
    "qwen3-embedding:0.6b",
    "x/flux2-klein:latest",
    "minimax-m3:cloud",
    "kimi-k2.6:cloud",
    "qwen3-coder-next:cloud",
    "deepseek-v4-flash:cloud",
    "kimi-k2.5:cloud",
    "qwen3.5:cloud",
    "deepseek-v4-pro:cloud"
  ],
  "http://155.133.208.195.nip.io:11434": [
    "nomic-embed-text:latest",
    "nomic-embed-text-v2-moe:latest",
    "qwen3-embedding:0.6b",
    "x/flux2-klein:latest",
    "deepseek-v4-pro:cloud",
    "gemma3:4b",
    "phi3:mini"
  ],
  "http://38.76.189.21.nip.io:11434": [
    "qwen3-embedding:0.6b",
    "nomic-embed-text:latest",
    "nomic-embed-text-v2-moe:latest",
    "deepseek-v4-pro:cloud",
    "WhiteRabbitNeo/Llama-3.1-WhiteRabbitNeo-2-8B:latest",
    "wrn-33b:latest"
  ],
  "http://38.76.189.9.nip.io:11434": [
    "qwen3-embedding:0.6b",
    "nomic-embed-text:latest",
    "nomic-embed-text-v2-moe:latest",
    "deepseek-v4-pro:cloud",
    "WhiteRabbitNeo/Llama-3.1-WhiteRabbitNeo-2-8B:latest",
    "wrn-33b:latest"
  ],
  "http://46.224.203.89.nip.io:11434": [
    "llama3.2:3b",
    "llava:latest",
    "llama3.1:8b"
  ],
  "http://38.76.189.41.nip.io:11434": [
    "qwen3-embedding:0.6b",
    "nomic-embed-text-v2-moe:latest",
    "nomic-embed-text:latest",
    "deepseek-v4-pro:cloud",
    "WhiteRabbitNeo/Llama-3.1-WhiteRabbitNeo-2-8B:latest",
    "wrn-33b:latest"
  ],
  "http://38.76.189.97.nip.io:11434": [
    "qwen3-embedding:0.6b",
    "nomic-embed-text:latest",
    "nomic-embed-text-v2-moe:latest",
    "deepseek-v4-pro:cloud",
    "WhiteRabbitNeo/Llama-3.1-WhiteRabbitNeo-2-8B:latest",
    "wrn-33b:latest"
  ],
  "http://27.92.231.18.nip.io:11434": [
    "x/flux2-klein:latest",
    "deepseek-v4-pro:cloud"
  ],
  "http://75.128.229.121.nip.io:11434": [
    "glm-4.7-flash:Q8_0",
    "megatron:latest",
    "xploiter/pentester:latest",
    "artifish/llama3.2-uncensored:latest",
    "MFDoom/deepseek-coder-v2-tool-calling:16b",
    "hf.co/mradermacher/gpt-oss-20b-uncensored-GGUF:Q8_0"
  ],
  "http://193.237.205.200.nip.io:11434": [
    "gemma4:latest",
    "deepseek-v4-pro:cloud",
    "llama3:latest",
    "gpt-oss:120b-cloud",
    "phi3:latest",
    "mapler/gpt2:latest",
    "mistral:latest",
    "qwen3:latest",
    "gemma3:latest",
    "mistral-small3.2:latest",
    "devstral:latest",
    "phi4:latest",
    "deepseek-coder-v2:latest",
    "deepseek-r1:latest",
    "llama3.1:latest"
  ],
  "http://38.76.189.18.nip.io:11434": [
    "qwen3-embedding:0.6b",
    "nomic-embed-text:latest",
    "nomic-embed-text-v2-moe:latest",
    "deepseek-v4-pro:cloud",
    "WhiteRabbitNeo/Llama-3.1-WhiteRabbitNeo-2-8B:latest",
    "wrn-33b:latest"
  ],
  "http://158.101.214.195.nip.io:11434": [
    "deepseek-v4-pro:cloud"
  ],
  "http://51.254.130.116.nip.io:11434": [
    "qwen3:8b-q4_K_M",
    "qwen2.5:14b-instruct-q4_K_M",
    "llama3.1:8b-instruct-q4_K_M",
    "llama3.2:1b-instruct-q4_K_M",
    "qwen2.5:7b-instruct-q4_K_M",
    "llama3.2:3b-instruct-q4_K_M",
    "tinyllama:1.1b-chat-v1-q4_K_M",
    "qwen3:32b-q4_K_M",
    "qwen3:14b-q4_K_M",
    "205.237.106.117:8443/attacker/leak_model_5_026fc3:latest",
    "205.237.106.117:8443/attacker/leak_model_4_026fc3:latest",
    "205.237.106.117:8443/attacker/leak_model_3_026fc3:latest",
    "205.237.106.117:8443/attacker/leak_model_2_026fc3:latest",
    "205.237.106.117:8443/attacker/leak_model_1_026fc3:latest",
    "205.237.106.117:8443/attacker/leak_model_0_026fc3:latest",
    "deepseek-v4-pro:cloud",
    "minimax-m2.7:cloud",
    "llama3.2:3b",
    "smollm2:135m",
    "devstral-2:123b-cloud",
    "deepseek-v3.1:671b-cloud",
    "llama3:latest"
  ],
  "http://42.2.14.131.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "qwen2.5:7b-memorypro",
    "qwen2.5:7b",
    "nomic-embed-text:v1.5",
    "mxbai-embed-large:latest"
  ],
  "http://116.208.212.11.nip.io:11434": [
    "nomic-embed-text:latest"
  ],
  "http://61.140.16.147.nip.io:11434": [
    "nomic-embed-text-v2-moe:latest",
    "nomic-embed-text:latest"
  ],
  "http://114.254.25.58.nip.io:11434": [],
  "http://203.111.214.218.nip.io:11434": [
    "llama3.1:latest",
    "llama3.2-vision:latest",
    "qwen2.5:7b",
    "deepseek-v4-pro:cloud"
  ],
  "http://1.64.254.40.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "llama3.2:3b"
  ],
  "http://120.126.17.106.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "my-ai:latest",
    "deepseek-r1:32b"
  ],
  "http://220.133.154.29.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "minimax-m3:cloud",
    "qwen3.6:35b",
    "minimax-m2.7:cloud",
    "glm-4.7-flash:latest",
    "llama3.2:3b",
    "smollm2:135m",
    "quentinz/bge-small-zh-v1.5:latest",
    "deepseek-v3.1:671b-cloud",
    "llama3.1:8b",
    "huihui_ai/deepseek-r1-abliterated:14b",
    "gemma3:12b",
    "gemma3:latest",
    "gpt-oss:20b",
    "huihui_ai/deepseek-r1-abliterated:7b"
  ],
  "http://47.83.22.245.nip.io:11434": [
    "minimax-m3:cloud",
    "deepseek-v4-flash:cloud",
    "kimi-k2.5:cloud",
    "qwen3-coder-next:cloud",
    "qwen3.5:cloud",
    "kimi-k2.6:cloud",
    "deepseek-v4-pro:cloud"
  ],
  "http://49.213.207.138.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "qwen2.5:7b",
    "llama3.2-vision:11b",
    "qwen3-coder:30b",
    "qwen2.5-coder:7b",
    "qwen2.5:72b",
    "llama3.1:8b"
  ],
  "http://116.49.62.25.nip.io:11434": [
    "qwen3.6:35b-a3b",
    "hermes_copy:latest",
    "hermes_pwn:latest",
    "gpt-oss:latest",
    "smollm2:135m",
    "gpt-oss:120b",
    "qwen3:14b",
    "ministral-3:14b-instruct-2512-q8_0",
    "gemma3:4b-it-q4_K_M",
    "gpt-oss:20b",
    "llama3.2:3b-instruct-q5_K_M",
    "deepseek-r1:14b",
    "tinyllama:latest",
    "vicuna:latest",
    "llama3.3:latest",
    "deepseek-v2:latest",
    "llama3.2-vision:11b",
    "qwen2:7b",
    "phi3:14b",
    "nemotron-mini:latest",
    "llama3:latest",
    "llama3.2:latest",
    "llama3.1:8b"
  ],
  "http://180.109.253.192.nip.io:11434": [
    "qwen3-embedding:0.6b",
    "nomic-embed-text:latest",
    "huihui_ai/gpt-oss-abliterated:latest",
    "nomic-embed-text-v2-moe:latest",
    "leaktest_0_13_0:latest",
    "hermes_pwn:latest",
    "nemotron-3-ultra:cloud",
    "minimax-m3:cloud",
    "kimi-k2.5:cloud",
    "kimi-k2.6:cloud",
    "qwen3-coder-next:cloud",
    "qwen3.5:cloud",
    "deepseek-v4-flash:cloud",
    "deepseek-v4-pro:cloud"
  ],
  "http://140.112.99.178.nip.io:11434": [],
  "http://223.84.152.142.nip.io:11434": [],
  "http://182.40.33.227.nip.io:11434": [
    "deepseek-v4-pro:cloud"
  ],
  "http://106.12.155.130.nip.io:11434": [],
  "http://212.227.162.96.nip.io:11434": [
    "x/flux2-klein:latest",
    "deepseek-v4-pro:cloud",
    "phi3:latest"
  ],
  "http://46.101.110.71.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "x/flux2-klein:latest"
  ],
  "http://142.132.199.240.nip.io:11434": [
    "huihui_ai/gemma-4-abliterated:26b",
    "huihui_ai/gemma-4-abliterated:12b",
    "huihui_ai/gpt-oss-abliterated:latest",
    "huihui_ai/qwen3.5-abliterated:27b",
    "qwen3-embedding:0.6b",
    "huihui_ai/qwen3.6-abliterated:27b",
    "nomic-embed-text:latest",
    "nomic-embed-text-v2-moe:latest",
    "deepseek-v4-pro:cloud"
  ],
  "http://78.46.72.53.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "x/flux2-klein:latest"
  ],
  "http://92.5.49.200.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "qwen3.6:27b"
  ],
  "http://87.118.114.254.nip.io:11434": [
    "huihui_ai/gemma-4-abliterated:12b",
    "huihui_ai/gemma-4-abliterated:26b",
    "huihui_ai/qwen3.5-abliterated:27b",
    "huihui_ai/gpt-oss-abliterated:latest",
    "nomic-embed-text-v2-moe:latest",
    "qwen3-embedding:0.6b",
    "nomic-embed-text:latest",
    "huihui_ai/qwen3.6-abliterated:27b",
    "phi3:3.8b",
    "x/flux2-klein:latest",
    "deepseek-v4-pro:cloud"
  ],
  "http://51.89.6.222.nip.io:11434": [
    "x/flux2-klein:latest"
  ],
  "http://45.90.121.7.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "x/flux2-klein:latest"
  ],
  "http://2.56.246.156.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "x/flux2-klein:latest"
  ],
  "http://92.5.66.2.nip.io:11434": [
    "deepseek-v4-pro:cloud"
  ],
  "http://84.46.254.215.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "x/flux2-klein:latest"
  ],
  "http://155.133.208.198.nip.io:11434": [
    "qwen3-embedding:0.6b",
    "nomic-embed-text:latest",
    "nomic-embed-text-v2-moe:latest",
    "x/flux2-klein:latest",
    "deepseek-v4-pro:cloud",
    "gemma3:4b",
    "phi3:mini"
  ],
  "http://51.75.64.79.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "qwen3-embedding:0.6b",
    "nomic-embed-text:latest",
    "nomic-embed-text-v2-moe:latest",
    "llama3.1:latest",
    "qwen2.5:3b",
    "mxbai-embed-large:latest",
    "llama3.2:3b",
    "qwen3:4b",
    "phi3.5:latest",
    "moondream:latest"
  ],
  "http://92.5.2.87.nip.io:11434": [
    "x/flux2-klein:latest",
    "deepseek-v4-pro:cloud",
    "llama3.2:3b",
    "MFDoom/deepseek-coder-v2-tool-calling:latest",
    "gemma4:e4b",
    "llama3.1:8b",
    "qwen2.5-coder:7b",
    "qwen2.5-coder:7b-instruct-q4_K_M"
  ],
  "http://87.118.115.254.nip.io:11434": [
    "huihui_ai/gemma-4-abliterated:12b",
    "huihui_ai/gemma-4-abliterated:26b",
    "huihui_ai/qwen3.6-abliterated:27b",
    "huihui_ai/qwen3.5-abliterated:27b",
    "huihui_ai/gpt-oss-abliterated:latest",
    "nomic-embed-text-v2-moe:latest",
    "qwen3-embedding:0.6b",
    "nomic-embed-text:latest",
    "phi3:3.8b",
    "x/flux2-klein:latest",
    "deepseek-v4-pro:cloud"
  ],
  "http://37.46.19.85.nip.io:11434": [
    "gemma4:31b-cloud",
    "deepseek-v4-pro:cloud"
  ],
  "http://85.215.239.154.nip.io:11434": [
    "llama3.2:3b",
    "deepseek-v4-pro:cloud",
    "x/flux2-klein:latest"
  ],
  "http://167.86.80.58.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "x/flux2-klein:latest"
  ],
  "http://159.195.73.99.nip.io:11434": [
    "llama3.2:3b"
  ],
  "http://5.9.86.204.nip.io:11434": [
    "huihui_ai/gpt-oss-abliterated:latest",
    "huihui_ai/qwen3.5-abliterated:27b",
    "huihui_ai/qwen3.6-abliterated:27b",
    "nomic-embed-text:latest",
    "nomic-embed-text-v2-moe:latest",
    "huihui_ai/gemma-4-abliterated:12b",
    "huihui_ai/gemma-4-abliterated:26b",
    "smollm2:135m",
    "ilsp/meltemi-instruct:latest",
    "llama3.2:3b",
    "mistral:latest"
  ],
  "http://49.12.80.87.nip.io:11434": [
    "deepseek-v4-pro:cloud"
  ],
  "http://46.4.69.107.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "gemma4:e4b",
    "gemma4:26b",
    "gemma3:12b",
    "gemma3:27b",
    "gemma3:4b"
  ],
  "http://164.92.193.44.nip.io:11434": [
    "huihui_ai/gpt-oss-abliterated:latest",
    "huihui_ai/qwen3.5-abliterated:27b",
    "huihui_ai/qwen3.6-abliterated:27b",
    "nomic-embed-text:latest",
    "nomic-embed-text-v2-moe:latest",
    "qwen3-embedding:0.6b",
    "huihui_ai/gemma-4-abliterated:26b",
    "deepseek-v4-pro:cloud"
  ],
  "http://212.227.49.17.nip.io:11434": [],
  "http://178.105.63.139.nip.io:11434": [
    "llama3.2:3b",
    "deepseek-v4-pro:cloud",
    "llama3.2:latest"
  ],
  "http://162.55.84.42.nip.io:11434": [
    "x/flux2-klein:latest",
    "deepseek-v4-pro:cloud",
    "qwen2.5:32b",
    "command-r:latest"
  ],
  "http://94.103.173.64.nip.io:11434": [
    "qwen2.5-coder:7b",
    "qwen2.5-coder:3b",
    "qwen2.5-coder:1.5b-base",
    "deepseek-v4-pro:cloud",
    "llama3.2:latest"
  ],
  "http://89.168.67.184.nip.io:11434": [
    "llama3.2:3b",
    "nomic-embed-text:latest",
    "nomic-embed-text-v2-moe:latest",
    "qwen3-embedding:0.6b",
    "deepseek-v4-pro:cloud"
  ],
  "http://46.224.197.52.nip.io:11434": [
    "deepseek-v4-pro:cloud"
  ],
  "http://178.104.247.221.nip.io:11434": [
    "qwen2.5-coder:1.5b",
    "huihui_ai/qwen3.6-abliterated:27b",
    "qwen3-embedding:0.6b",
    "huihui_ai/gemma-4-abliterated:26b",
    "huihui_ai/gpt-oss-abliterated:latest",
    "huihui_ai/qwen3.5-abliterated:27b",
    "nomic-embed-text:latest",
    "nomic-embed-text-v2-moe:latest",
    "x/flux2-klein:latest",
    "deepseek-v4-pro:cloud",
    "gemma4:e4b"
  ],
  "http://158.101.181.50.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "qwen2.5:7b-64k",
    "qwen2.5:7b",
    "llama3:8b",
    "qwen2.5:3b"
  ],
  "http://178.105.164.192.nip.io:11434": [
    "mistral:latest"
  ],
  "http://92.5.134.191.nip.io:11434": [
    "x/flux2-klein:latest",
    "deepseek-v4-pro:cloud",
    "llama3.2:3b",
    "MFDoom/deepseek-coder-v2-tool-calling:latest",
    "gemma4:e4b",
    "llama3.1:8b",
    "qwen2.5-coder:7b",
    "qwen2.5-coder:7b-instruct-q4_K_M"
  ],
  "http://138.199.216.235.nip.io:11434": [
    "minimax-m2.7:cloud",
    "deepseek-v4-pro:cloud",
    "llama3.2:3b"
  ],
  "http://136.243.81.62.nip.io:11434": [],
  "http://46.224.108.17.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "x/flux2-klein:latest"
  ],
  "http://217.154.83.136.nip.io:11434": [
    "x/flux2-klein:latest",
    "deepseek-v4-pro:cloud",
    "qwen3.6:35b",
    "llama3.2:3b",
    "qwen3-coder:latest"
  ],
  "http://130.61.30.59.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "codellama:7b-instruct",
    "llama3.2:1b",
    "llama3.2:latest",
    "dolphin-llama3:8b"
  ],
  "http://188.245.175.189.nip.io:11434": [
    "deepseek-v4-pro:cloud"
  ],
  "http://87.120.166.139.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "x/flux2-klein:latest"
  ],
  "http://148.251.137.44.nip.io:11434": [
    "huihui_ai/gemma-4-abliterated:12b",
    "huihui_ai/gpt-oss-abliterated:latest",
    "huihui_ai/qwen3.5-abliterated:27b",
    "huihui_ai/qwen3.6-abliterated:27b",
    "nomic-embed-text-v2-moe:latest",
    "qwen3-embedding:0.6b",
    "huihui_ai/gemma-4-abliterated:26b",
    "nomic-embed-text:latest",
    "deepseek-v4-pro:cloud",
    "qwen2.5:7b"
  ],
  "http://148.251.136.233.nip.io:11434": [
    "huihui_ai/gpt-oss-abliterated:latest",
    "nomic-embed-text-v2-moe:latest",
    "nomic-embed-text:latest",
    "qwen3-embedding:0.6b",
    "deepseek-v4-pro:cloud"
  ],
  "http://46.4.57.97.nip.io:11434": [
    "fdv06-v2:latest",
    "Fonte-Llama-v1:latest",
    "Fonte-Qwen-v1:latest",
    "qwen3:8b",
    "fdv06-v7:latest",
    "fdv06-v2-bak-20260602:latest",
    "llama3:8b-instruct-q8_0"
  ],
  "http://195.201.100.12.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "x/flux2-klein:latest"
  ],
  "http://78.159.122.2.nip.io:11434": [
    "nomic-embed-text-v2-moe:latest",
    "qwen3-embedding:0.6b",
    "huihui_ai/gpt-oss-abliterated:latest",
    "nomic-embed-text:latest",
    "x/flux2-klein:latest"
  ],
  "http://217.20.124.139.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "x/flux2-klein:latest"
  ],
  "http://91.98.64.45.nip.io:11434": [],
  "http://5.9.85.18.nip.io:11434": [
    "huihui_ai/gpt-oss-abliterated:latest",
    "huihui_ai/gemma-4-abliterated:26b",
    "huihui_ai/qwen3.6-abliterated:27b",
    "qwen3-embedding:0.6b",
    "huihui_ai/gemma-4-abliterated:12b",
    "huihui_ai/qwen3.5-abliterated:27b",
    "nomic-embed-text:latest",
    "nomic-embed-text-v2-moe:latest",
    "qwen3.6:27b",
    "glm-4.7-flash:latest",
    "llama3.2:3b",
    "mistral-small3.2:24b",
    "qwen3.5:27b",
    "qwen3.5:9b",
    "smollm2:135m",
    "nemotron-3-nano:latest",
    "translategemma:27b",
    "deepseek-r1:32b",
    "deepseek-ocr:3b",
    "mistral:latest",
    "llama3.1:latest",
    "gpt-oss:20b",
    "llama3.2:latest"
  ],
  "http://91.98.65.172.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "x/flux2-klein:latest"
  ],
  "http://85.214.231.56.nip.io:11434": [
    "qwen3:32b-q4_K_M",
    "qwen3:14b-q4_K_M",
    "qwen3:8b-q4_K_M",
    "qwen2.5:14b-instruct-q4_K_M",
    "llama3.2:1b-instruct-q4_K_M",
    "qwen2.5:7b-instruct-q4_K_M",
    "llama3.2:3b-instruct-q4_K_M",
    "tinyllama:1.1b-chat-v1-q4_K_M",
    "Qwen3.5:122b-a10b",
    "llama3.1:70b-instruct-q4_K_M",
    "kimi-k2.6:cloud",
    "kimi-k2.5:cloud",
    "deepseek-v4-flash:cloud",
    "deepseek-v4-pro:cloud",
    "qwen3-coder-next:cloud",
    "qwen3-next:80b-cloud",
    "sparksammy/qwen3.5-27b-unsloth:small-hotfixed",
    "gemma4:31b-it-q4_K_M",
    "hf.co/unsloth/gemma-4-31B-it-GGUF:Q4_K_M",
    "deepseek-r1:1.5b",
    "qwen2.5:3b",
    "deepseek-r1:7b",
    "deepseek-coder:latest",
    "phi3:latest",
    "gemma-4-E4B-it-Q5-K-M:latest",
    "gemma4-e2b-it-Q5_K_M-2:latest",
    "gemma4-e2b-it-Q5_K_M:latest",
    "gemma4-vision-local:latest",
    "gemma4-local:latest",
    "gemma-vision-E4B-it--Q5_K_M:latest",
    "gemma2:2b",
    "gemma4-fast:latest",
    "gemma4:e2b",
    "functiongemma:latest",
    "mistral:latest",
    "llama3.2:latest",
    "gemma3:4b"
  ],
  "http://188.245.166.90.nip.io:11434": [
    "deepseek-v4-pro:cloud"
  ],
  "http://167.99.135.175.nip.io:11434": [],
  "http://162.19.244.62.nip.io:11434": [],
  "http://178.105.4.216.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "mistral:latest",
    "qwen2.5:7b"
  ],
  "http://2.56.246.214.nip.io:11434": [],
  "http://155.133.208.196.nip.io:11434": [
    "qwen3-embedding:0.6b",
    "nomic-embed-text:latest",
    "nomic-embed-text-v2-moe:latest",
    "x/flux2-klein:latest",
    "deepseek-v4-pro:cloud",
    "gemma3:4b",
    "phi3:mini"
  ],
  "http://155.133.208.194.nip.io:11434": [
    "nomic-embed-text:latest",
    "nomic-embed-text-v2-moe:latest",
    "qwen3-embedding:0.6b",
    "x/flux2-klein:latest",
    "deepseek-v4-pro:cloud",
    "gemma3:4b",
    "phi3:mini"
  ],
  "http://178.104.64.166.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "x/flux2-klein:latest"
  ],
  
  "http://91.98.200.119.nip.io:11434": [
    "nomic-embed-text-v2-moe:latest",
    "huihui_ai/gpt-oss-abliterated:latest",
    "huihui_ai/qwen3.6-abliterated:27b",
    "nomic-embed-text:latest",
    "qwen3-embedding:0.6b",
    "huihui_ai/gemma-4-abliterated:26b",
    "huihui_ai/qwen3.5-abliterated:27b",
    "deepseek-v4-pro:cloud",
    "llama3.2:1b"
  ],
  "http://217.160.69.10.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "x/flux2-klein:latest"
  ],
  "http://45.84.197.109.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "x/flux2-klein:latest"
  ],
  "http://178.105.30.2.nip.io:11434": [
    "deepseek-v4-pro:cloud"
  ],
  "http://5.9.73.92.nip.io:11434": [
    "qwen3.5:4b",
    "mxbai-embed-large:latest",
    "ministral-3:8b",
    "qwen3.5:0.8b"
  ],
  "http://57.129.77.185.nip.io:11434": [
    "x/flux2-klein:latest"
  ],
  "http://83.229.84.234.nip.io:11434": [],
  "http://213.165.73.127.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "test-copy:latest",
    "llama3.2:3b",
    "devstral-2:123b-cloud",
    "smollm2:135m",
    "deepseek-v3.1:671b-cloud",
    "hf.co/bartowski/Dolphin3.0-Qwen2.5-3b-GGUF:Q4_K_M",
    "mario:latest",
    "llama3-backup:latest",
    "mattw/pygmalion:latest",
    "llama3:instruct",
    "llama3.1:8b-instruct-q4_K_M",
    "llama3.2:latest",
    "mxbai-embed-large:latest"
  ],
  "http://188.245.40.20.nip.io:11434": [
    "x/flux2-klein:latest",
    "deepseek-v4-pro:cloud",
    "mistral:7b",
    "qwen2.5:7b"
  ],
  "http://148.251.179.45.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "gemma3:4b",
    "gemma3:27b",
    "gemma4:26b",
    "gemma4:e4b",
    "gemma3:12b"
  ],
  "http://87.106.223.47.nip.io:11434": [
    "deepseek-v4-pro:cloud"
  ],
  "http://188.245.250.200.nip.io:11434": [],
  "http://45.157.234.103.nip.io:11434": [
    "huihui_ai/glm-4.7-flash-abliterated:latest",
    "qwen3-embedding:0.6b",
    "nomic-embed-text:latest",
    "huihui_ai/gpt-oss-abliterated:latest",
    "huihui_ai/gemma-4-abliterated:12b",
    "huihui_ai/qwen3.5-abliterated:27b",
    "huihui_ai/qwen3.6-abliterated:27b",
    "nomic-embed-text-v2-moe:latest",
    "huihui_ai/gemma-4-abliterated:26b",
    "deepseek-v4-pro:cloud",
    "qwen3.5:9b",
    "qwen3.6:35b",
    "gemma4:26b",
    "qwen3-embedding:4b",
    "x/flux2-klein:latest"
  ],
  "http://88.198.64.194.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "hc_dbusd:latest",
    "mitarbeiter-fast:latest",
    "llama3-groq-tool-use:70b",
    "RobiLabs/lexa-rho:8b",
    "qwen3-coder:latest",
    "aya-expanse:8b",
    "gemma3:12b",
    "mistral-nemo:12b",
    "qwen3:14b",
    "qwen3:8b",
    "qwen3:4b",
    "llama3.2:latest"
  ],
  "http://162.55.176.246.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "llama3.2:3b",
    "minimax-m2.7:cloud",
    "embeddinggemma:300m"
  ],
  "http://167.172.170.114.nip.io:11434": [],
  "http://5.9.65.28.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "x/flux2-klein:latest"
  ],
  "http://80.147.139.148.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "qwen3.5:9b",
    "qwen3.5:latest",
    "qwen2.5:7b"
  ],
  "http://85.214.180.6.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "x/flux2-klein:latest"
  ],
  "http://91.99.156.133.nip.io:11434": [
    "deepseek-v4-pro:cloud"
  ],
  "http://88.198.51.59.nip.io:11434": [
    "huihui_ai/gpt-oss-abliterated:latest",
    "huihui_ai/qwen3.5-abliterated:27b",
    "nomic-embed-text-v2-moe:latest",
    "qwen3-embedding:0.6b",
    "huihui_ai/gemma-4-abliterated:12b",
    "nomic-embed-text:latest",
    "huihui_ai/glm-4.7-flash-abliterated:latest",
    "huihui_ai/qwen3.6-abliterated:27b",
    "huihui_ai/gemma-4-abliterated:26b",
    "nemotron-3-ultra:cloud",
    "nemotron-3-nano:30b-cloud",
    "qwen3-coder-next:cloud",
    "rnj-1:8b-cloud",
    "cogito-2.1:671b-cloud",
    "deepseek-v3.1:671b-cloud",
    "deepseek-v4-pro:cloud",
    "minimax-m2:cloud",
    "minimax-m3:cloud",
    "ministral-3:8b-cloud",
    "qwen3-next:80b-cloud",
    "qwen3.5:397b-cloud",
    "glm-4.7:cloud",
    "glm-5.1:cloud",
    "minimax-m2.1:cloud",
    "minimax-m2.5:cloud",
    "devstral-small-2:24b-cloud",
    "deepseek-v4-flash:cloud",
    "glm-5:cloud",
    "kimi-k2.6:cloud",
    "ministral-3:14b-cloud",
    "devstral-2:123b-cloud",
    "glm-4.6:cloud",
    "gemini-3-flash-preview:cloud",
    "gemma4:31b-cloud",
    "kimi-k2:1t-cloud",
    "minimax-m2.7:cloud",
    "ministral-3:3b-cloud",
    "qwen3-coder:480b-cloud",
    "nemotron-3-super:cloud",
    "gpt-oss:20b-cloud",
    "qwen3.5:cloud",
    "mistral-large-3:675b-cloud",
    "gpt-oss:120b-cloud",
    "kimi-k2.5:cloud",
    "deepseek-v3.2:cloud",
    "kimi-k2-thinking:cloud",
    "x/flux2-klein:latest",
    "qwen3:32b-q4_K_M",
    "qwen3:14b-q4_K_M",
    "qwen3:8b-q4_K_M",
    "qwen2.5:14b-instruct-q4_K_M",
    "llama3.1:8b-instruct-q4_K_M",
    "llama3.2:1b-instruct-q4_K_M",
    "qwen2.5:7b-instruct-q4_K_M",
    "llama3.2:3b-instruct-q4_K_M",
    "tinyllama:1.1b-chat-v1-q4_K_M",
    "all-minilm:latest",
    "mxbai-embed-large:latest",
    "qwen3.5:35b-a3b",
    "qwen3.5:122b-a10b",
    "llama3.1:70b-instruct-q4_K_M",
    "ministral-3:14b",
    "glm-4.7-flash:latest",
    "qwen2.5vl:7b",
    "llama3.2:3b",
    "smollm:135m",
    "qwen2.5:7b"
  ],
  "http://27.123.245.129.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "x/flux2-klein:latest"
  ],
  "http://135.125.219.74.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "x/flux2-klein:latest"
  ],
  "http://178.104.85.109.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "phi3:mini",
    "deepseek-r1:7b",
    "qwen2.5-coder:7b",
    "qwen2.5:7b"
  ],
  "http://46.225.154.68.nip.io:11434": [
    "x/flux2-klein:latest",
    "deepseek-v4-pro:cloud",
    "nemotron-3-super:cloud",
    "gemma4:31b-cloud",
    "publisher-observing-appetite.ngrok-free.dev/attacker/leak_model_0:latest",
    "deepseek-r1:8b",
    "nomic-embed-text:latest",
    "kimi-k2.5:cloud"
  ],
  "http://87.106.217.148.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "llama3.2:3b",
    "x/flux2-klein:latest"
  ],
  "http://148.251.14.46.nip.io:11434": [
    "huihui_ai/qwen3.6-abliterated:27b",
    "huihui_ai/gemma-4-abliterated:12b",
    "huihui_ai/gpt-oss-abliterated:latest",
    "nomic-embed-text:latest",
    "nomic-embed-text-v2-moe:latest"
  ],
  "http://88.99.101.247.nip.io:11434": [
    "deepseek-v4-pro:cloud"
  ],
  "http://91.98.138.15.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "x/flux2-klein:latest"
  ],
  "http://168.119.164.92.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "hc_dbusd:latest",
    "llama3.2:3b",
    "phi3:mini",
    "phi3.5:latest",
    "qwen2.5:3b",
    "qwen2.5:1.5b",
    "qwen2.5:7b"
  ],
  "http://88.99.67.122.nip.io:11434": [
    "x/flux2-klein:latest",
    "deepseek-v4-pro:cloud",
    "minimax-m3:cloud"
  ],
  "http://79.76.125.155.nip.io:11434": [
    "qwen3.5:4b-q4_K_M",
    "deepseek-v4-pro:cloud",
    "qwen3:14b"
  ],
  "http://178.104.175.204.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "x/flux2-klein:latest"
  ],
  "http://167.86.72.234.nip.io:11434": [
    "mistral-evo:latest",
    "codellama-evo:latest",
    "llamavision-evo:latest",
    "gemma3-evo:latest",
    "phi4-evo:latest",
    "qwen3-evo:latest",
    "qwen-coder-evo:latest",
    "deepseek-r1-evo:latest",
    "qwen3-coder:30b",
    "qwen2.5-coder:14b",
    "phi4:latest",
    "deepseek-r1:14b",
    "gemma3:12b",
    "llama3.2-vision:11b",
    "bge-m3:latest",
    "mxbai-embed-large:latest",
    "mistral:7b",
    "codellama:7b",
    "all-minilm:latest",
    "nomic-embed-text:latest",
    "x/flux2-klein:latest",
    "deepseek-v4-pro:cloud",
    "evolunys-prime:latest"
  ],
  "http://167.235.75.8.nip.io:11434": [
    "deepseek-v4-pro:cloud"
  ],
  "http://49.12.145.53.nip.io:11434": [
    "huihui_ai/gemma-4-abliterated:26b",
    "huihui_ai/gpt-oss-abliterated:latest",
    "huihui_ai/qwen3.5-abliterated:27b",
    "nomic-embed-text-v2-moe:latest",
    "huihui_ai/gemma-4-abliterated:12b",
    "huihui_ai/qwen3.6-abliterated:27b",
    "nomic-embed-text:latest",
    "qwen3-embedding:0.6b",
    "llama3.2:3b",
    "deepseek-v4-pro:cloud"
  ],
  "http://88.99.98.12.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "x/flux2-klein:latest"
  ],
  "http://212.227.21.255.nip.io:11434": [
    "qwen3.5:9b",
    "deepseek-v4-pro:cloud",
    "llama3.2:3b"
  ],
  "http://116.202.156.222.nip.io:11434": [
    "x/flux2-klein:latest",
    "deepseek-v4-pro:cloud",
    "minimax-m2.7:cloud",
    "qwen3.6:35b",
    "qwen3.6:35b-a3b-q4_K_M",
    "llama3.2:3b",
    "llama3.1:8b",
    "llama3.2:latest"
  ],
  "http://88.198.7.117.nip.io:11434": [
    "nomic-embed-text:latest",
    "nomic-embed-text-v2-moe:latest",
    "qwen3-embedding:0.6b",
    "gpt-oss:20b-cloud",
    "rnj-1:8b-cloud",
    "ministral-3:3b-cloud",
    "mistral-large-3:675b-cloud",
    "gpt-oss:120b-cloud",
    "ministral-3:8b-cloud",
    "devstral-2:123b-cloud",
    "minimax-m3:cloud",
    "ministral-3:14b-cloud",
    "kimi-k2-thinking:cloud",
    "cogito-2.1:671b-cloud",
    "devstral-small-2:24b-cloud",
    "glm-5.1:cloud",
    "qwen3.5:397b-cloud",
    "glm-5:cloud",
    "qwen3.5:cloud",
    "deepseek-v4-flash:cloud",
    "glm-4.7:cloud",
    "kimi-k2.5:cloud",
    "nemotron-3-nano:30b-cloud",
    "minimax-m2.5:cloud",
    "qwen3-next:80b-cloud",
    "deepseek-v3.2:cloud",
    "kimi-k2:1t-cloud",
    "minimax-m2:cloud",
    "qwen3-coder-next:cloud",
    "deepseek-v4-pro:cloud",
    "minimax-m2.1:cloud",
    "nemotron-3-super:cloud",
    "qwen3-coder:480b-cloud",
    "deepseek-v3.1:671b-cloud",
    "gemini-3-flash-preview:cloud",
    "gemma4:31b-cloud",
    "kimi-k2.6:cloud",
    "minimax-m2.7:cloud",
    "glm-4.6:cloud"
  ],
  "http://5.45.101.216.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "llama3.1:latest"
  ],
  "http://167.86.80.235.nip.io:11434": [],
  "http://78.47.201.172.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "llama3.2:latest"
  ],
  "http://46.225.60.15.nip.io:11434": [],
  "http://46.225.67.36.nip.io:11434": [
    "deepseek-v4-pro:cloud",
    "x/flux2-klein:latest"
  ],
  "http://130.61.46.60.nip.io:11434": [
    "deepseek-v4-pro:cloud"
  ],
  "http://212.56.46.225.nip.io:11434": [
    "huihui_ai/gemma-4-abliterated:12b",
    "nomic-embed-text:latest",
    "huihui_ai/gpt-oss-abliterated:latest",
    "huihui_ai/qwen3.5-abliterated:27b",
    "huihui_ai/qwen3.6-abliterated:27b",
    "qwen3-embedding:0.6b",
    "huihui_ai/gemma-4-abliterated:26b",
    "nomic-embed-text-v2-moe:latest",
    "x/flux2-klein:latest",
    "deepseek-v4-pro:cloud"
  ]
};

// Deduplicate at module load time
const DEFAULT_SEED_SERVERS = [...new Set(Object.keys(_SEED_LIST))];

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PROBE_TIMEOUT_MS = 5_000;
const TTFT_TIMEOUT_MS = 10_000;
const DEFAULT_MODEL = {
  "/v1/chat/completions": "deepseek-v4-pro:cloud",
  "/v1/images/generations": "x/flux2-klein:latest",
  "/v1/embeddings": "nomic-embed-text:latest"
};
const PROBE_BATCH_SIZE = 15; // CF Workers: max ~50 simultaneous outbound connections

// ---------------------------------------------------------------------------
// Server probing
// ---------------------------------------------------------------------------

/** Probe one Ollama server. Returns { url, models } or null. */
async function probeServer(url) {
  try {
    const resp = await fetch(`${url}/api/tags`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!resp.ok) return { url, error: resp.status};
    const data = await resp.json();
    const models = (data.models || [])
      .map((m) => m.name || "")
      .filter(
        (name) =>
          name &&
          !name.includes("/attacker/") &&
          !name.startsWith("model-b")
      );
    if (models.length > 0) return { url, models };
    else return {url, error: data}
  } catch(e) {
      return { url, error: e.message};
  }
}

/**
 * Run probe on a list of candidates in PROBE_BATCH_SIZE batches,
 * respecting CF Workers' concurrent-connection limit.
 */
async function probeBatched(candidates, step = 0) {
  const alive = {};
  const batch = candidates.slice(step * PROBE_BATCH_SIZE, (step * PROBE_BATCH_SIZE) + PROBE_BATCH_SIZE);
  const results = await Promise.allSettled(batch.map(probeServer));
  for (const r of results) {
    if (r.status === "fulfilled" && r.value.models) {
      alive[r.value.url] = r.value.models;
    }
  }
  return alive;
}

/**
 * Return alive servers → models map.
 * Uses KV daily cache when available, falls back to live probing.
 */
let cachedAlive = {}; // In-memory cache for the duration of the worker instance
let cachedStep = 0;
let workingModels = null;
function shuffleObject(obj) {
    const entries = Object.entries(obj);
    for (let i = entries.length - 1; i > 0; i--) {
        const j = 
            Math.floor(Math.random() * (i + 1));
        [entries[i], entries[j]] = 
            [entries[j], entries[i]];
    }
    return Object.fromEntries(entries);
}
function shuffleArray(array) {
    for (var i = array.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var temp = array[i];
        array[i] = array[j];
        array[j] = temp;
    }
    return array;
}
async function discoverServers(env) {
  const cacheRequest = new Request(`https://cache.example/servers`, {
    method: "GET"
  });
  if (!cachedStep) {
    const cachedResponse = await caches.default.match(cacheRequest);
    if (cachedResponse) {
      const cachedData = await cachedResponse.json();
      cachedStep = cachedData.cachedStep;
      cachedAlive = shuffleObject(cachedData.cachedAlive);
    }
  }
  
  if (cachedStep * PROBE_BATCH_SIZE >= DEFAULT_SEED_SERVERS.length) return false;

  const alive = await probeBatched(DEFAULT_SEED_SERVERS, cachedStep);

  if (Object.keys(alive).length > 0) {
    cachedAlive = Object.assign(cachedAlive, alive);
  }

  const responseToCache = Response.json({cachedAlive, cachedStep})
  responseToCache.headers.set("Cache-Control", "public, max-age=86400");
  await caches.default.put(cacheRequest, responseToCache);

  cachedStep += 1;
  return true;
}

// ---------------------------------------------------------------------------
// Model map helpers
// ---------------------------------------------------------------------------

/** Build { modelToServers, modelCount } from the alive map. */
function buildModelMap(alive) {
  const modelToServers = {};
  const modelCount = {};
  for (const [serverUrl, models] of Object.entries(alive)) {
    for (const model of models) {
      if (!modelToServers[model]) modelToServers[model] = [];
      modelToServers[model].push(serverUrl);
      modelCount[model] = (modelCount[model] || 0) + 1;
    }
  }
  return { modelToServers, modelCount };
}

// ---------------------------------------------------------------------------
// Upstream request helpers
// ---------------------------------------------------------------------------

/**
 * Forward a chat-completions request to one upstream Ollama server.
 *
 * For streaming responses, enforces a TTFT (time-to-first-token) timeout:
 * if the first chunk doesn't arrive within TTFT_TIMEOUT_MS the request is
 * aborted and an error is thrown so the caller can try another server.
 *
 * Throws an object with `{ statusCode, responseText }` for HTTP errors, or a
 * plain Error for timeouts and network failures.
 */
async function forwardToServer(serverUrl, model, bodyObj, pathname) {
  const controller = new AbortController();

  const upResp = await fetch(`${serverUrl}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...bodyObj, model }),
    signal: controller.signal,
  });

  if (!upResp.ok) {
    return upResp;
  }

  // Non-streaming: return the response directly
  if (!bodyObj.stream) {
    return new Response(upResp.body, {
      status: upResp.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Streaming: race the first chunk against a TTFT deadline
  const reader = upResp.body.getReader();
  let firstRead;
  try {
    firstRead = await Promise.race([
      reader.read(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("TTFT timeout: model took >10 s to start")),
          TTFT_TIMEOUT_MS
        )
      ),
    ]);
  } catch (e) {
    reader.cancel();
    controller.abort();
    throw e;
  }

  if (firstRead.done) {
    // Upstream closed the stream immediately (no content)
    return new Response("", { status: 200 });
  }

  const firstChunk = firstRead.value;

  // Pipe the rest of the stream, prepending the first chunk
  const stream = new ReadableStream({
    async start(ctrl) {
      ctrl.enqueue(firstChunk);
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          ctrl.enqueue(value);
        }
      } catch {
        // Ignore read errors (client disconnect, etc.)
      } finally {
        ctrl.close();
      }
    },
    cancel() {
      reader.cancel();
      controller.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Transfer-Encoding": "chunked",
    },
  });
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleModels(env) {
  const isLoading = await discoverServers(env);
  const { modelCount } = buildModelMap(cachedAlive);

  const ts = Math.floor(Date.now() / 1000);
  const data = Object.entries(modelCount)
    .sort(([, a], [, b]) => b - a)
    .map(([id, c]) => ({
      id,
      object: "model",
      created: ts,
      owned_by: "ollama-swarm",
      count: c
    }));

  return Response.json({ object: "list", data }, {headers: isLoading ? {"Cache-Control": "no-cache, no-store, must-revalidate"} : {}});
}

async function handleServers(env, all = false) {
  const loading = await discoverServers(env);
  const data = all ? cachedAlive : Object.keys(cachedAlive)
  return Response.json({
    data,
    loading,
    offset: cachedStep * PROBE_BATCH_SIZE,
    total: DEFAULT_SEED_SERVERS.length,
    working: await getWorkingModels()
  });
}
async function getWorkingModels() {
  const cachedResponse = await caches.default.match(new Request(`https://cache.example/working`));
  if (cachedResponse) {
    return await cachedResponse.json();
  }
}
let modelToServersCache = null;
async function handleChatCompletions(request, env, pathname, ctx) {
  let bodyObj;
  try {
    bodyObj = await request.json();
  } catch {
    return Response.json(
      { error: { message: "Invalid JSON body", type: "invalid_request_error" } },
      { status: 400 }
    );
  }

  const model = bodyObj.model || DEFAULT_MODEL[pathname];
  if (!model) {
    return Response.json(
      { error: { message: "Missing model name", type: "invalid_request_error" } },
      { status: 400 }
    );
  }
  const loading = await discoverServers(env);
  const { modelToServers } = buildModelMap(cachedAlive);
  
  const serverUrls = shuffleArray(modelToServers[model]);
  if (!serverUrls || serverUrls.length === 0) {
    const available = Object.keys(modelToServersCache).slice(0, 15).join(", ");
    return Response.json(
      {
        error: {
          message: `Model '${model}' not found. Available: ${available || "(none discovered yet)"}`,
          type: "invalid_request_error",
        },
      },
      { status: 404 }
    );
  }

  let lastError = "";
  let errorCount = 0;
  if (!workingModels) {
      workingModels = await getWorkingModels();
  }
  let workingServers = shuffleArray((workingModels && workingModels[model]) ? workingModels[model] : []);
  for (const serverUrl of serverUrls) {
    try {
      if ((loading || errorCount > 5) && workingServers.length > 0) {
        for (const workingServer of workingServers) {
          const resp = await forwardToServer(workingServer, model, bodyObj, pathname);
          if (!resp.ok) {
            let message;
            try {
              message = (await resp.clone().json()).error?.message;
            } catch {}
            lastError = message || await resp.text();
            errorCount += 1;
            continue;
          }
          return resp;
        }
        workingServers = [];
      }
      const resp = await forwardToServer(serverUrl, model, bodyObj, pathname);
      if (!resp.ok) {
        let message;
        try {
          message = (await resp.clone().json()).error?.message;
        } catch {}
        throw Object.assign(new Error(message || await resp.text()), { status: resp.status})
      }
      if (!workingModels) {
        workingModels = {};
      }
      if (!workingModels[model]) {
        workingModels[model] = [];
      }
      if (!workingModels[model].includes(serverUrl)) {
        workingModels[model].push(serverUrl);
        const responseToCache = Response.json(workingModels);
        responseToCache.headers.set("Cache-Control", "public, max-age=86400");
        ctx.waitUntil(caches.default.put(new Request(`https://cache.example/working`), responseToCache));
      }
      return resp;
    } catch (e) {
      // 400 = server alive but model invalid — no point retrying other servers
      if (e.status === 400) {
        return Response.json(
          {
            error: {
              message: e.message || "Bad request",
              type: "invalid_request_error",
            },
          },
          { status: 400 }
        );
      }
      lastError = e.message;
      errorCount += 1;
      if (errorCount >= (loading ? 5 : 20)) {
        break;
      }
      // Try next server
    }
  }

  return Response.json(
    {
      error: {
        message: `All servers failed (${errorCount}/${serverUrls.length}): ${lastError}`,
        type: "server_error",
      },
    },
    { status: 503 }
  );
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

function isAuthorized(request, env) {
  if (!env.API_KEY) return true; // No key configured → open access
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return token === env.API_KEY;
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function withCors(response) {
  const r = new Response(response.body, response);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    r.headers.set(k, v);
  }
  return r;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export default {
  /** HTTP fetch handler */
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (!isAuthorized(request, env)) {
      return withCors(
        Response.json(
          { error: { message: "Unauthorized", type: "auth_error" } },
          { status: 401 }
        )
      );
    }

    const { pathname } = new URL(request.url);
    let response;

    if (pathname.endsWith("/models") && request.method === "GET") {
      response = await handleModels(env);
    } else if ((pathname === "/servers" || pathname === "/quota") && request.method === "GET") {
      response = await handleServers(env);
    } else if (pathname === "/servers/all" && request.method === "GET") {
      response = await handleServers(env, true);
    } else if (
      (pathname.endsWith("/chat/completions") || pathname === "/") &&
      request.method === "POST"
    ) {
      response = await handleChatCompletions(request, env, '/v1/chat/completions', ctx);
    } else if (
      pathname.endsWith("/images/generations") &&
      request.method === "POST"
    ) {
      response = await handleChatCompletions(request, env, '/v1/images/generations', ctx);
      ///v1/embeddings
    }  else if (
      pathname.endsWith("/embeddings") &&
      request.method === "POST"
    ) {
      response = await handleChatCompletions(request, env, '/v1/embeddings', ctx);
    } else if (pathname === "/" || pathname === "/health") {
      response = Response.json({ status: "ok", service: "ollama-swarm" });
    } else {
      response = new Response("Not Found", { status: 404 });
    }

    return withCors(response);
  }
};
