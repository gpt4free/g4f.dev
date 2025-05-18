## G4F - Providers and Models

**Last updated:** May 18, 2025

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
- **Manual cookies** - Requires manual browser cookies setup. You need to be logged in to the provider's website to use their services.
- **Automatic cookies** - Browser cookies authentication that is automatically fetched. No manual setup needed.
- **Optional API key** - Works without authentication, but you can provide an API key for better rate limits or additional features. The service is usable without an API key.
- **API key / Cookies** - Supports both authentication methods. You can use either an API key or browser cookies for authentication.
- **No auth required** - No authentication needed. The service is publicly available without any credentials.
- **No auth / HAR file** - Supports both authentication methods. The service works without authentication, but you can also use HAR file authentication for potentially enhanced features or capabilities.

**Symbols:**
- ✔ - Feature is supported
- ❌ - Feature is not supported
- ✔ _**(n+)**_ - Number of additional models supported by the provider but not publicly listed

---
### Providers No auth required
| Website | API Credentials | Provider | Text generation | Image generation | Audio generation | Video generation | Vision (Image Upload) | Status |
|----------|-------------|--------------|---------------|--------|--------|------|------|------|
|[ai-arta.com](https://ai-arta.com)|No auth required|`g4f.Provider.ARTA`|❌|`flux` _**(16+)**_|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[blackbox.ai](https://www.blackbox.ai)|No auth required|`g4f.Provider.Blackbox`|`blackboxai, o3-mini, gpt-4, gpt-4o, gpt-4o-mini, gpt-4.1-nano, claude-3.7-sonnet, claude-3.5-sonnet, deepseek-r1, deepseek-r1-zero, deepseek-r1-distill-llama-70b, deepseek-r1-distill-qwen-14b, deepseek-r1-distill-qwen-32b, reka-flash, gemini-2.0-flash, gemma-2-9b, gemma-3-12b, gemma-3-1b, gemma-3-27b, gemma-3-4b, llama-3.2-11b, llama-3.2-1b, llama-3.2-3b, llama-3.3-70b, llama-3.1-8b, llama-4-scout, llama-4-maverick, nemotron-49b, nemotron-253b, mistral-7b, mistral-small-24b, mistral-nemo, mistral-small, mistral-small-3.1-24b, qwen-2.5-72b, qwen-2.5-7b, qwen-2.5-coder-32b, qwen-2.5-vl-3b, qwen-2.5-vl-7b, qwen-2.5-vl-32b, qwen-2.5-vl-72b, qwq-32b, qwq-32b-preview, qwq-32b-arliai, deepcoder-14b, deephermes-3-8b, dolphin-3.0-24b, dolphin-3.0-r1-24b, kimi-vl-a3b-thinking, molmo-7b, moonlight-16b, qwerky-72b`|❌|❌|❌|`blackboxai, gpt-4o, o3-mini`|![](https://img.shields.io/badge/Active-brightgreen)|
|[chatai.aritek.app](https://chatai.aritek.app)|No auth required|`g4f.Provider.Chatai`|`gpt-4o-mini`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[chatglm.cn](https://chatglm.cn)|No auth required|`g4f.Provider.ChatGLM`|`glm-4`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[chatgpt.com](https://chatgpt.com)|No auth required|`g4f.Provider.ChatGpt`|✔ _**(7+)**_|❌|❌|❌|❌|![Error](https://img.shields.io/badge/HTTPError-f48d37)|
|[playground.ai.cloudflare.com](https://playground.ai.cloudflare.com)|[Automatic cookies](https://playground.ai.cloudflare.com)|`g4f.Provider.Cloudflare`|`llama-2-7b, llama-3-8b, llama-3.1-8b, llama-3.2-1b, qwen-1.5-7b`|❌|❌|❌|❌|![Error](https://img.shields.io/badge/Active-brightgreen)|
|[copilot.microsoft.com](https://copilot.microsoft.com)|Optional API key|`g4f.Provider.Copilot`|`gpt-4, o1`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[duckduckgo.com/aichat](https://duckduckgo.com/aichat)|No auth required|`g4f.Provider.DDG`|`gpt-4. gpt-4o, gpt-4o-mini, llama-3.3-70b, claude-3-haiku, o3-mini, mistral-small-24b, mistral-small`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[duckduckgo.com/aichat](https://duckduckgo.com/aichat)|No auth required|`g4f.Provider.DuckDuckGo`|✔|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[deepinfra.com/chat](https://deepinfra.com/chat)|No auth required|`g4f.Provider.DeepInfraChat`|`deepseek-prover-v2-671b, qwen-3-235b, qwen-3-30b, qwen-3-32b, qwen-3-14b, llama-4-maverick, llama-4-maverick-17b, llama-4-maverick, llama-4-maverick-17b, phi-4-reasoning-plus, qwq-32b, deepseek-v3-0324, gemma-3-27b, gemma-3-12b, phi-4-multimodal, llama-3.1-8b, llama-3.2-90b, llama-3.3-70b, deepseek-v3, mixtral-small-24b, deepseek-r1-turbo, deepseek-r1, deepseek-r1-distill-llama-70b, deepseek-r1-distill-qwen-32b, phi-4, wizardlm-2-8x22b, qwen-2-72b, dolphin-2.6, dolphin-2.9, airoboros-70b, lzlv-70b, wizardlm-2-7b, mixtral-8x22b`|❌|❌|❌|`llama-3.2-90b, minicpm-2.5`|![](https://img.shields.io/badge/Active-brightgreen)|
|[dynaspark.onrender.com](https://dynaspark.onrender.com)|No auth required|`g4f.Provider.Dynaspark`|`gemini-1.5-flash, gemini-2.0-flash`|❌|❌|❌|`gemini-1.5-flash, gemini-2.0-flash`|![](https://img.shields.io/badge/Active-brightgreen)|
|[chat10.free2gpt.xyz](https://chat10.free2gpt.xyz)|No auth required|`g4f.Provider.Free2GPT`|`gemini-1.5-pro, gemini-1.5-flash`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[freegptsnav.aifree.site](https://freegptsnav.aifree.site)|No auth required|`g4f.Provider.FreeGpt`|`gemini-1.5-pro, gemini-1.5-flash`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[app.giz.ai/assistant](https://app.giz.ai/assistant)|No auth required|`g4f.Provider.GizAI`|`gemini-1.5-flash`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[glider.so](https://glider.so)|No auth required|`g4f.Provider.Glider`|`llama-3.1-70b, llama-3.1-8b, llama-3.2-3b, deepseek-r1`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[goabror.uz](https://goabror.uz)|No auth required|`g4f.Provider.Goabror`|`gpt-4`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[hailuo.ai](https://www.hailuo.ai)|No auth required|`g4f.Provider.HailuoAI`|`minimax` _**(1+)**_|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[editor.imagelabs.net](editor.imagelabs.net)|No auth required|`g4f.Provider.ImageLabs`|❌|`sdxl-turbo`|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[huggingface.co/spaces](https://huggingface.co/spaces)|Optional API key|`g4f.Provider.HuggingSpace`|`qvq-72b, qwen-2-72b, qwen-3-235b, qwen-3-32b, qwen-3-30b, qwen-3-14b, qwen-3-4b, qwen-3-1.7b, qwen-3-0.6b, command-r-plus, command-r, command-r7b`|`flux-dev, flux-schnell, sd-3.5`|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[lambda.chat](https://lambda.chat)|No auth required|`g4f.Provider.LambdaChat`|`deepseek-v3, deepseek-r1, hermes-3, hermes-3-405b, nemotron-70b, llama-3.3-70b, qwen-2.5-coder-32b`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[liaobots.work](https://liaobots.work)|[Automatic cookies](https://liaobots.work)|`g4f.Provider.Liaobots`|`claude-3.5-sonnet, claude-3.7-sonnet, deepseek-v3, gemini-1.0-pro, gemini-2.0-flash, gemini-2.0-flash-thinking, gemini-2.5-pro, gpt-4-turbo, gpt-4.1, gpt-4.1-mini, gpt-4, gpt-4o, gpt-4o-mini, grok-3, grok-3-r1, o3-mini, qwen-3-235b`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[oi-vscode-server-2.onrender.com](https://oi-vscode-server-2.onrender.com)|No auth required|`g4f.Provider.OIVSCodeSer2`|`gpt-4o-mini`|❌|❌|❌|✔|![Error](https://img.shields.io/badge/Active-brightgreen)|
|[oi-vscode-server-2.onrender.com](https://oi-vscode-server-2.onrender.com)|No auth required|`g4f.Provider.OIVSCodeSer5`|`gpt-4.1-mini`|❌|❌|❌|✔|![Error](https://img.shields.io/badge/Active-brightgreen)|
|[oi-vscode-server-2.onrender.com](https://oi-vscode-server-2.onrender.com)|No auth required|`g4f.Provider.OIVSCodeSer0501`|`gpt-4.1-mini`|❌|❌|❌|✔|![Error](https://img.shields.io/badge/Active-brightgreen)|
|[labs.perplexity.ai](https://labs.perplexity.ai)|No auth required|`g4f.Provider.PerplexityLabs`|`sonar, sonar-pro, sonar-reasoning, sonar-reasoning-pro`|❌|❌|❌|❌|![Error](https://img.shields.io/badge/Active-brightgreen)|
|[pi.ai/talk](https://pi.ai/talk)|[Manual cookies](https://pi.ai/talk)|`g4f.Provider.Pi`|`pi`|❌|❌|❌|❌|![Error](https://img.shields.io/badge/Active-brightgreen)|
|[pizzagpt.it](https://www.pizzagpt.it)|No auth required|`g4f.Provider.Pizzagpt`|`gpt-4o-mini`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[pollinations.ai](https://pollinations.ai)|No auth required|`g4f.Provider.PollinationsAI`|`gpt-4o-mini, gpt-4.1-mini, gpt-4.1-nano, gpt-4, gpt-4o, gpt-4.1, o4-mini, command-r-plus-08-2024, gemini-2.5-flash, gemini-2.0-flash-thinking, qwen-2.5-coder-32b, llama-3.3-70b, llama-4-scout, llama-4-scout-17b, mistral-small-3.1-24b, deepseek-r1, deepseek-r1-distill-llama-70b, evil, deepseek-r1-distill-qwen-32b, phi-4, qwq-32b, deepseek-v3, deepseek-v3-0324` _**(4+)**_|`flux, flux-pro, flux-dev, flux-schnell, dall-e-3, sdxl-turbo`|`gpt-4o-audio`|❌|`gpt-4o, gpt-4o-mini, o1-mini, o3-mini, o4-mini`|![](https://img.shields.io/badge/Active-brightgreen)|
|[pollinations.ai](https://pollinations.ai)|No auth required|`g4f.Provider.PollinationsImage`|❌|`flux, flux-pro, flux-dev, flux-schnell, dall-e-3, sdxl-turbo`|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[docs.puter.com](https://docs.puter.com/playground)|No auth required|`g4f.Provider.PuterJS`|`gpt-4, gpt-4o, gpt-4o-mini, o1, o1-mini, o1-pro, o3, o3-mini, o4-mini, gpt-4.1, gpt-4.1-mini, gpt-4.1-nano, gpt-4.5-preview, claude-3.7-sonnet, claude-3.5-sonnet, claude-3-haiku, ministral-3b, ministral-8b, mistral-7b, mistral-tiny, mixtral-8x7b, mistral-small, mixtral-8x22b, mistral-large, pixtral-large, codestral, pixtral-12b, deepseek-v3, deepseek-v3-0324, deepseek-r1, gemini-1.5-flash, gemini-2.0-flash, llama-2-70b, llama-3-8b, llama-3-70b, llama-3.1-8b, llama-3.1-70b, llama-3.1-405b, llama-3.2-1b, llama-3.2-3b, llama-3.2-11b, llama-3.2-90, llama-3.3-8b, llama-3.3-70b, llama-4-maverick, llama-4-scout, gpt-3.5-turbo, gpt-4-turbo, gpt-4o-search, gpt-4o-mini-search, o3-mini-high, o4-mini-high, gpt-4.5, mistral-medium, mistral-nemo, mistral-saba, phi-3-mini, phi-3-medium, phi-3.5-mini, phi-4, phi-4-multimodal, phi-4-reasoning, phi-4-reasoning-plus, wizardlm-2-8x22b, mai-ds-r1, claude-3.7-sonnet-thinking, claude-3.5-haiku, claude-3-opus, claude-3-sonnet, claude-2.1, claude-2, claude-2.0, reka-flash, command-r7b, command-r-plus, command, command-r, command-a, qwq-32b, qwen-vl-plus, qwen-vl-max, qwen-turbo, qwen-2.5-vl-72b, qwen-plus, qwen-max, qwen-2.5-coder-32b, qwen-2.5-7b, qwen-2.5-72b, qwen-2.5-vl-7b, qwen-2-72b, qwen-3-0.6b, qwen-3-1.7b, qwen-3-4b, qwen-3-30b, qwen-3-8b, qwen-3-14b, qwen-3-32b, qwen-3-235b, qwen-2.5-coder-7b, qwen-2.5-vl-3b, qwen-2.5-vl-32b, deepseek-prover-v2, deepseek-r1-zero, deepseek-r1-distill-llama-8b, deepseek-r1-distill-qwen-1.5b, deepseek-r1-distill-qwen-32b, deepseek-r1-distill-qwen-14b, deepseek-r1-distill-llama-70b, deepseek-chat, deepseek-coder, sonar-reasoning-pro, sonar-pro, sonar-deep-research, r1-1776, sonar-reasoning, sonar, llama-3.1-sonar-small-online, llama-3.1-sonar-large-online, glm-4, glm-4-32b, glm-z1-32b, glm-4-9b, glm-z1-9b, glm-z1-rumination-32b, minimax, dolphin-3.0-r1-24b, dolphin-3.0-24b, dolphin-8x22b, lfm-7b, lfm-3b, lfm-40b`|❌|❌|❌|✔|![](https://img.shields.io/badge/Active-brightgreen)|
|[teach-anything.com](https://www.teach-anything.com)|No auth required|`g4f.Provider.TeachAnything`|`gemini-1.5-pro, gemini-1.5-flash`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[you.com](https://you.com)|[Manual cookies](https://you.com)|`g4f.Provider.You`|✔|✔|❌|❌|✔|![](https://img.shields.io/badge/Active-brightgreen)|
|[websim.ai](https://websim.ai)|No auth required|`g4f.Provider.Websim`|`gemini-1.5-pro, gemini-1.5-flash`|`flux`|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[chat-gpt.com](https://chat-gpt.com)|No auth required|`g4f.Provider.WeWordle`|`gpt-4`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[chat9.yqcloud.top](https://chat9.yqcloud.top)|No auth required|`g4f.Provider.Yqcloud`|`gpt-4`|✔|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|

---
### Providers HuggingFace
| Website | API Credentials | Provider | Text generation | Image generation | Audio generation | Video generation | Vision (Image Upload) | Status |
|----------|-------------|--------------|---------------|--------|--------|------|------|------|
|[huggingface.co/chat](https://huggingface.co/chat)|[Manual cookies](https://huggingface.co/chat)|`g4f.Provider.HuggingChat`|`qwen-2.5-72b, llama-3.3-70b, command-r-plus, deepseek-r1, qwq-32b, nemotron-70b, llama-3.2-11b, mistral-nemo, phi-3.5-mini`|`flux-dev, flux-schnell`|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[huggingface.co/chat](https://huggingface.co/chat)|[API key / Cookies](https://huggingface.co/settings/tokens)|`g4f.Provider.HuggingFace`|✔ _**(47+)**_|✔ _**(9+)**_|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[api-inference.huggingface.co](https://api-inference.huggingface.co)|[Get API key](https://huggingface.co/settings/tokens)|`g4f.Provider.HuggingFaceAPI`|✔ _**(9+)**_|✔ _**(2+)**_|❌|❌|✔ _**(1+)**_|![](https://img.shields.io/badge/Active-brightgreen)|

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
|[qwen-qvq-72b-preview.hf.space](https://qwen-qvq-72b-preview.hf.space)|[Get API key](https://huggingface.co/settings/tokens)|`g4f.Provider.Qwen_QVQ_72B`|`qvq-72b`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[qwen-qwen2-5.hf.space](https://qwen-qwen2-5.hf.space)|[Get API key](https://huggingface.co/settings/tokens)|`g4f.Provider.Qwen_Qwen_2_5`|`qwen-2.5`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[qwen-qwen2-5-1m-demo.hf.space](https://qwen-qwen2-5-1m-demo.hf.space)|[Get API key](https://huggingface.co/settings/tokens)|`g4f.Provider.Qwen_Qwen_2_5M`|`qwen-2.5-1m`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[qwen-qwen2-5-max-demo.hf.space](https://qwen-qwen2-5-max-demo.hf.space)|[Get API key](https://huggingface.co/settings/tokens)|`g4f.Provider.Qwen_Qwen_2_5_Max`|`qwen-2-5-max`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[qwen-qwen2-72b-instruct.hf.space](https://qwen-qwen2-72b-instruct.hf.space)|[Get API key](https://huggingface.co/settings/tokens)|`g4f.Provider.Qwen_Qwen_2_72B`|`qwen-2-72b`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[qwen-qwen2-72b-instruct.hf.space](https://qwen-qwen2-72b-instruct.hf.space)|[Get API key](https://huggingface.co/settings/tokens)|`g4f.Provider.Qwen_Qwen_3`|`qwen-3-235b, qwen-3-32b, qwen-3-30b, qwen-3-14b, qwen-3-4b, qwen-3-1.7b, qwen-3-0.6b`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[stabilityai-stable-diffusion-3-5-large.hf.space](https://stabilityai-stable-diffusion-3-5-large.hf.space)|[Get API key](https://huggingface.co/settings/tokens)|`g4f.Provider.StabilityAI_SD35Large`|❌|`sd-3.5`|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[voodoohop-flux-1-schnell.hf.space](https://voodoohop-flux-1-schnell.hf.space)|[Get API key](https://huggingface.co/settings/tokens)|`g4f.Provider.Voodoohop_Flux1Schnell`|❌|`flux, flux-schnell`|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|

### Providers Local
| Website | API Credentials | Provider | Text generation | Image generation | Audio generation | Video generation | Vision (Image Upload) | Status |
|----------|-------------|--------------|---------------|--------|--------|------|------|------|
|[]( )|No auth required|`g4f.Provider.Local`|✔|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[ollama.com](https://ollama.com)|No auth required|`g4f.Provider.Ollama`|✔|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|

---
### Providers MiniMax
| Website | API Credentials | Provider | Text generation | Image generation | Audio generation | Video generation | Vision (Image Upload) | Status |
|----------|-------------|--------------|---------------|--------|--------|------|------|------|
|[hailuo.ai/chat](https://www.hailuo.ai/chat)|[Get API key](https://intl.minimaxi.com/user-center/basic-information/interface-key)|`g4f.Provider.MiniMax`|`minimax`  _**(1+)**_|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|

---
### Providers Needs Auth
| Website | API Credentials | Provider | Text generation | Image generation | Audio generation | Video generation | Vision (Image Upload) | Status |
|----------|-------------|--------------|---------------|--------|--------|------|------|------|
|[console.anthropic.com](https://console.anthropic.com)|[Get API key](https://console.anthropic.com/settings/keys)|`g4f.Provider.Anthropic`|✔ _**(8+)**_|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[bing.com/images/create](https://www.bing.com/images/create)|[Manual cookies](https://www.bing.com)|`g4f.Provider.BingCreateImages`|❌|`dall-e-3`|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[blackbox.ai](https://www.blackbox.ai)|[Manual cookies](https://www.blackbox.ai)|`g4f.Provider.BlackboxPro`|✔|✔|❌|❌|✔|![](https://img.shields.io/badge/Active-brightgreen)|
|[cablyai.com/chat](https://cablyai.com/chat)|[Get API key](https://cablyai.com)|`g4f.Provider.CablyAI`|✔|✔|❌|❌|✔|![](https://img.shields.io/badge/Active-brightgreen)|
|[inference.cerebras.ai](https://inference.cerebras.ai/)|[Get API key](https://cloud.cerebras.ai)|`g4f.Provider.Cerebras`|✔ _**(3+)**_|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[copilot.microsoft.com](https://copilot.microsoft.com)|[Manual cookies](https://copilot.microsoft.com)|`g4f.Provider.CopilotAccount`|✔ _**(1+)**_|✔ _**(1+)**_|❌|❌|✔ _**(1+)**_|![](https://img.shields.io/badge/Active-brightgreen)|
|[deepinfra.com](https://deepinfra.com)|[Get API key](https://deepinfra.com/dash/api_keys)|`g4f.Provider.DeepInfra`|✔ _**(17+)**_|✔ _**(6+)**_|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[platform.deepseek.com](https://platform.deepseek.com)|[Get API key](https://platform.deepseek.com/api_keys)|`g4f.Provider.DeepSeek`|✔ _**(1+)**_|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[gemini.google.com](https://gemini.google.com)|[Manual cookies](https://gemini.google.com)|`g4f.Provider.Gemini`|`gemini-2.0`|`gemini-2.0`|❌|❌|`gemini-2.0`|![](https://img.shields.io/badge/Active-brightgreen)|
|[ai.google.dev](https://ai.google.dev)|[Get API key](https://aistudio.google.com/u/0/apikey)|`g4f.Provider.GeminiPro`|`gemini-1.5-flash, gemini-1.5-pro, gemini-2.0-flash`|❌|❌|❌|`gemini-1.5-pro`|![](https://img.shields.io/badge/Active-brightgreen)|
|[developers.sber.ru/gigachat](https://developers.sber.ru/gigachat)|[Manual cookies](https://developers.sber.ru/gigachat)|`g4f.Provider.GigaChat`|✔ _**(6+)**_|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[github.com/copilot](https://github.com/copilot)|[Manual cookies](https://github.com/copilot)|`g4f.Provider.GithubCopilot`|✔ _**(4+)**_|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[glhf.chat](https://glhf.chat)|[Get API key](https://glhf.chat/user-settings/api)|`g4f.Provider.GlhfChat`|✔ _**(22+)**_|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[console.groq.com/playground](https://console.groq.com/playground)|[Get API key](https://console.groq.com/keys)|`g4f.Provider.Groq`|✔ _**(18+)**_|❌|❌|❌|✔|![](https://img.shields.io/badge/Active-brightgreen)|
|[meta.ai](https://www.meta.ai)|[Manual cookies](https://www.meta.ai)|`g4f.Provider.MetaAI`|`meta-ai`|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[meta.ai](https://www.meta.ai)|[Manual cookies](https://www.meta.ai)|`g4f.Provider.MetaAIAccount`|❌|`meta-ai`|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[designer.microsoft.com](https://designer.microsoft.com)|[Manual cookies](https://designer.microsoft.com)|`g4f.Provider.MicrosoftDesigner`|❌|`dall-e-3`|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[platform.openai.com](https://platform.openai.com)|[Get API key](https://platform.openai.com/settings/organization/api-keys)|`g4f.Provider.OpenaiAPI`|✔|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[chatgpt.com](https://chatgpt.com)|[Manual cookies](https://chatgpt.com)|`g4f.Provider.OpenaiChat`|`gpt-4o, gpt-4o-mini, gpt-4` _**(8+)**_|✔ _**(1)**_|❌|❌|✔ _**(8+)**_|![](https://img.shields.io/badge/Active-brightgreen)|
|[perplexity.ai](https://www.perplexity.ai)|[Get API key](https://www.perplexity.ai/settings/api)|`g4f.Provider.PerplexityApi`|✔ _**(6+)**_|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[chatgpt.com](https://chatgpt.com)|[Manual cookies](https://chatgpt.com)|`g4f.Provider.OpenaiChat`|`gpt-4o, gpt-4o-mini, gpt-4` _**(8+)**_|✔ _**(1)**_|❌|❌|✔ _**(8+)**_|![](https://img.shields.io/badge/Active-brightgreen)|
|[perplexity.ai](https://www.perplexity.ai)|[Get API key](https://www.perplexity.ai/settings/api)|`g4f.Provider.PerplexityApi`|✔ _**(6+)**_|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[chat.reka.ai](https://chat.reka.ai)|[Manual cookies](https://chat.reka.ai)|`g4f.Provider.Reka`|`reka-core`|✔|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[replicate.com](https://replicate.com)|[Get API key](https://replicate.com/account/api-tokens)|`g4f.Provider.Replicate`|✔ _**(1+)**_|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[beta.theb.ai](https://beta.theb.ai)|[Get API key](https://beta.theb.ai)|`g4f.Provider.ThebApi`|✔ _**(21+)**_|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[whiterabbitneo.com](https://www.whiterabbitneo.com)|[Manual cookies](https://www.whiterabbitneo.com)|`g4f.Provider.WhiteRabbitNeo`|✔|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|
|[console.x.ai](https://console.x.ai)|[Get API key](https://console.x.ai)|`g4f.Provider.xAI`|✔|❌|❌|❌|❌|![](https://img.shields.io/badge/Active-brightgreen)|

---
## Models

### Text generation models
| Model | Base Provider | Providers | Website |
|-------|---------------|-----------|---------|
|gpt-3.5-turbo|OpenAI|1+ provider|[platform.openai.com](https://platform.openai.com/docs/engines/gpt-3.5-turbo)|
|gpt-4|OpenAI|9+ providers|[platform.openai.com](https://platform.openai.com/docs/models/gpt-4-turbo-and-gpt-4)|
|gpt-4-turbo|OpenAI|2+ providers|[platform.openai.com](https://platform.openai.com/docs/models/gpt-4-turbo-and-gpt-4)|
|gpt-4o|OpenAI|5+ providers|[platform.openai.com](https://platform.openai.com/docs/models/gpt-4o)|
|gpt-4o-search|OpenAI|1 provider|[openai.com](https://openai.com/index/introducing-chatgpt-search/)|
|gpt-4o-mini|OpenAI|8+ providers|[platform.openai.com](https://platform.openai.com/docs/models/gpt-4o-mini)|
|gpt-4o-mini-search|OpenAI|1 provider|[openai.com](https://openai.com/index/gpt-4o-mini-advancing-cost-efficient-intelligence/)|
|gpt-4o-audio|OpenAI|1 provider|[platform.openai.com](https://platform.openai.com/docs/models/gpt-4o-audio)|
|o1|OpenAI|3+ providers|[openai.com](https://openai.com/index/introducing-openai-o1-preview/)|
|o1-mini|OpenAI|2+ providers|[openai.com](https://openai.com/index/openai-o1-mini-advancing-cost-efficient-reasoning/)|
|o1-pro|OpenAI|1 provider|[openai.com](https://openai.com/index/introducing-chatgpt-pro/)|
|o3|OpenAI|1 provider|[openai.com](https://openai.com/index/introducing-o3-and-o4-mini/)|
|o3-mini|OpenAI|4+ providers|[openai.com](https://openai.com/index/openai-o3-mini/)|
|o3-mini-high|OpenAI|1 provider|[openai.com](https://openai.com/index/openai-o3-mini/)|
|o4-mini|OpenAI|2+ providers|[openai.com](https://openai.com/index/introducing-o3-and-o4-mini/)|
|o4-mini-high|OpenAI|1 provider|[openai.com](https://openai.com/index/introducing-o3-and-o4-mini/)|
|gpt-4.1|OpenAI|3+ providers|[openai.com](https://openai.com/index/gpt-4-1/)|
|gpt-4.1-mini|OpenAI|5+ providers|[openai.com](https://openai.com/index/gpt-4-1/)|
|gpt-4.1-nano|OpenAI|3+ providers|[openai.com](https://openai.com/index/gpt-4-1/)|
|gpt-4.5|OpenAI|1 provider|[openai.com](https://openai.com/index/introducing-gpt-4-5/)|
|meta-ai|Meta|1 provider|[ai.meta.com](https://ai.meta.com/)|
|llama-2-7b|Meta Llama|1 provider|[huggingface.co](https://huggingface.co/meta-llama/Llama-2-7b)|
|llama-2-70b|Meta Llama|1 provider|[huggingface.co](https://huggingface.co/meta-llama/Llama-2-70b)|
|llama-3-8b|Meta Llama|2+ providers|[ai.meta.com](https://ai.meta.com/blog/meta-llama-3/)|
|llama-3-70b|Meta Llama|1 provider|[huggingface.co](https://huggingface.co/meta-llama/Meta-Llama-3-70B)|
|llama-3.1-8b|Meta Llama|4+ providers|[ai.meta.com](https://ai.meta.com/blog/meta-llama-3-1/)|
|llama-3.1-70b|Meta Llama|1 provider|[huggingface.co](https://huggingface.co/meta-llama/Llama-3.1-70B)|
|llama-3.1-405b|Meta Llama|2+ providers|[huggingface.co](https://huggingface.co/meta-llama/Llama-3.1-405B)|
|llama-3.2-1b|Meta Llama|3+ providers|[huggingface.co](https://huggingface.co/meta-llama/Llama-3.2-1B)|
|llama-3.2-3b|Meta Llama|2+ providers|[huggingface.co](https://huggingface.co/meta-llama/Llama-3.2-3B)|
|llama-3.2-11b|Meta Llama|4+ providers|[ai.meta.com](https://ai.meta.com/blog/llama-3-2-connect-2024-vision-edge-mobile-devices/)|
|llama-3.2-90b|Meta Llama|2+ providers|[huggingface.co](https://huggingface.co/meta-llama/Llama-3.2-90B-Vision)|
|llama-3.3-8b|Meta Llama|1 provider|[huggingface.co](https://huggingface.co/meta-llama/Meta-Llama-3-8B)|
|llama-3.3-70b|Meta Llama|8+ providers|[ai.meta.com](https://ai.meta.com/blog/llama-3-3/)|
|llama-4-scout|Meta Llama|4+ providers|[llama.com](https://www.llama.com/models/llama-4/)|
|llama-4-scout-17b|Meta Llama|2+ providers|[llama.com](https://www.llama.com/models/llama-4/)|
|llama-4-maverick|Meta Llama|3+ providers|[llama.com](https://www.llama.com/models/llama-4/)|
|llama-4-maverick-17b|Meta Llama|1 provider|[huggingface.co](https://huggingface.co/meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8)|
|ministral-3b|Mistral AI|1 provider|[huggingface.co](https://huggingface.co/ministral/Ministral-3b-instruct)|
|ministral-8b|Mistral AI|1 provider|[huggingface.co](https://huggingface.co/mistralai/Ministral-8B-Instruct-2410)|
|mistral-7b|Mistral AI|2+ providers|[huggingface.co](https://huggingface.co/mistralai/Mistral-7B-v0.1)|
|mixtral-8x7b|Mistral AI|1 provider|[huggingface.co](https://huggingface.co/mistralai/Mixtral-8x22B-Instruct-v0.1)|
|mixtral-8x22b|Mistral AI|2+ providers|[huggingface.co](https://huggingface.co/mistralai/Mixtral-8x22B-Instruct-v0.1)|
|pixtral-12b|Mistral AI|1 provider|[huggingface.co](https://huggingface.co/mistralai/Pixtral-Large-Instruct-2411)|
|mistral-tiny|Mistral AI|1 provider|[docs.mistral.ai](https://docs.mistral.ai/getting-started/models/models_overview/)|
|mistral-saba|Mistral AI|1 provider|[mistral.ai](https://mistral.ai/news/mistral-saba)|
|pixtral-large|Mistral AI|1 provider|[huggingface.co](https://huggingface.co/mistralai/Pixtral-12B-2409)|
|codestral|Mistral AI|1 provider|[mistral.ai](https://mistral.ai/news/codestral)|
|mistral-large|Mistral AI|1 provider|[docs.mistral.ai](https://docs.mistral.ai/getting-started/models/models_overview/)|
|mistral-nemo|Mistral AI|4+ providers|[huggingface.co](https://huggingface.co/mistralai/Mistral-Nemo-Instruct-2407)|
|mistral-small|Mistral AI|4+ providers|[huggingface.co](https://huggingface.co/mistralai/Mistral-Small-24B-Instruct-2501)|
|mistral-small-24b|Mistral AI|3+ providers|[huggingface.co](https://huggingface.co/mistralai/Mistral-Small-24B-Instruct-2501)|
|mistral-small-3.1-24b|Mistral AI|2+ providers|[huggingface.co](https://huggingface.co/mistralai/Mistral-Small-3.1-24B-Instruct-2503)|
|hermes-2-dpo|NousResearch|1 provider|[huggingface.co](https://huggingface.co/NousResearch/Nous-Hermes-2-Mistral-7B-DPO)|
|hermes-2-pro|NousResearch|1 provider|[huggingface.co](https://huggingface.co/NousResearch/Hermes-2-Pro-Mistral-7B)|
|hermes-3-70b|NousResearch|1 provider|[huggingface.co](https://huggingface.co/NousResearch/Hermes-3-Llama-3.1-70B)|
|hermes-3-405b|NousResearch|2+ providers|[huggingface.co](https://huggingface.co/NousResearch/Hermes-3-Llama-3.1-405B-FP8)|
|deephermes-3-8b|NousResearch|2+ providers|[huggingface.co](https://huggingface.co/NousResearch/DeepHermes-3-Llama-3-8B-Preview)|
|deephermes-3-24b|NousResearch|1 provider|[huggingface.co](https://huggingface.co/NousResearch/DeepHermes-3-Mistral-24B-Preview)|
|phi-3-mini|Microsoft|1 provider|[huggingface.co](https://huggingface.co/microsoft/Phi-3-mini-4k-instruct)|
|phi-3.5-mini|Microsoft|2+ providers|[huggingface.co](https://huggingface.co/microsoft/Phi-3.5-mini-instruct)|
|phi-4|Microsoft|4+ providers|[techcommunity.microsoft.com](https://techcommunity.microsoft.com/blog/aiplatformblog/introducing-phi-4-microsoft%E2%80%99s-newest-small-language-model-specializing-in-comple/4357090)|
|phi-4-multimodal|Microsoft|3+ providers|[huggingface.co](https://huggingface.co/microsoft/Phi-4-multimodal-instruct)|
|phi-4-reasoning|Microsoft|2+ providers|[huggingface.co](https://huggingface.co/microsoft/Phi-4-reasoning)|
|phi-4-reasoning-plus|Microsoft|2+ providers|[huggingface.co](https://huggingface.co/microsoft/Phi-4-reasoning-plus)|
|wizardlm-2-7b|Microsoft|1 provider|[wizardlm.github.io](https://wizardlm.github.io/WizardLM2/)|
|wizardlm-2-8x22b|Microsoft|2+ providers|[wizardlm.github.io](https://wizardlm.github.io/WizardLM2/)|
|mai-ds-r1|Microsoft|1 provider|[huggingface.co](https://huggingface.co/microsoft/MAI-DS-R1)|
|gemini-2.0|Google|1 provider|[deepmind.google](http://deepmind.google/technologies/gemini/)|
|gemini-1.0-pro|Google|1 provider|[deepmind.google](https://deepmind.google/technologies/gemini/pro/)|
|gemini-1.5-flash|Google|7+ providers|[deepmind.google](https://deepmind.google/technologies/gemini/flash/)|
|gemini-1.5-8b-flash|Google|1 provider|[ai.google.dev](https://ai.google.dev/gemini-api/docs/models)|
|gemini-1.5-pro|Google|6+ providers|[deepmind.google](https://deepmind.google/technologies/gemini/pro/)|
|gemini-2.0-flash|Google|6+ providers|[deepmind.google](https://deepmind.google/technologies/gemini/flash/)|
|gemini-2.0-flash-thinking|Google|3+ providers|[ai.google.dev](https://ai.google.dev/gemini-api/docs/thinking-mode)|
|gemini-2.0-flash-thinking-with-apps|Google|1 provider|[ai.google.dev](https://ai.google.dev/gemini-api/docs/thinking-mode)|
|gemini-2.5-flash|Google|2+ providers|[deepmind.google](https://deepmind.google/technologies/gemini/)|
|gemini-2.5-flash-thinking|Google|1 provider|[cloud.google.com](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash)|
|gemini-2.5-pro|Google|2+ providers|[deepmind.google](https://deepmind.google/technologies/gemini/)|
|gemma-2-9b|Google|2+ providers|[huggingface.co](https://huggingface.co/google/gemma-2-9b)|
|gemma-2-27b|Google|1 provider|[huggingface.co](https://huggingface.co/google/gemma-2-27b)|
|gemma-3-1b|Google|2+ providers|[huggingface.co](https://huggingface.co/google/gemma-3-1b-it)|
|gemma-3-4b|Google|2+ providers|[huggingface.co](https://huggingface.co/google/gemma-3-4b-it)|
|gemma-3-12b|Google|3+ providers|[huggingface.co](https://huggingface.co/google/gemma-3-12b-it)|
|gemma-3-27b|Google|3+ providers|[huggingface.co](https://huggingface.co/google/gemma-3-27b-it)|
|claude-2|Anthropic|1 provider|[anthropic.com](https://www.anthropic.com/news/claude-2)|
|claude-2.0|Anthropic|1 provider|[anthropic.com](https://www.anthropic.com/news/claude-2)|
|claude-2.1|Anthropic|1 provider|[anthropic.com](https://www.anthropic.com/news/claude-2-1)|
|claude-3-opus|Anthropic|1 provider|[anthropic.com](https://www.anthropic.com/news/claude-3-family)|
|claude-3-sonnet|Anthropic|1 provider|[anthropic.com](https://www.anthropic.com/news/claude-3-family)|
|claude-3-haiku|Anthropic|2+ providers|[anthropic.com](https://www.anthropic.com/news/claude-3-haiku)|
|claude-3.5-sonnet|Anthropic|3+ providers|[anthropic.com](https://www.anthropic.com/news/claude-3-5-sonnet)|
|claude-3.5-haiku|Anthropic|1 provider|[anthropic.com](https://www.anthropic.com/claude/haiku)|
|claude-3.7-sonnet|Anthropic|3+ providers|[anthropic.com](https://www.anthropic.com/claude/sonnet)|
|claude-3.7-sonnet-thinking|Anthropic|1 provider|[anthropic.com](https://www.anthropic.com/claude/sonnet)|
|reka-core|Reka AI|1 provider|[reka.ai](https://www.reka.ai/ourmodels)|
|reka-flash|Reka AI|2+ providers|[reka.ai](https://www.reka.ai/)|
|blackboxai|Blackbox AI|1 provider|[docs.blackbox.chat](https://docs.blackbox.chat/blackbox-ai-1)|
|command|CohereForAI|1 provider|[cohere.com](https://cohere.com/command)|
|command-r|CohereForAI|2+ providers|[docs.cohere.com](https://docs.cohere.com/v2/docs/command-r-plus)|
|command-r-plus|CohereForAI|3+ providers|[huggingface.co](https://huggingface.co/CohereLabs/c4ai-command-r-plus-08-2024)|
|command-r7b|CohereForAI|2+ providers|[huggingface.co](https://huggingface.co/CohereLabs/c4ai-command-r7b-12-2024/blob/main/README.md)|
|command-a|CohereForAI|2+ providers|[huggingface.co](https://huggingface.co/CohereLabs/c4ai-command-a-03-2025)|
|qwen-1.5-7b|Qwen|1 provider|[huggingface.co](https://huggingface.co/Qwen/Qwen1.5-7B)|
|qwen-2-72b|Qwen|3+ providers|[huggingface.co](https://huggingface.co/Qwen/Qwen2-72B)|
|qwen-2-vl-7b|Qwen|1 provider|[huggingface.co](https://huggingface.co/Qwen/Qwen2-VL-7B)|
|qwen-2.5|Qwen|1 provider|[qwen-ai.com](https://www.qwen-ai.com/2-5/)|
|qwen-2.5-7b|Qwen|2+ providers|[huggingface.co](https://huggingface.co/Qwen/Qwen2.5-7B)|
|qwen-2.5-72b|Qwen|2+ providers|[huggingface.co](https://huggingface.co/Qwen/Qwen2.5-72B-Instruct)|
|qwen-2.5-coder-32b|Qwen|5+ providers|[huggingface.co](https://huggingface.co/Qwen/Qwen2.5-Coder-32B)|
|qwen-2.5-coder-7b|Qwen|1 provider|[huggingface.co](https://huggingface.co/Qwen/Qwen2.5-Coder-7B)|
|qwen-2.5-1m|Qwen|1 provider|[huggingface.co](https://huggingface.co/Qwen/Qwen2.5-1M-Demo)|
|qwen-2-5-max|Qwen|1 provider|[qwen-ai.com](https://www.qwen-ai.com/2-5-max/)|
|qwen-2.5-vl-3b|Qwen|2+ providers|[huggingface.co](https://huggingface.co/Qwen/Qwen2.5-VL-32B-Instruct)|
|qwen-2.5-vl-7b|Qwen|2+ providers|[huggingface.co](https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct)|
|qwen-2.5-vl-32b|Qwen|2+ providers|[huggingface.co](https://huggingface.co/Qwen/Qwen2.5-VL-32B-Instruct)|
|qwen-2.5-vl-72b|Qwen|2+ providers|[huggingface.co](https://huggingface.co/Qwen/Qwen2.5-VL-72B-Instruct)|
|qwen-3-235b|Qwen|4+ providers|[huggingface.co](https://huggingface.co/Qwen/Qwen3-235B-A22B)|
|qwen-3-32b|Qwen|3+ providers|[huggingface.co](https://huggingface.co/Qwen/Qwen3-32B)|
|qwen-3-30b|Qwen|3+ providers|[huggingface.co](https://huggingface.co/Qwen/Qwen3-30B-A3B)|
|qwen-3-14b|Qwen|3+ providers|[qwenlm.github.io](https://qwenlm.github.io/blog/qwen3/)|
|qwen-3-8b|Qwen|1 provider|[huggingface.co](https://huggingface.co/Qwen/Qwen3-8B)|
|qwen-3-4b|Qwen|2+ providers|[huggingface.co](https://huggingface.co/Qwen/Qwen3-4B-Base)|
|qwen-3-1.7b|Qwen|2+ providers|[qwenlm.github.io](https://qwenlm.github.io/blog/qwen3/)|
|qwen-3-0.6b|Qwen|2+ providers|[huggingface.co](https://huggingface.co/Qwen/Qwen3-0.6B)|
|qwq-32b|Qwen|5+ providers|[huggingface.co](https://huggingface.co/Qwen/QwQ-32B-Preview)|
|qwq-32b-preview|Qwen|1 provider|[huggingface.co](https://huggingface.co/Qwen/QwQ-32B-Preview)|
|qwq-32b-arliai|Qwen|1 provider|[huggingface.co](https://huggingface.co/bartowski/ArliAI_QwQ-32B-ArliAI-RpR-v1-GGUF)|
|qvq-72b|Qwen|1 provider|[huggingface.co](https://huggingface.co/Qwen/QVQ-72B-Preview)|
|qwen-vl-plus|Qwen|1 provider|[huggingface.co](https://huggingface.co/Qwen/Qwen-VL)|
|qwen-vl-max|Qwen|1 provider|[huggingface.co](https://huggingface.co/spaces/Qwen/Qwen-VL-Max)|
|qwen-turbo|Qwen|1 provider|[qwenlm.github.io](https://qwenlm.github.io/blog/qwen2.5-turbo/)|
|qwen-plus|Qwen|1 provider|[qwenlm.github.io](https://qwenlm.github.io/blog/qwen2.5/)|
|qwen-max|Qwen|1 provider|[qwenlm.github.io](https://qwenlm.github.io/blog/qwen2.5-max/)|
|pi|Inflection|1 provider|[inflection.ai](https://inflection.ai/blog/inflection-2-5)|
|inflection-3-productivity|Inflection|1 provider|[openrouter.ai](https://openrouter.ai/inflection/inflection-3-productivity)|
|inflection-3-pi|Inflection|1 provider|[openrouter.ai](https://openrouter.ai/inflection/inflection-3-pi)|
|deepseek-chat|DeepSeek|1 provider|[api-docs.deepseek.com](https://api-docs.deepseek.com)|
|deepseek-coder|DeepSeek|1 provider|[api-docs.deepseek.com](https://api-docs.deepseek.com)|
|deepseek-v3|DeepSeek|4+ providers|[api-docs.deepseek.com](https://api-docs.deepseek.com/news/news250120)|
|deepseek-r1|DeepSeek|7+ providers|[api-docs.deepseek.com](https://api-docs.deepseek.com/news/news250120)|
|deepseek-r1-zero|DeepSeek|2+ providers|[huggingface.co](https://huggingface.co/deepseek-ai/DeepSeek-R1-Zero)|
|deepseek-r1-turbo|DeepSeek|1 provider|[huggingface.co](https://huggingface.co/deepseek-ai/DeepSeek-R1)|
|deepseek-r1-distill-llama-8b|DeepSeek|1 provider|[huggingface.co](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Llama-8B)|
|deepseek-r1-distill-llama-70b|DeepSeek|3+ providers|[huggingface.co](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Llama-70B)|
|deepseek-r1-distill-qwen-1.5b|DeepSeek|1 provider|[huggingface.co](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B)|
|deepseek-r1-distill-qwen-14b|DeepSeek|2+ providers|[huggingface.co](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-14B)|
|deepseek-r1-distill-qwen-32b|DeepSeek|4+ providers|[huggingface.co](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-32B)|
|deepseek-prover-v2|DeepSeek|2+ providers|[github.com/deepseek-ai](https://github.com/deepseek-ai/DeepSeek-Prover-V2)|
|deepseek-prover-v2-671b|DeepSeek|1 provider|[github.com/deepseek-ai](https://github.com/deepseek-ai/DeepSeek-Prover-V2)|
|deepseek-v3-0324|DeepSeek|3+ providers|[huggingface.co](https://huggingface.co/deepseek-ai/DeepSeek-V3-0324)|
|janus-pro-7b|DeepSeek|1 provider|[api-docs.deepseek.com](https://api-docs.deepseek.com/docs/janus-pro-7b)|
|grok|x.ai|1 provider|[x.ai](https://x.ai/grok)|
|grok-2|x.ai|3+ providers|[x.ai](https://x.ai/blog/grok-3)|
|grok-3|x.ai|2+ providers|[x.ai](https://x.ai/blog/grok-3)|
|grok-3-mini|x.ai|1 provider|[x.ai](https://x.ai/news/grok-3)|
|grok-3-r1|x.ai|1 provider|[x.ai](https://x.ai/blog/grok-3)|
|grok-3-reason|x.ai|1 provider|[x.ai](https://x.ai/news/grok-3)|
|grok-3-beta|x.ai|1 provider|[x.ai](https://x.ai/news/grok-3)|
|grok-beta|x.ai|1 provider|[x.ai](https://x.ai/news/grok-3)|
|sonar|Perplexity AI|2+ providers|[sonar.perplexity.ai](https://sonar.perplexity.ai/)|
|sonar-pro|Perplexity AI|2+ providers|[sonar.perplexity.ai](https://sonar.perplexity.ai/)|
|sonar-reasoning|Perplexity AI|2+ providers|[sonar.perplexity.ai](https://sonar.perplexity.ai/)|
|sonar-reasoning-pro|Perplexity AI|2+ providers|[sonar.perplexity.ai](https://sonar.perplexity.ai/)|
|sonar-deep-research|Perplexity AI|1 provider|[sonar.perplexity.ai](https://sonar.perplexity.ai/)|
|r1-1776|Perplexity AI|2+ providers|[perplexity.ai](https://www.perplexity.ai/hub/blog/open-sourcing-r1-1776)|
|llama-3.1-sonar-small-online|Perplexity AI|1 provider|[perplexity.ai](https://www.perplexity.ai/hub/blog/open-sourcing-r1-1776)|
|llama-3.1-sonar-large-online|Perplexity AI|1 provider|[perplexity.ai](https://www.perplexity.ai/hub/blog/open-sourcing-r1-1776)|
|nemotron-49b|Nvidia|2+ providers|[huggingface.co](https://huggingface.co/nvidia/Llama-3_3-Nemotron-Super-49B-v1)|
|nemotron-70b|Nvidia|3+ providers|[build.nvidia.com](https://build.nvidia.com/nvidia/llama-3_1-nemotron-70b-instruct)|
|nemotron-253b|Nvidia|2+ providers|[build.nvidia.com](https://build.nvidia.com/nvidia/llama-3_1-nemotron-ultra-253b-v1/modelcard)|
|glm-4|THUDM|2+ providers|[github.com/THUDM](https://github.com/THUDM/GLM-4)|
|glm-4-32b|THUDM|1 provider|[huggingface.co](https://huggingface.co/THUDM/GLM-4-32B-0414)|
|glm-z1-32b|THUDM|1 provider|[huggingface.co](https://huggingface.co/THUDM/GLM-Z1-32B-0414)|
|glm-4-9b|THUDM|1 provider|[huggingface.co](https://huggingface.co/THUDM/glm-4-9b)|
|glm-z1-9b|THUDM|1 provider|[huggingface.co](https://huggingface.co/THUDM/GLM-Z1-9B-0414)|
|glm-z1-rumination-32b|THUDM|1 provider|[huggingface.co](https://huggingface.co/THUDM/GLM-Z1-Rumination-32B-0414)|
|minimax|MiniMax|2+ providers|[hailuo.ai](https://www.hailuo.ai/)|
|dolphin-2.6|Cognitive Computations|1 provider|[huggingface.co](https://huggingface.co/cognitivecomputations/dolphin-2.6-mixtral-8x7b)|
|dolphin-2.9|Cognitive Computations|1 provider|[huggingface.co](https://huggingface.co/cognitivecomputations/dolphin-2.9.1-llama-3-70b)|
|dolphin-3.0-24b|Cognitive Computations|2+ providers|[huggingface.co](https://huggingface.co/cognitivecomputations/Dolphin3.0-Mistral-24B)|
|dolphin-3.0-r1-24b|Cognitive Computations|2+ providers|[huggingface.co](https://huggingface.co/cognitivecomputations/Dolphin3.0-R1-Mistral-24B)|
|dolphin-8x22b|Cognitive Computations|1 provider|[huggingface.co](https://huggingface.co/cognitivecomputations/dolphin-2.9-mixtral-8x22b)|
|airoboros-70b|DeepInfra|1 provider|[huggingface.co](https://huggingface.co/cognitivecomputations/dolphin-2.9.1-llama-3-70b)|
|lzlv-70b|Lizpreciatior|1 provider|[huggingface.co](https://huggingface.co/cognitivecomputations/dolphin-2.9.1-llama-3-70b)|
|molmo-7b|Ai2|1 provider|[huggingface.co](https://huggingface.co/allenai/Molmo-7B-D-0924)|
|lfm-3b|Liquid AI|1 provider|[liquid.ai](https://www.liquid.ai/liquid-foundation-models)|
|lfm-7b|Liquid AI|1 provider|[liquid.ai](https://www.liquid.ai/liquid-foundation-models)|
|lfm-40b|Liquid AI|2+ providers|[liquid.ai](https://www.liquid.ai/liquid-foundation-models)|
|deepcoder-14b|Agentica|2+ providers|[huggingface.co](https://huggingface.co/agentica-org/DeepCoder-14B-Preview)|
|kimi-vl-thinking|Moonshot AI|2+ providers|[huggingface.co](https://huggingface.co/moonshotai/Kimi-VL-A3B-Thinking)|
|moonlight-16b|Moonshot AI|2+ providers|[huggingface.co](https://huggingface.co/moonshotai/Moonlight-16B-A3B-Instruct)|
|qwerky-72b|Featherless Serverless LLM|2+ providers|[huggingface.co](https://huggingface.co/featherless-ai/Qwerky-72B)|
|evil|Evil Mode - Experimental|1+ providers|[]( )|

---
### Image generation models
| Model | Base Provider | Providers | Website |
|-------|---------------|-----------|---------|
|dall-e-3|OpenAI|5+ providers|[openai.com](https://openai.com/index/dall-e/)|
|sdxl-turbo|Stability AI|2+ providers|[huggingface.co](https://huggingface.co/stabilityai/sdxl-turbo)|
|sd-3.5|Stability AI|1 provider|[huggingface.co](https://huggingface.co/stabilityai/stable-diffusion-3.5-large)|
|flux|Black Forest Labs|4+ providers|[github.com/black-forest-labs/flux](https://github.com/black-forest-labs/flux)|
|flux-pro|Black Forest Labs|1 provider|[huggingface.co](https://huggingface.co/enhanceaiteam/FLUX.1-Pro)|
|flux-dev|Black Forest Labs|4+ providers|[huggingface.co](https://huggingface.co/black-forest-labs/FLUX.1-dev)|
|flux-schnell|Black Forest Labs|4 providers|[huggingface.co](https://huggingface.co/black-forest-labs/FLUX.1-schnell)|
|midjourney|Midjourney|1 provider|[docs.midjourney.com](https://docs.midjourney.com/docs/model-versions)|

---
### Audio generation models
| Model | Base Provider | Providers | Website |
|-------|---------------|-----------|---------|
|gpt-4o-audio|OpenAI|1 provider|[platform.openai.com](https://platform.openai.com/docs/models/gpt-4o-audio)|


## Conclusion and Usage Tips
This document provides a comprehensive overview of various AI providers and models available for text generation, image generation, and vision tasks. **When choosing a provider or model, consider the following factors:**
   1. **Availability**: Check the status of the provider to ensure it's currently active and accessible.
   2. **Model Capabilities**: Different models excel at different tasks. Choose a model that best fits your specific needs, whether it's text generation, image creation, or vision-related tasks.
   3. **Authentication**: Some providers require authentication, while others don't. Consider this when selecting a provider for your project.
   4. **Vision Models**: For tasks requiring image understanding or multimodal interactions, look for providers offering vision models.

Remember to stay updated with the latest developments in the AI field, as new models and providers are constantly emerging and evolving.

---

[Return to Documentation](../)
