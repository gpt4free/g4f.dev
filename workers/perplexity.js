// Perplexity AI Worker

class PerplexityWorker {
  constructor() {
    this.label = "Perplexity";
    this.url = "https://www.perplexity.ai";
    this.cookieDomain = ".perplexity.ai";
    this.working = true;
    this.activeByDefault = true;

    this.defaultModel = "auto";
    this.models = [
      "auto", "turbo", "gpt41", "gpt5", "gpt5_thinking", "o3", "o3pro",
      "claude2", "claude37sonnetthinking", "claude40opus", "claude40opusthinking",
      "claude41opusthinking", "claude45sonnet", "claude45sonnetthinking",
      "experimental", "grok", "grok4", "gemini2flash", "pplx_pro",
      "pplx_pro_upgraded", "pplx_alpha", "pplx_beta", "comet_max_assistant",
      "o3_research", "o3pro_research", "claude40sonnet_research",
      "claude40sonnetthinking_research", "claude40opus_research",
      "claude40opusthinking_research", "o3_labs", "o3pro_labs",
      "claude40sonnetthinking_labs", "claude40opusthinking_labs",
      "o4mini", "o1", "gpt4o", "gpt45", "gpt4", "o3mini",
      "claude35haiku", "llama_x_large", "mistral", "claude3opus",
      "gemini", "pplx_reasoning", "r1"
    ];

    this.modelAliases = {
      "gpt-5": "gpt5",
      "gpt-5-thinking": "gpt5_thinking",
    };
  }

  /**
   * Estimate token count for a string (approximate: ~4 chars per token)
   * @param {string} text - The text to count tokens for
   * @returns {number} Estimated token count
   */
  countTokens(text) {
    if (!text || typeof text !== "string") return 0;
    // Approximate token count: ~4 characters per token for English text
    return Math.ceil(text.length / 4);
  }

  /**
   * Count tokens for messages array
   * @param {Array} messages - Array of message objects
   * @returns {number} Total estimated token count
   */
  countMessagesTokens(messages) {
    if (!messages || !Array.isArray(messages)) return 0;
    return messages.reduce((total, msg) => {
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      // Add overhead for role and message structure (~4 tokens per message)
      return total + this.countTokens(content) + 4;
    }, 0);
  }

  async* streamResponse(model, messages, cookies = null, conversation = null, proxy = null) {
    if (!model) {
      model = this.defaultModel;
    }

    // Initialize conversation if not provided
    if (!conversation) {
      conversation = {
        frontend_uid: crypto.randomUUID(),
        frontend_context_uuid: crypto.randomUUID(),
        visitor_id: crypto.randomUUID(),
        user_id: null,
      };
    }

    const requestId = crypto.randomUUID();

    const headers = {
      "accept": "text/event-stream",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      "content-type": "application/json",
      "origin": this.url,
      "referer": `${this.url}/?login-new=false&login-source=oneTapHome`,
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0",
      "x-perplexity-request-reason": "ask-query-state-provider",
      "x-perplexity-request-try-number": "1",
      "x-request-id": requestId,
    };

    // Add cookies if provided
    if (cookies) {
      headers["cookie"] = cookies;
    }

    // Extract last user message as query
    let query = "";
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        query = messages[i].content;
        break;
      }
    }

    // Refresh edge cookies via bot security beacon (refreshes pplx.edge-vid and pplx.edge-sid)
    try {
      const beaconHeaders = {
        "accept": "*/*",
        "cache-control": "no-cache",
        "pragma": "no-cache",
        "origin": "https://count.perplexity.ai",
        "referer": "https://count.perplexity.ai/bs",
        "user-agent": headers["user-agent"],
      };
      if (cookies) {
        beaconHeaders["cookie"] = cookies;
      }
      await fetch("https://count.perplexity.ai/api/v1/bs?iv=6", {
        method: "POST",
        headers: beaconHeaders,
      });
    } catch (e) {
      console.error("Perplexity: Bot security beacon failed:", e);
    }

    // Get user session if needed
    if (conversation.user_id === null) {
      const sessionHeaders = {
        ...headers,
        "accept": "*/*",
        "x-app-apiclient": "default",
        "x-app-apiversion": "2.18",
        "x-perplexity-request-reason": "getSession",
        "x-perplexity-request-try-number": "1",
      };

      const sessionResponse = await fetch(
        `${this.url}/api/auth/session?version=2.18&source=default`,
        { headers: sessionHeaders }
      );
      
      if (sessionResponse.ok) {
        const userData = await sessionResponse.json();
        conversation.user_id = userData?.user?.id || null;
        console.log(`Perplexity user id: ${conversation.user_id}`);
      }
    }

    yield { type: "conversation", data: conversation };

    // Adjust model based on user status
    if (model === "auto" || model === "perplexity") {
      model = conversation.user_id ? "pplx_pro" : "turbo";
    }

    yield { type: "provider", data: { label: this.label, model: model } };

    // Check for model aliases
    if (this.modelAliases[model]) {
      model = this.modelAliases[model];
    }

    // Build request data
    const data = this.buildRequestData(model, query, conversation);

    // yield { type: "request", data: data };

    // Make streaming request
    const response = await fetch(`${this.url}/rest/sse/perplexity_ask`, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Count prompt tokens
    const promptTokens = this.countMessagesTokens(messages);

    // Parse SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullResponse = "";
    let fullReasoning = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const jsonStr = line.slice(6);
          if (jsonStr === "[DONE]") continue;

          try {
            const jsonData = JSON.parse(jsonStr);
            // yield { type: "raw_response", data: jsonData };

            // Detect auth wall / upsell
            if (jsonData.upsell_information?.upsell_type === "LOGIN") {
              throw new Error(`Authentication required: ${jsonData.upsell_information.title || "Sign in to continue using Perplexity"}`);
            }

            // Process blocks
            for (const block of jsonData.blocks || []) {
              // Handle sources
              if (block.intended_usage === "sources_answer_mode") {
                yield {
                  type: "sources",
                  data: block.sources_mode_block?.web_results || []
                };
                continue;
              }

              // Handle media items
              if (block.intended_usage === "media_items") {
                const mediaItems = block.media_block?.media_items || [];
                const processedMedia = mediaItems.map(item => {
                  if (item.medium === "image") {
                    return {
                      type: "image",
                      url: item.url,
                      name: item.name,
                      height: item.image_height,
                      width: item.image_width,
                      ...item
                    };
                  } else {
                    return {
                      type: "youtube",
                      videoId: item.url.split("=").pop()
                    };
                  }
                });
                yield { type: "media", data: processedMedia };
                continue;
              }

              // Handle initial markdown_block (first response with chunks)
              if (block.intended_usage === "ask_text" && block.markdown_block && !block.diff_block) {
                const mb = block.markdown_block;

                // Yield initial chunks (first streaming response)
                if (mb.chunks && mb.progress === "IN_PROGRESS" && !fullResponse) {
                  const text = mb.chunks.join("");
                  if (text) {
                    fullResponse = text;
                    yield { choices: [{ delta: { content: text } }] };
                  }
                }

                // Yield final answer (check for any missing content)
                if (mb.answer && mb.progress === "DONE") {
                  const answer = mb.answer;
                  if (answer.startsWith(fullResponse)) {
                    const remaining = answer.slice(fullResponse.length);
                    if (remaining) {
                      fullResponse = answer;
                      yield { choices: [{ delta: { content: remaining } }] };
                    }
                  } else if (!fullResponse) {
                    fullResponse = answer;
                    yield { choices: [{ delta: { content: answer } }] };
                  }
                }

                continue;
              }

              // Handle markdown_block (initial text or final answer)
              if (block.markdown_block) {
                const mb = block.markdown_block;
                let text = "";
                if (mb.answer) {
                  text = mb.answer;
                } else if (mb.chunks) {
                  text = mb.chunks.join("");
                }
                if (text && typeof text === "string") {
                  if (!fullResponse) {
                    fullResponse = text;
                    yield {choices: [{delta: {content: text}}]};
                  } else if (text.startsWith(fullResponse)) {
                    const diff = text.slice(fullResponse.length);
                    if (diff) {
                      fullResponse = text;
                      yield {choices: [{delta: {content: diff}}]};
                    }
                  }
                }
              }

              // Handle diff blocks
              for (const patch of block.diff_block?.patches || []) {
                if (patch.path === "/progress") continue;

                let value = patch.value || "";

                if (value.chunks) {
                  value = value.chunks.join("");
                }

                // Handle reasoning/goals
                if (patch.path.startsWith("/goals")) {
                  if (typeof value === "string") {
                    if (value.startsWith(fullReasoning)) {
                      value = value.slice(fullReasoning.length);
                    }
                    yield {choices: [{delta: {content: null, reasoning: value}}]};
                    fullReasoning += value;
                  } else {
                    yield {choices: [{delta: {content: null, reasoning: ""}}]};
                  }
                  continue;
                }

                // Handle answer text
                if (block.diff_block?.field !== "markdown_block") continue;

                value = typeof value === "object" ? value.answer || "" : value;

                if (value && typeof value === "string") {
                  if (value.startsWith(fullResponse)) {
                    value = value.slice(fullResponse.length);
                  } else if (fullResponse.endsWith(value)) {
                    value = "";
                  }

                  if (value) {
                    fullResponse += value;
                    yield {choices: [{delta: {content: value}}]};
                  }
                }
              }
            }

            // Handle follow-up suggestions
            if (jsonData.related_query_items) {
              const followups = jsonData.related_query_items.map(item => item.text || "");
              yield { type: "followups", data: followups };
            }
          } catch (e) {
            console.error("Error parsing JSON:", e);
          }
        }
      }
    }

    // Calculate completion tokens and yield usage
    const completionTokens = this.countTokens(fullResponse) + this.countTokens(fullReasoning);
    const usage = {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens
    };

    yield {
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage,
      model
    };
  }

  buildRequestData(model, query, conversation) {
    const requestId = crypto.randomUUID();
    const isFollowup = conversation.last_backend_uuid != null;

    const baseParams = {
      attachments: [],
      language: "en-US",
      timezone: "America/New_York",
      search_focus: "internet",
      sources: ["web"],
      search_recency_filter: null,
      frontend_uuid: requestId,
      model_preference: model,
      is_related_query: false,
      is_sponsored: false,
      prompt_source: "user",
      query_source: "home",
      is_incognito: false,
      time_from_first_type: Math.floor(Math.random() * 10000),
      local_search_enabled: false,
      use_schematized_api: true,
      send_back_text_in_streaming_api: false,
      supported_block_use_cases: [
        "answer_modes", "media_items", "knowledge_cards", "inline_entity_cards",
        "place_widgets", "finance_widgets", "sports_widgets", "news_widgets",
        "shopping_widgets", "jobs_widgets", "search_result_widgets",
        "inline_images", "inline_assets", "placeholder_cards", "diff_blocks",
        "inline_knowledge_cards", "entity_group_v2", "refinement_filters",
        "canvas_mode", "maps_preview", "answer_tabs", "price_comparison_widgets",
        "preserve_latex", "generic_onboarding_widgets", "in_context_suggestions",
        "pending_followups", "inline_claims", "unified_assets", "workflow_steps",
        "workflow_widgets", "navigation_results", "background_agents"
      ],
      client_coordinates: null,
      mentions: [],
      dsl_query: query,
      skip_search_enabled: true,
      is_nav_suggestions_disabled: false,
      source: "default",
      always_search_override: false,
      override_no_search: false,
      should_ask_for_mcp_tool_confirmation: true,
      supports_tool_approval_modal: true,
      browser_agent_allow_once_from_toggle: false,
      force_enable_browser_agent: false,
      supported_features: ["browser_agent_permission_banner_v1.1"],
      extended_context: false,
      version: "2.18",
      rum_session_id: crypto.randomUUID(),
    };

    if (isFollowup) {
      return {
        params: {
          ...baseParams,
          last_backend_uuid: conversation.last_backend_uuid,
          read_write_token: conversation.read_write_token || null,
          frontend_context_uuid: conversation.frontend_context_uuid,
          mode: "copilot",
          query_source: "followup",
          followup_source: "link",
          client_search_results_cache_key: requestId,
        },
        query_str: query
      };
    } else {
      return {
        params: {
          ...baseParams,
          frontend_context_uuid: conversation.frontend_context_uuid,
          mode: "copilot",
          client_search_results_cache_key: requestId,
        },
        query_str: query
      };
    }
  }
}

// Cloudflare Worker handler
export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }
    const url = new URL(request.url);
    if (url.pathname.endsWith("/models")) {
      return handleListModels(request, env);
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const { model, messages, cookies, conversation, stream = true } = await request.json();

      const perplexity = new PerplexityWorker();

      // Non-streaming response
      if (!stream) {
        let fullContent = "";
        let fullReasoning = "";
        let finalUsage = null;
        let finalModel = model || perplexity.defaultModel;
        let sources = [];
        let media = [];
        let followups = [];

        try {
          for await (const chunk of perplexity.streamResponse(model, messages, cookies, conversation)) {
            // Collect content from delta chunks
            if (chunk.choices?.[0]?.delta?.content) {
              fullContent += chunk.choices[0].delta.content;
            }
            // Collect reasoning from delta chunks
            if (chunk.choices?.[0]?.delta?.reasoning) {
              fullReasoning += chunk.choices[0].delta.reasoning;
            }
            // Capture usage and model from final chunk
            if (chunk.usage) {
              finalUsage = chunk.usage;
            }
            if (chunk.model) {
              finalModel = chunk.model;
            }
            // Collect sources
            if (chunk.type === "sources") {
              sources = chunk.data;
            }
            // Collect media
            if (chunk.type === "media") {
              media = chunk.data;
            }
            // Collect followups
            if (chunk.type === "followups") {
              followups = chunk.data;
            }
          }
        } catch (error) {
          return new Response(JSON.stringify({ error: error.message || String(error) }), {
            status: 500,
            headers: { 
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          });
        }

        // Build non-streaming response
        const response = {
          id: `chatcmpl-${crypto.randomUUID()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: finalModel,
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: fullContent,
              ...(fullReasoning && { reasoning: fullReasoning }),
            },
            finish_reason: "stop",
          }],
          usage: finalUsage || {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          },
          ...(sources.length > 0 && { sources }),
          ...(media.length > 0 && { media }),
          ...(followups.length > 0 && { followups }),
        };

        return new Response(JSON.stringify(response), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
      
      // Create streaming response
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      // Process stream in background
      (async () => {
        try {
          for await (const chunk of perplexity.streamResponse(model, messages, cookies, conversation)) {
            await writer.write(encoder.encode("data: " + JSON.stringify(chunk) + "\n\n"));
          }
        } catch (error) {
          await writer.write(encoder.encode("data: " + JSON.stringify({ error: error }) + "\n\n"));
        } finally {
          await writer.write(encoder.encode("data: [DONE]\n\n"));
          await writer.close();
        }
      })();

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message || String(error) }), {
        status: 500,
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  },
};


/**
 * Handle GET /v1/models - List available models
 */
async function handleListModels(request, env) {
  const models = [];

  models.push({
    id: "turbo",
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: "perplexity"
  });

  return new Response(JSON.stringify({
    object: "list",
    data: models
  }), {
    headers: { "Content-Type": "application/json" }
  });
}