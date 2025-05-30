## G4F - Providers and Models

**Last updated:** May 30, 2025

This document provides an overview of various AI providers and models, including text generation, image generation, and vision capabilities. It aims to help users navigate the diverse landscape of AI services and choose the most suitable option for their needs.

> **Note**: See our [Authentication Guide](authentication.md) for authentication instructions for the provider.

## Table of Contents
  - [Providers](#providers)
    - [No auth required](#providers-not-needs-auth)
    - [HuggingFace](#providers-huggingface)
    - [HuggingSpace](#providers-huggingspace)
    - [Local](#providers-local)
    - [MiniMax](#providers-minimax)
    - [Needs auth](#providers-needs-auth)
  - [Models](#models)
    - [Text generation models](#text-generation-models)
    - [Image generation models](#image-generation-models)
  - [Conclusion and Usage Tips](#conclusion-and-usage-tips)

---
## Providers
**Authentication types:**
- **Get API key** - Requires an API key for authentication. You need to obtain an API key from the provider's website to use their services.
- **Cookies** - Requires browser cookies for authentication. You need to extract cookies from your browser session while logged in to the provider's website.
- **No auth required** - No authentication needed. The service is publicly available without any credentials.
- **HAR file** - Requires HAR (HTTP Archive) file for authentication. You need to capture network traffic while using the provider's website and export it as a HAR file.
- **Nodriver** - Uses automated browser control for authentication. The provider automatically handles login and session management using browser automation (no manual setup required).

**Symbols:**
- ✔ - Feature is supported
- ❌ - Feature is not supported
- ✔ _**(n+)**_ - Number of additional models supported by the provider but not publicly listed

---
### Providers No auth required
| Website | API Credentials | Provider | Text generation | Image generation | Audio generation | Video generation | Vision (Image Upload) | Status |
|----------|-------------|--------------|---------------|--------|--------|------|------|------|
|[ai-arta.com](https://ai-arta.com)|No auth required|`g4f.Provider.ARTA`|❌|`flux, flux-dev, flux-pro, gpt-image, sdxl-1.0 sdxl-l` _**(51+)**_|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[blackbox.ai](https://www.blackbox.ai)|No auth required|`g4f.Provider.Blackbox`|`blackboxai, gpt-4.1-mini, gpt-4.1-nano, gpt-4, gpt-4o, gpt-4o-mini` _**(29+)**_||❌|❌|❌|✔|![](https://img.shields.io/badge/Active-brightgreen)|
|[blackboxapi.com](https://www.blackboxapi.com)|No auth required|`g4f.Provider.Blackboxapi`|`llama-3.1-70b`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[chatai.aritek.app](https://chatai.aritek.app)|No auth required|`g4f.Provider.Chatai`|`gpt-4o-mini`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[chatglm.cn](https://chatglm.cn)|No auth required|`g4f.Provider.ChatGLM`|`glm-4`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[chatgpt.com](https://chatgpt.com)|No auth required|`g4f.Provider.ChatGpt`|✔|❌|❌|❌|❌|![Error](https://img.shields.io/badge/HTTPError-f48d37)|
|[playground.ai.cloudflare.com](https://playground.ai.cloudflare.com)|No auth required|`g4f.Provider.Cloudflare`|`llama-2-7b, llama-3-8b, llama-3.1-8b, llama-3.2-1b, qwen-1.5-7b`|❌|❌|❌|❌|![Error](https://img.shields.io/badge/Active-brightgreen)|
|[copilot.microsoft.com](https://copilot.microsoft.com)|No auth required/HAR file|`g4f.Provider.Copilot`|`gpt-4, o1`|`dall-e-3`|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[deepinfra.com/chat](https://deepinfra.com/chat)|No auth required|`g4f.Provider.DeepInfraChat`|`deepseek-prover-v2-671b, qwen-3-235b, qwen-3-30b, qwen-3-32b, qwen-3-14b, llama-4-maverick, llama-4-maverick, phi-4-reasoning-plus, qwq-32b, deepseek-v3-0324, gemma-3-27b, gemma-3-12b, phi-4-multimodal, llama-3.1-8b, llama-3.2-90b, llama-3.3-70b, deepseek-v3, mixtral-small-24b, deepseek-r1-turbo, deepseek-r1, deepseek-r1-distill-llama-70b, deepseek-r1-distill-qwen-32b, phi-4, wizardlm-2-8x22b, qwen-2-72b, dolphin-2.6, dolphin-2.9, airoboros-70b, lzlv-70b, wizardlm-2-7b, mixtral-8x22b`|❌|❌|❌|`llama-3.2-90b, minicpm-2.5`|![](https://img.shields.io/badge/Active-brightgreen)|
|[docsbot.ai](https://docsbot.ai)|No auth required|`g4f.Provider.DocsBot`|`gpt-4o`|❌|❌|❌|✔|![](https://img.shields.io/badge/Active-brightgreen)|
|[duckduckgo.com/aichat](https://duckduckgo.com/aichat)|No auth required|`g4f.Provider.DuckDuckGo`|✔|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[chat10.free2gpt.xyz](https://chat10.free2gpt.xyz)|No auth required|`g4f.Provider.Free2GPT`|`gemini-1.5-pro, gemini-1.5-flash`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[freegptsnav.aifree.site](https://freegptsnav.aifree.site)|No auth required|`g4f.Provider.FreeGpt`|`gemini-1.5-pro, gemini-1.5-flash`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[app.giz.ai/assistant](https://app.giz.ai/assistant)|No auth required|`g4f.Provider.GizAI`|`gemini-1.5-flash`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[editor.imagelabs.net](editor.imagelabs.net)|No auth required|`g4f.Provider.ImageLabs`|❌|`sdxl-turbo`|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[huggingface.co/spaces](https://huggingface.co/spaces)|No auth required|`g4f.Provider.HuggingSpace`|`qwen-2-72b, qwen-3-235b, qwen-3-32b, qwen-3-30b, qwen-3-14b, qwen-3-4b, qwen-3-1.7b, qwen-3-0.6b, command-r-plus, command-r, command-r7b`|`flux-dev, sd-3.5-large`|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[lambda.chat](https://lambda.chat)|No auth required|`g4f.Provider.LambdaChat`|`deepseek-v3, deepseek-r1, hermes-3, hermes-3-405b, nemotron-70b, llama-3.3-70b, qwen-2.5-coder-32b`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[legacy.lmarena.ai](https://legacy.lmarena.ai)|No auth required|`g4f.Provider.LegacyLMArena`|`claude-3.7-sonnet, claude-3.7-sonnet-thinking, gpt-4o, grok-3, gemini-2.0-flash-thinking, gemini-2.0-pro, deepseek-r1, gemini-2.0-flash, o1, qwen-2.5-max, o3-mini, o3, o4-mini, deepseek-v3, deepseek-v3-0324, qwen-plus, glm-4-plus, o1-mini, gemini-1.5-pro, grok-2, claude-3.5-sonnet, qwen-2.5-plus, deepseek-v2.5, gpt-4o-mini, gemini-1.5-flash, llama-3.1-405b, nemotron-70b, grok-2-mini, qwen-max, qwen-2.5-72b, qwen-2.5-vl-32b, qwen-2.5-vl-72b, gpt-4-turbo, llama-3.3-70b, nemotron-49b, mistral-large, mistral-medium, pixtral-large, gpt-4, gpt-4.1, gpt-4.1-mini, gpt-4.1-nano, llama-3.1-70b, nemotron-253b, claude-3-opus, tulu-3-70b, claude-3.5-haiku, reka-core, gemma-2-27b, gemma-3-27b, gemma-3-12b, gemma-3-4b, deepseek-v2, qwen-2.5-coder-32b, gemma-2-9b, command-r-plus, command-a, deepseek-coder-v2, nemotron-51b, mistral-small-24b, mistral-small-3.1-24b, nemotron-4-340b, glm-4, llama-3-70b, llama-4-maverick, llama-4-scout, reka-flash, phi-4, claude-3-sonnet, qwen-2-72b, qwen-3-235b, qwen-3-30b, qwen-3-32b, tulu-3-8b, command-r, codestral, claude-3-haiku, llama-3.1-8b, qwen-1.5-110b, qwq-32b, llama-3-8b, qwen-1.5-72b, gemma-2-2b, qwen-vl-max, gemini-2.5-pro, gemini-2.5-flash, mixtral-8x22b, qwen-1.5-32b, qwen-1.5-14b, qwen-1.5-7b, qwen-1.5-4b, mistral-next, phi-3-medium, phi-3-small, phi-3-mini, tulu-2-70b, llama-2-70b, llama-2-13b, llama-2-7b, hermes-2-dpo, pplx-70b-online, pplx-7b-online, deepseek-67b, openhermes-2.5-7b, mistral-7b, llama-3.2-3b, llama-3.2-1b, codellama-34b, codellama-70b, qwen-14b, gpt-3.5-turbo, mixtral-8x7b, dbrx-instruct, llama-13b`  _**(54+)**_ |❌|❌|❌|`claude-3.7-sonnet, claude-3.7-sonnet-thinking, gpt-4o, gemini-2.0-flash, o3, o4-mini, gemini-1.5-pro, claude-3.5-sonnet, gpt-4o-mini, gemini-1.5-flash, qwen-2.5-vl-32b, qwen-2.5-vl-72b, mistral-medium, pixtral-large, gpt-4.1, gpt-4.1-mini, gpt-4.1-nano, claude-3-opus, claude-3.5-haiku, reka-core, gemma-3-27b, mistral-small-3.1-24b, llama-4-maverick, llama-4-scout, reka-flash, claude-3-sonnet, claude-3-haiku, qwen-vl-max, gemini-2.5-pro, gemini-2.5-flash, amazon-nova-pro, amazon-nova-lite, step-1o-vision, c4ai-aya-vision-32b, pixtral-12b _**(12+)**_`|![](https://img.shields.io/badge/Active-brightgreen)|
|[oi-vscode-server-2.onrender.com](https://oi-vscode-server-2.onrender.com)|No auth required|`g4f.Provider.OIVSCodeSer2`|`gpt-4o-mini`|❌|❌|❌|✔|![Error](https://img.shields.io/badge/Active-brightgreen)|
|[oi-vscode-server-5.onrender.com](https://oi-vscode-server-5.onrender.com)|No auth required|`g4f.Provider.OIVSCodeSer5`|`gpt-4.1-mini`|❌|❌|❌|✔|![Error](https://img.shields.io/badge/Active-brightgreen)|
|[oi-vscode-server-0501.onrender.com](https://oi-vscode-server-0501.onrender.com)|No auth required|`g4f.Provider.OIVSCodeSer0501`|`gpt-4.1-mini`|❌|❌|❌|✔|![Error](https://img.shields.io/badge/Active-brightgreen)|
|[openai.fm](https://www.openai.fm)|No auth required|`g4f.Provider.OpenAIFM`|❌|❌|`gpt-4o-mini-tts`|❌|✔|![Error](https://img.shields.io/badge/Active-brightgreen)|
|[labs.perplexity.ai](https://labs.perplexity.ai)|No auth required|`g4f.Provider.PerplexityLabs`|`sonar, sonar-pro, sonar-reasoning, sonar-reasoning-pro`|❌|❌|❌|❌|![Error](https://img.shields.io/badge/Active-brightgreen)|
|[pi.ai/talk](https://pi.ai/talk)|[Cookies](https://pi.ai/talk)|`g4f.Provider.Pi`|`pi`|❌|❌|❌|❌|![Error](https://img.shields.io/badge/Active-brightgreen)|
|[pizzagpt.it](https://www.pizzagpt.it)|No auth required|`g4f.Provider.Pizzagpt`|`gpt-4o-mini`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[pollinations.ai](https://pollinations.ai)|No auth required/[Get API key](https://auth.pollinations.ai)|`g4f.Provider.PollinationsAI`|`gpt-4o-mini, gpt-4.1-nano, gpt-4, gpt-4o, gpt-4.1, o4-mini, gpt-4.1-mini, command-r-plus, gemini-2.5-flash, gemini-2.0-flash-thinking, qwen-2.5-coder-32b, llama-3.3-70b, llama-4-scout, mistral-small-3.1-24b, deepseek-r1, deepseek-r1-distill-llama-70b, deepseek-r1-distill-qwen-32b, phi-4, qwq-32b, deepseek-v3, deepseek-v3-0324, grok-3-mini` _**(4+)**_|`flux, flux-pro, flux-dev, flux-schnell, dall-e-3, sdxl-turbo, gpt-image`|`gpt-4o-mini-audio`|❌|`gpt-4o, gpt-4o-mini, o1-mini, o3-mini, o4-mini`|![](https://img.shields.io/badge/Active-brightgreen)|
|[pollinations.ai](https://pollinations.ai)|No auth required|`g4f.Provider.PollinationsImage`|❌|`flux, flux-pro, flux-dev, flux-schnell, dall-e-3, sdxl-turbo, gpt-image`|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[teach-anything.com](https://www.teach-anything.com)|No auth required|`g4f.Provider.TeachAnything`|`gemini-1.5-pro, gemini-1.5-flash`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[you.com](https://you.com)|[Cookies](https://you.com)|`g4f.Provider.You`|✔|✔|❌|❌|✔|![](https://img.shields.io/badge/Active-brightgreen)|
|[websim.ai](https://websim.ai)|No auth required|`g4f.Provider.Websim`|`gemini-1.5-pro, gemini-1.5-flash`|`flux`|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[chat-gpt.com](https://chat-gpt.com)|No auth required|`g4f.Provider.WeWordle`|`gpt-4`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[chat9.yqcloud.top](https://chat9.yqcloud.top)|No auth required|`g4f.Provider.Yqcloud`|`gpt-4`|✔|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|

---
### Providers HuggingSpace
| Website | API Credentials | Provider | Text generation | Image generation | Audio generation | Video generation | Vision (Image Upload) | Status |
|----------|-------------|--------------|---------------|--------|--------|------|------|------|
|[black-forest-labs-flux-1-dev.hf.space](https://black-forest-labs-flux-1-dev.hf.space)|[Get API key](https://huggingface.co/settings/tokens)|`g4f.Provider.BlackForestLabs_Flux1Dev`|❌|`flux, flux-dev`|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[black-forest-labs-flux-1-schnell.hf.space](https://black-forest-labs-flux-1-schnell.hf.space)|[Get API key](https://huggingface.co/settings/tokens)|`g4f.Provider.BlackForestLabs_Flux1Schnell`|❌|`flux, flux-schnell`|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[cohereforai-c4ai-command.hf.space](https://cohereforai-c4ai-command.hf.space)|[Get API key](https://huggingface.co/settings/tokens)|`g4f.Provider.CohereForAI_C4AI_Command`|`command-r-plus, command-r, command-r7b`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[huggingface.co/spaces/deepseek-ai/Janus-Pro-7B](https://huggingface.co/spaces/deepseek-ai/Janus-Pro-7B)|[Get API key](https://huggingface.co/settings/tokens)|`g4f.Provider.DeepseekAI_Janus_Pro_7b`|✔|✔|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[roxky-flux-1-dev.hf.space](https://roxky-flux-1-dev.hf.space)|[Get API key](https://huggingface.co/settings/tokens)|`g4f.Provider.G4F`|✔ _**(1+)**_|✔ _**(4+)**_|❌|❌|✔ _**(1+)**_|![](https://img.shields.io/badge/Active-brightgreen)|
|[microsoft-phi-4-multimodal.hf.space](https://microsoft-phi-4-multimodal.hf.space)|[Get API key](https://huggingface.co/settings/tokens)|`g4f.Provider.Microsoft_Phi_4`|`phi-4`|❌|❌|❌|`phi-4`|![](https://img.shields.io/badge/Active-brightgreen)|
|[qwen-qwen2-5.hf.space](https://qwen-qwen2-5.hf.space)|[Get API key](https://huggingface.co/settings/tokens)|`g4f.Provider.Qwen_Qwen_2_5`|`qwen-2.5`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[qwen-qwen2-5-1m-demo.hf.space](https://qwen-qwen2-5-1m-demo.hf.space)|[Get API key](https://huggingface.co/settings/tokens)|`g4f.Provider.Qwen_Qwen_2_5M`|`qwen-2.5-1m`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[qwen-qwen2-5-max-demo.hf.space](https://qwen-qwen2-5-max-demo.hf.space)|[Get API key](https://huggingface.co/settings/tokens)|`g4f.Provider.Qwen_Qwen_2_5_Max`|`qwen-2-5-max`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[qwen-qwen2-72b-instruct.hf.space](https://qwen-qwen2-72b-instruct.hf.space)|[Get API key](https://huggingface.co/settings/tokens)|`g4f.Provider.Qwen_Qwen_2_72B`|`qwen-2-72b`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[qwen-qwen2-72b-instruct.hf.space](https://qwen-qwen2-72b-instruct.hf.space)|[Get API key](https://huggingface.co/settings/tokens)|`g4f.Provider.Qwen_Qwen_3`|`qwen-3-235b, qwen-3-32b, qwen-3-30b, qwen-3-14b, qwen-3-4b, qwen-3-1.7b, qwen-3-0.6b`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[stabilityai-stable-diffusion-3-5-large.hf.space](https://stabilityai-stable-diffusion-3-5-large.hf.space)|[Get API key](https://huggingface.co/settings/tokens)|`g4f.Provider.StabilityAI_SD35Large`|❌|`sd-3.5-large`|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|

---
### Providers Needs Auth
| Website | API Credentials | Provider | Text generation | Image generation | Audio generation | Video generation | Vision (Image Upload) | Status |
|----------|-------------|--------------|---------------|--------|--------|------|------|------|
|[console.anthropic.com](https://console.anthropic.com)|[Get API key](https://console.anthropic.com/settings/keys)|`g4f.Provider.Anthropic`|✔|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[bing.com/images/create](https://www.bing.com/images/create)|[Cookies](https://www.bing.com)|`g4f.Provider.BingCreateImages`|❌|`dall-e-3`|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[blackbox.ai](https://www.blackbox.ai)|[HAR file](https://www.blackbox.ai)|`g4f.Provider.BlackboxPro`|✔|✔|❌|❌|✔|![](https://img.shields.io/badge/Active-brightgreen)|
|[cablyai.com/chat](https://cablyai.com/chat)|[Get API key](https://cablyai.com)|`g4f.Provider.CablyAI`|✔|✔|❌|❌|✔|![](https://img.shields.io/badge/Active-brightgreen)|
|[inference.cerebras.ai](https://inference.cerebras.ai/)|[Get API key](https://cloud.cerebras.ai)|`g4f.Provider.Cerebras`|✔|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[copilot.microsoft.com](https://copilot.microsoft.com)|[Nodriver](https://copilot.microsoft.com)|`g4f.Provider.CopilotAccount`|✔|✔|❌|❌|✔|![](https://img.shields.io/badge/Active-brightgreen)|
|[deepinfra.com](https://deepinfra.com)|[Get API key](https://deepinfra.com/dash/api_keys)|`g4f.Provider.DeepInfra`|✔|✔|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[platform.deepseek.com](https://platform.deepseek.com)|[Get API key](https://platform.deepseek.com/api_keys)|`g4f.Provider.DeepSeek`|✔ |❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[chat.deepseek.com](https://chat.deepseek.com)|[Get API key](https://platform.deepseek.com/api_keys)|`g4f.Provider.DeepSeekAPI`|✔|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[gemini.google.com](https://gemini.google.com)|[Nodriver](https://gemini.google.com)|`g4f.Provider.Gemini`|`gemini-2.0, gemini-2.0-flash, gemini-2.5-pro, gemini-2.5-flash, gemini-2.0-flash-thinking, gemini-2.0-flash-thinking-with-apps _**(2+)**_`|✔|❌|❌|✔|![](https://img.shields.io/badge/Active-brightgreen)|
|[ai.google.dev](https://ai.google.dev)|[Get API key](https://aistudio.google.com/u/0/apikey)|`g4f.Provider.GeminiPro`|`gemini-1.5-pro, gemini-1.5-flash, gemini-2.0-flash`|❌|❌|❌|`gemini-1.5-pro`|![](https://img.shields.io/badge/Active-brightgreen)|
|[developers.sber.ru/gigachat](https://developers.sber.ru/gigachat)|[Cookies](https://developers.sber.ru/gigachat)|`g4f.Provider.GigaChat`|✔|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[github.com/copilot](https://github.com/copilot)|[Cookies](https://github.com/copilot)|`g4f.Provider.GithubCopilot`|✔|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[glhf.chat](https://glhf.chat)|[Get API key](https://glhf.chat/user-settings/api)|`g4f.Provider.GlhfChat`|✔|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[console.groq.com/playground](https://console.groq.com/playground)|[Get API key](https://console.groq.com/keys)|`g4f.Provider.Groq`|✔|❌|❌|❌|✔|![](https://img.shields.io/badge/Active-brightgreen)|
|[hailuo.ai](https://www.hailuo.ai)|No auth required|`g4f.Provider.HailuoAI`|✔|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[huggingface.co/chat](https://huggingface.co/chat)|[м](https://huggingface.co/chat)|`g4f.Provider.HuggingChat`|`llama-3.2-11b, llama-3.3-70b, mistral-nemo, phi-3.5-mini, command-r-plus, qwen-2.5-coder-32b, qwq-32b, deepseek-r1, nemotron-70b`|`flux-dev, flux-schnell`|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[huggingface.co](https://api-inference.huggingface.co)|[Get API key](https://huggingface.co/settings/tokens)|`g4f.Provider.HuggingFaceAPI`|✔|✔|❌|❌|✔|![](https://img.shields.io/badge/Active-brightgreen)|
|[huggingface.co](https://huggingface.co)|[Get API key](https://huggingface.co/settings/tokens)|`g4f.Provider.HuggingFaceInference`|✔|✔|❌|❌|✔|![](https://img.shields.io/badge/Active-brightgreen)|
|[huggingface.co](https://huggingface.co)|[Get API key](https://huggingface.co/settings/tokens)|`g4f.Provider.HuggingFaceMedia`|❌|❌|❌|✔|✔|![](https://img.shields.io/badge/Active-brightgreen)|
|[meta.ai](https://www.meta.ai)|[Cookies](https://www.meta.ai)|`g4f.Provider.MetaAI`|`meta-ai`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[meta.ai](https://www.meta.ai)|[Cookies](https://www.meta.ai)|`g4f.Provider.MetaAIAccount`|❌|`meta-ai`|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[designer.microsoft.com](https://designer.microsoft.com)|[Cookies](https://designer.microsoft.com)|`g4f.Provider.MicrosoftDesigner`|❌|`dall-e-3`|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[hailuo.ai/chat](https://www.hailuo.ai/chat)|[Get API key](https://intl.minimaxi.com/user-center/basic-information/interface-key)|`g4f.Provider.MiniMax`|✔|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[chatgpt.com](https://chatgpt.com)|[HAR file](https://chatgpt.com)|`g4f.Provider.OpenaiAccount`|✔|✔|❌|❌|✔|![](https://img.shields.io/badge/Active-brightgreen)|
|[platform.openai.com](https://platform.openai.com)|[Get API key](https://platform.openai.com/settings/organization/api-keys)|`g4f.Provider.OpenaiAPI`|✔|✔|❌|❌|✔|![](https://img.shields.io/badge/Active-brightgreen)|
|[chatgpt.com](https://chatgpt.com)|[HAR file](https://chatgpt.com)|`g4f.Provider.OpenaiChat`|`gpt-4, gpt-4.1, gpt-4.5, gpt-4o, gpt-4o-mini, o1, o1-mini, o3-mini, o3-mini-high, o4-mini, o4-mini-high` _**(1+)**_|✔|❌|❌|✔|![](https://img.shields.io/badge/Active-brightgreen)|
|[openrouter.ai](https://openrouter.ai)|[Get API key](https://openrouter.ai/settings/keys)|`g4f.Provider.OpenRouter`|✔|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[perplexity.ai](https://www.perplexity.ai)|[Get API key](https://www.perplexity.ai/settings/api)|`g4f.Provider.PerplexityApi`|✔ |❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[perplexity.ai](https://www.perplexity.ai)|[Get API key](https://www.perplexity.ai/settings/api)|`g4f.Provider.PerplexityApi`|✔|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[chat.reka.ai](https://chat.reka.ai)|[Cookies](https://chat.reka.ai)|`g4f.Provider.Reka`|`reka-core`|❌|❌|❌|✔|![](https://img.shields.io/badge/Active-brightgreen)|
|[replicate.com](https://replicate.com)|[Get API key](https://replicate.com/account/api-tokens)|`g4f.Provider.Replicate`|✔|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[beta.theb.ai](https://beta.theb.ai)|[Get API key](https://beta.theb.ai)|`g4f.Provider.ThebApi`|✔|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[whiterabbitneo.com](https://www.whiterabbitneo.com)|[Cookies](https://www.whiterabbitneo.com)|`g4f.Provider.WhiteRabbitNeo`|✔|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[console.x.ai](https://console.x.ai)|[Get API key](https://console.x.ai)|`g4f.Provider.xAI`|✔|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|

---
### Providers Local
| Website | API Credentials | Provider | Text generation | Image generation | Audio generation | Video generation | Vision (Image Upload) | Status |
|----------|-------------|--------------|---------------|--------|--------|------|------|------|
|[]( )|No auth required|`g4f.Provider.Local`|✔|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[ollama.com](https://ollama.com)|No auth required|`g4f.Provider.Ollama`|✔|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|

---
## Models

### Text generation models
| Model | Base Provider | Providers | Website |
|-------|---------------|-----------|---------|
|gpt-3.5-turbo|OpenAI|1 provider|[platform.openai.com](https://platform.openai.com/docs/engines/gpt-3.5-turbo)|
|gpt-4|OpenAI|7 providers|[platform.openai.com](https://platform.openai.com/docs/models/gpt-4-turbo-and-gpt-4)|
|gpt-4-turbo|OpenAI|1 provider|[platform.openai.com](https://platform.openai.com/docs/models/gpt-4-turbo-and-gpt-4)|
|gpt-4o|OpenAI|5 providers|[platform.openai.com](https://platform.openai.com/docs/models/gpt-4o)|
|gpt-4o-mini|OpenAI|6 providers|[platform.openai.com](https://platform.openai.com/docs/models/gpt-4o-mini)|
|gpt-4o-mini-audio|OpenAI|1 provider|[platform.openai.com](https://platform.openai.com/docs/models/gpt-4o-mini-audio-preview)|
|gpt-4o-mini-tts|OpenAI|1 provider|[platform.openai.com](https://platform.openai.com/docs/models/gpt-4o-mini-tts)|
|o1|OpenAI|3 providers|[openai.com](https://openai.com/index/introducing-openai-o1-preview/)|
|o1-mini|OpenAI|2 providers|[openai.com](https://openai.com/index/openai-o1-mini-advancing-cost-efficient-reasoning/)|
|o3|OpenAI|1 provider|[openai.com](https://openai.com/index/introducing-o3-and-o3-mini/)|
|o3-mini|OpenAI|2 provider|[openai.com](https://openai.com/index/introducing-o3-and-o3-mini/)|
|o3-mini-high|OpenAI|1 provider|[openai.com](https://openai.com/index/introducing-o3-and-o3-mini/)|
|o4-mini|OpenAI|3 providers|[openai.com](https://openai.com/index/introducing-o3-and-o4-mini/)|
|o4-mini-high|OpenAI|2 providers|[openai.com](https://openai.com/index/introducing-o3-and-o4-mini/)|
|gpt-4.1|OpenAI|3 providers|[openai.com](https://openai.com/index/gpt-4-1/)|
|gpt-4.1-mini|OpenAI|5 providers|[openai.com](https://openai.com/index/gpt-4-1/)|
|gpt-4.1-nano|OpenAI|3 providers|[openai.com](https://openai.com/index/gpt-4-1/)|
|gpt-4.5|OpenAI|1 providers|[openai.com](https://openai.com/index/gpt-4-5/)|
|meta-ai|Meta|1 provider|[ai.meta.com](https://ai.meta.com/)|
|llama-13b|Meta Llama|1 provider|[huggingface.co](https://huggingface.co/meta-llama/Llama-13b)|
|codellama-34b|Meta Llama|1 provider|[huggingface.co](https://huggingface.co/codellama/CodeLlama-34b)|
|llama-2-7b|Meta Llama|2 providers|[huggingface.co](https://huggingface.co/meta-llama/Llama-2-7b)|
|llama-2-13b|Meta Llama|1 provider|[huggingface.co](https://huggingface.co/meta-llama/Llama-2-13b)|
|llama-2-70b|Meta Llama|1 provider|[huggingface.co](https://huggingface.co/meta-llama/Llama-2-70b)|
|llama-3-8b|Meta Llama|2 providers|[ai.meta.com](https://ai.meta.com/blog/meta-llama-3/)|
|llama-3-70b|Meta Llama|1 provider|[ai.meta.com](https://ai.meta.com/blog/meta-llama-3/)|
|llama-3.1-8b|Meta Llama|3 providers|[ai.meta.com](https://ai.meta.com/blog/meta-llama-3-1/)|
|llama-3.1-70b|Meta Llama|2 provider|[ai.meta.com](https://ai.meta.com/blog/meta-llama-3-1/)|
|llama-3.1-405b|Meta Llama|1 provider|[ai.meta.com](https://ai.meta.com/blog/meta-llama-3-1/)|
|llama-3.2-1b|Meta Llama|2 providers|[huggingface.co](https://huggingface.co/meta-llama/Llama-3.2-1B)|
|llama-3.2-3b|Meta Llama|1 providers|[huggingface.co](https://huggingface.co/meta-llama/Llama-3.2-3B)|
|llama-3.2-11b|Meta Llama|2 providers|[ai.meta.com](https://ai.meta.com/blog/llama-3-2-connect-2024-vision-edge-mobile-devices/)|
|llama-3.2-90b|Meta Llama|1 provider|[huggingface.co](https://huggingface.co/meta-llama/Llama-3.2-90B-Vision)|
|llama-3.3-70b|Meta Llama|6 providers|[ai.meta.com](https://ai.meta.com/blog/llama-3-3/)|
|llama-4-scout|Meta Llama|3 providers|[llama.com](https://www.llama.com/models/llama-4/)|
|llama-4-maverick|Meta Llama|2 providers|[llama.com](https://www.llama.com/models/llama-4/)|
|mistral-7b|Mistral AI|1 providers|[huggingface.co](https://huggingface.co/mistralai/Mistral-7B-v0.1)|
|mixtral-8x7b|Mistral AI|2 providers|[huggingface.co](https://huggingface.co/mistralai/Mixtral-8x7B)|
|mixtral-8x22b|Mistral AI|2 providers|[huggingface.co](https://huggingface.co/mistralai/Mixtral-8x22B-Instruct-v0.1)|
|mistral-nemo|Mistral AI|2 providers|[huggingface.co](https://huggingface.co/mistralai/Mistral-Nemo-Instruct-2407)|
|mistral-small|Mistral AI|1 providers|[huggingface.co](https://huggingface.co/mistralai/Mistral-Small-24B-Instruct-2501)|
|mistral-small-24b|Mistral AI|2 providers|[huggingface.co](https://huggingface.co/mistralai/Mistral-Small-24B-Instruct-2501)|
|mistral-small-3.1-24b|Mistral AI|2 providers|[huggingface.co](https://huggingface.co/mistralai/Mistral-Small-3.1-24B-Instruct-2503)|
|mistral-large|Mistral AI|1 provider|[mistral.ai](https://mistral.ai/news/mistral-large/)|
|mistral-medium|Mistral AI|1 provider|[mistral.ai](https://mistral.ai/news/mistral-medium/)|
|mistral-next|Mistral AI|1 provider|[mistral.ai](https://mistral.ai/technology/)|
|pixtral-large|Mistral AI|1 provider|[mistral.ai](https://mistral.ai/news/pixtral-large/)|
|codestral|Mistral AI|1 provider|[mistral.ai](https://mistral.ai/news/codestral/)|
|hermes-2-dpo|NousResearch|1 provider|[huggingface.co](https://huggingface.co/NousResearch/Hermes-2-Pro-Llama-3-8B)|
|hermes-3-405b|NousResearch|1 provider|[huggingface.co](https://huggingface.co/NousResearch/Hermes-3-Llama-3.1-405B-FP8)|
|phi-3-small|Microsoft|1 provider|[huggingface.co](https://huggingface.co/microsoft/Phi-3-small)|
|phi-3-mini|Microsoft|1 provider|[huggingface.co](https://huggingface.co/microsoft/Phi-3-mini)|
|phi-3-medium|Microsoft|1 provider|[huggingface.co](https://huggingface.co/microsoft/Phi-3-medium)|
|phi-3.5-mini|Microsoft|1 provider|[huggingface.co](https://huggingface.co/microsoft/Phi-3.5-mini-instruct)|
|phi-4|Microsoft|4 providers|[techcommunity.microsoft.com](https://techcommunity.microsoft.com/blog/aiplatformblog/introducing-phi-4-microsoft%E2%80%99s-newest-small-language-model-specializing-in-comple/4357090)|
|phi-4-multimodal|Microsoft|2 providers|[huggingface.co](https://huggingface.co/microsoft/Phi-4-multimodal-instruct)|
|phi-4-reasoning-plus|Microsoft|1 provider|[huggingface.co](https://huggingface.co/microsoft/Phi-4-reasoning-plus)|
|wizardlm-2-7b|Microsoft|1 provider|[wizardlm.github.io](https://wizardlm.github.io/WizardLM2/)|
|wizardlm-2-8x22b|Microsoft|1 provider|[wizardlm.github.io](https://wizardlm.github.io/WizardLM2/)|
|gemini-2.0|Google|1 provider|[deepmind.google](http://deepmind.google/technologies/gemini/)|
|gemini-1.5-flash|Google|6 providers|[deepmind.google](https://deepmind.google/technologies/gemini/flash/)|
|gemini-1.5-pro|Google|6 providers|[deepmind.google](https://deepmind.google/technologies/gemini/pro/)|
|gemini-2.0-pro|Google|1 provider|[ai.google.dev](https://ai.google.dev/gemini-api/docs/thinking-mode)|
|gemini-2.0-flash|Google|3 providers|[deepmind.google](https://deepmind.google/technologies/gemini/flash/)|
|gemini-2.0-flash-thinking|Google|3 providers|[ai.google.dev](https://ai.google.dev/gemini-api/docs/thinking-mode)|
|gemini-2.0-flash-thinking-with-apps|Google|1 provider|[ai.google.dev](https://ai.google.dev/gemini-api/docs/thinking-mode)|
|gemini-2.5-flash|Google|3 providers|[deepmind.google](https://deepmind.google/technologies/gemini/)|
|gemini-2.5-pro|Google|2 providers|[deepmind.google](https://deepmind.google/technologies/gemini/)|
|gemma-2-2b|Google|1 provider|[huggingface.co](https://huggingface.co/google/gemma-2-2b)|
|gemma-2-9b|Google|1 providers|[huggingface.co](https://huggingface.co/google/gemma-2-9b)|
|gemma-2-27b|Google|1 provider|[huggingface.co](https://huggingface.co/google/gemma-2-27b)|
|gemma-3-4b|Google|1 providers|[huggingface.co](https://huggingface.co/google/gemma-3-4b-it)|
|gemma-3-12b|Google|2 providers|[huggingface.co](https://huggingface.co/google/gemma-3-12b-it)|
|gemma-3-27b|Google|2 providers|[huggingface.co](https://huggingface.co/google/gemma-3-27b-it)|
|claude-3-haiku|Anthropic|1 providers|[anthropic.com](https://www.anthropic.com/news/claude-3-haiku)|
|claude-3-sonnet|Anthropic|1 provider|[anthropic.com](https://www.anthropic.com/news/claude-3-sonnet)|
|claude-3-opus|Anthropic|1 provider|[anthropic.com](https://www.anthropic.com/news/claude-3-opus)|
|claude-3.5-haiku|Anthropic|1 provider|[anthropic.com](https://www.anthropic.com/news/claude-3-5-haiku)|
|claude-3.5-sonnet|Anthropic|1 providers|[anthropic.com](https://www.anthropic.com/news/claude-3-5-sonnet)|
|claude-3.7-sonnet|Anthropic|1 providers|[anthropic.com](https://www.anthropic.com/claude/sonnet)|
|claude-3.7-sonnet-thinking|Anthropic|1 provider|[anthropic.com](https://www.anthropic.com/claude/sonnet)|
|reka-core|Reka AI|2 providers|[reka.ai](https://www.reka.ai/ourmodels)|
|reka-flash|Reka AI|1 providers|[reka.ai](https://www.reka.ai/)|
|blackboxai|Blackbox AI|1 provider|[docs.blackbox.chat](https://docs.blackbox.chat/blackbox-ai-1)|
|command-r|CohereForAI|2 providers|[docs.cohere.com](https://docs.cohere.com/v2/docs/command-r-plus)|
|command-r-plus|CohereForAI|4 providers|[huggingface.co](https://huggingface.co/CohereLabs/c4ai-command-r-plus-08-2024)|
|command-r7b|CohereForAI|1 provider|[huggingface.co](https://huggingface.co/CohereLabs/c4ai-command-r7b-12-2024/blob/main/README.md)|
|command-a|CohereForAI|2 providers|[huggingface.co](https://huggingface.co/CohereLabs/c4ai-command-a-03-2025)|
|qwen-plus|Qwen|1 provider|[qwen-ai.com](https://www.qwen-ai.com/)|
|qwen-max|Qwen|1 provider|[qwen-ai.com](https://www.qwen-ai.com/)|
|qwen-vl-max|Qwen|1 provider|[qwen-ai.com](https://www.qwen-ai.com/)|
|qwen-14b|Qwen|1 provider|[huggingface.co](https://huggingface.co/Qwen/Qwen-14B)|
|qwen-1.5-4b|Qwen|1 provider|[huggingface.co](https://huggingface.co/Qwen/Qwen1.5-4B)|
|qwen-1.5-7b|Qwen|2 providers|[huggingface.co](https://huggingface.co/Qwen/Qwen1.5-7B)|
|qwen-1.5-14b|Qwen|1 provider|[huggingface.co](https://huggingface.co/Qwen/Qwen1.5-14B)|
|qwen-1.5-32b|Qwen|1 provider|[huggingface.co](https://huggingface.co/Qwen/Qwen1.5-32B)|
|qwen-1.5-72b|Qwen|1 provider|[huggingface.co](https://huggingface.co/Qwen/Qwen1.5-72B)|
|qwen-1.5-110b|Qwen|1 provider|[huggingface.co](https://huggingface.co/Qwen/Qwen1.5-110B)|
|qwen-2-72b|Qwen|3 providers|[huggingface.co](https://huggingface.co/Qwen/Qwen2-72B)|
|qwen-2-vl-7b|Qwen|1 provider|[huggingface.co](https://huggingface.co/Qwen/Qwen2-VL-7B)|
|qwen-2.5|Qwen|1 provider|[qwen-ai.com](https://www.qwen-ai.com/2-5/)|
|qwen-2.5-72b|Qwen|1 providers|[huggingface.co](https://huggingface.co/Qwen/Qwen2.5-72B-Instruct)|
|qwen-2.5-coder-32b|Qwen|4 providers|[huggingface.co](https://huggingface.co/Qwen/Qwen2.5-Coder-32B)|
|qwen-2.5-1m|Qwen|1 provider|[huggingface.co](https://huggingface.co/Qwen/Qwen2.5-1M-Demo)|
|qwen-2.5-max|Qwen|2 providers|[qwen-ai.com](https://www.qwen-ai.com/2-5-max/)|
|qwen-2.5-vl-32b|Qwen|1 providers|[huggingface.co](https://huggingface.co/Qwen/Qwen2.5-VL-32B-Instruct)|
|qwen-2.5-vl-72b|Qwen|1 providers|[huggingface.co](https://huggingface.co/Qwen/Qwen2.5-VL-72B-Instruct)|
|qwen-2.5-plus|Qwen|1 provider|[qwen-ai.com](https://www.qwen-ai.com/2-5-plus/)|
|qwen-3-235b|Qwen|3 providers|[huggingface.co](https://huggingface.co/Qwen/Qwen3-235B-A22B)|
|qwen-3-32b|Qwen|3 providers|[huggingface.co](https://huggingface.co/Qwen/Qwen3-32B)|
|qwen-3-30b|Qwen|3 providers|[huggingface.co](https://huggingface.co/Qwen/Qwen3-30B-A3B)|
|qwen-3-14b|Qwen|2 providers|[qwenlm.github.io](https://qwenlm.github.io/blog/qwen3/)|
|qwen-3-4b|Qwen|1 provider|[huggingface.co](https://huggingface.co/Qwen/Qwen3-4B-Base)|
|qwen-3-1.7b|Qwen|1 provider|[qwenlm.github.io](https://qwenlm.github.io/blog/qwen3/)|
|qwen-3-0.6b|Qwen|1 provider|[huggingface.co](https://huggingface.co/Qwen/Qwen3-0.6B)|
|qwq-32b|Qwen|4 providers|[huggingface.co](https://huggingface.co/Qwen/QwQ-32B-Preview)|
|pi|Inflection|1 provider|[inflection.ai](https://inflection.ai/blog/inflection-2-5)|
|deepseek-67b|DeepSeek|1 provider|[huggingface.co](https://huggingface.co/deepseek-ai/deepseek-llm-67b-base)|
|deepseek-v3|DeepSeek|3 providers|[api-docs.deepseek.com](https://api-docs.deepseek.com/news/news250120)|
|deepseek-r1|DeepSeek|6 providers|[api-docs.deepseek.com](https://api-docs.deepseek.com/news/news250120)|
|deepseek-r1-turbo|DeepSeek|1 provider|[huggingface.co](https://huggingface.co/deepseek-ai/DeepSeek-R1)|
|deepseek-r1-distill-llama-70b|DeepSeek|2 providers|[huggingface.co](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Llama-70B)|
|deepseek-r1-distill-qwen-32b|DeepSeek|2 providers|[huggingface.co](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-32B)|
|deepseek-v2|DeepSeek|1 provider|[huggingface.co](https://huggingface.co/deepseek-ai/DeepSeek-V2)|
|deepseek-coder-v2|DeepSeek|1 provider|[huggingface.co](https://huggingface.co/deepseek-ai/DeepSeek-Coder-V2)|
|deepseek-prover-v2|DeepSeek|1 provider|[github.com/deepseek-ai](https://github.com/deepseek-ai/DeepSeek-Prover-V2)|
|deepseek-prover-v2-671b|DeepSeek|1 provider|[github.com/deepseek-ai](https://github.com/deepseek-ai/DeepSeek-Prover-V2)|
|deepseek-v2.5|DeepSeek|1 provider|[huggingface.co](https://huggingface.co/deepseek-ai/DeepSeek-V2.5)|
|deepseek-v3-0324|DeepSeek|3 providers|[huggingface.co](https://huggingface.co/deepseek-ai/DeepSeek-V3-0324)|
|janus-pro-7b|DeepSeek|1 provider|[api-docs.deepseek.com](https://api-docs.deepseek.com/docs/janus-pro-7b)|
|grok-2|x.ai|2 providers|[x.ai](https://x.ai/blog/grok-2)|
|grok-2-mini|x.ai|1 provider|[x.ai](https://x.ai/blog/grok-2)|
|grok-3|x.ai|2 providers|[x.ai](https://x.ai/blog/grok-3)|
|grok-3-mini|x.ai|1 providers|[x.ai](https://x.ai/blog/grok-3)|
|grok-3-r1|x.ai|1 provider|[x.ai](https://x.ai/blog/grok-3)|
|sonar|Perplexity AI|1 provider|[sonar.perplexity.ai](https://sonar.perplexity.ai/)|
|sonar-pro|Perplexity AI|1 provider|[sonar.perplexity.ai](https://sonar.perplexity.ai/)|
|sonar-reasoning|Perplexity AI|1 provider|[sonar.perplexity.ai](https://sonar.perplexity.ai/)|
|sonar-reasoning-pro|Perplexity AI|1 provider|[sonar.perplexity.ai](https://sonar.perplexity.ai/)|
|r1-1776|Perplexity AI|1 provider|[perplexity.ai](https://www.perplexity.ai/hub/blog/open-sourcing-r1-1776)|
|pplx-7b-online|Perplexity AI|1 provider|[perplexity.ai](https://www.perplexity.ai/)|
|pplx-70b-online|Perplexity AI|1 provider|[perplexity.ai](https://www.perplexity.ai/)|
|nemotron-49b|Nvidia|1 providers|[huggingface.co](https://huggingface.co/nvidia/Llama-3_3-Nemotron-Super-49B-v1)|
|nemotron-51b|Nvidia|1 provider|[huggingface.co](https://huggingface.co/nvidia/Llama-3_1-Nemotron-51B-Instruct)|
|nemotron-70b|Nvidia|4 providers|[build.nvidia.com](https://build.nvidia.com/nvidia/llama-3_1-nemotron-70b-instruct)|
|nemotron-253b|Nvidia|1 providers|[build.nvidia.com](https://build.nvidia.com/nvidia/llama-3_1-nemotron-ultra-253b-v1/modelcard)|
|nemotron-4-340b|Nvidia|1 provider|[build.nvidia.com](https://build.nvidia.com/nvidia/nemotron-4-340b-instruct)|
|glm-4|THUDM|2 providers|[github.com/THUDM](https://github.com/THUDM/GLM-4)|
|glm-4-plus|THUDM|1 provider|[github.com/THUDM](https://github.com/THUDM/GLM-4)|
|dolphin-2.6|Cognitive Computations|1 provider|[huggingface.co](https://huggingface.co/cognitivecomputations/dolphin-2.6-mixtral-8x7b)|
|dolphin-2.9|Cognitive Computations|1 provider|[huggingface.co](https://huggingface.co/cognitivecomputations/dolphin-2.9.1-llama-3-70b)|
|airoboros-70b|DeepInfra|1 provider|[huggingface.co](https://huggingface.co/cognitivecomputations/dolphin-2.9.1-llama-3-70b)|
|lzlv-70b|Lizpreciatior|1 provider|[huggingface.co](https://huggingface.co/cognitivecomputations/dolphin-2.9.1-llama-3-70b)|
|lfm-40b|Liquid AI|1 provider|[liquid.ai](https://www.liquid.ai/liquid-foundation-models)|
|tulu-2-70b|Allen AI|1 provider|[huggingface.co](https://huggingface.co/allenai/tulu-2-dpo-70b)|
|tulu-3-8b|Allen AI|1 provider|[huggingface.co](https://huggingface.co/allenai/Llama-3.1-Tulu-3-8B)|
|tulu-3-70b|Allen AI|1 provider|[huggingface.co](https://huggingface.co/allenai/Llama-3.1-Tulu-3-70B)|
|openhermes-2.5-7b|Allen AI|1 provider|[huggingface.co](https://huggingface.co/teknium/OpenHermes-2.5-Mistral-7B)|
|dbrx-instruct|Databricks|1 provider|[huggingface.co](https://huggingface.co/databricks/dbrx-instruct)|
|evil|Evil Mode - Experimental|1 provider|[]()|

### Image generation models
| Model | Base Provider | Providers | Website |
|-------|---------------|-----------|---------|
|dall-e-3|OpenAI|5 providers|[platform.openai.com](https://platform.openai.com/docs/models/dall-e)|
|gpt-image|OpenAI|2 providers|[platform.openai.com](https://platform.openai.com/docs/models/gpt-image-1)|
|sdxl-1.0|Stability AI|1 providers|[huggingface.co](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0)|
|sdxl-l|Stability AI|1 providers|[huggingface.co](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0)|
|sdxl-turbo|Stability AI|2 providers|[huggingface.co](https://huggingface.co/stabilityai/sdxl-turbo)|
|sd-3.5-large|Stability AI|1 provider|[huggingface.co](https://huggingface.co/stabilityai/stable-diffusion-3.5-large)|
|flux|Black Forest Labs|4 providers|[blackforestlabs.ai](https://blackforestlabs.ai/announcing-flux/)|
|flux-pro|Black Forest Labs|2 provider|[blackforestlabs.ai](https://blackforestlabs.ai/flux-pro/)|
|flux-dev|Black Forest Labs|5 providers|[blackforestlabs.ai](https://blackforestlabs.ai/flux-dev/)|
|flux-schnell|Black Forest Labs|3 providers|[blackforestlabs.ai](https://blackforestlabs.ai/flux-schnell/)|
|midjourney|Midjourney|1 provider|[midjourney.com](https://www.midjourney.com/)|

## Conclusion and Usage Tips
This document provides a comprehensive overview of various AI providers and models available for text generation, image generation, and vision tasks. **When choosing a provider or model, consider the following factors:**
   1. **Availability**: Check the status of the provider to ensure it's currently active and accessible.
   2. **Model Capabilities**: Different models excel at different tasks. Choose a model that best fits your specific needs, whether it's text generation, image creation, or vision-related tasks.
   3. **Authentication**: Some providers require authentication, while others don't. Consider this when selecting a provider for your project.
   4. **Vision Models**: For tasks requiring image understanding or multimodal interactions, look for providers offering vision models.

Remember to stay updated with the latest developments in the AI field, as new models and providers are constantly emerging and evolving.

---

[Return to Documentation](README.md)
