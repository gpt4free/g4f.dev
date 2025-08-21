// client.d.ts

declare module 'client' {
  interface ClientOptions {
    defaultModel?: string;
    baseUrl?: string;
    apiKey?: string;
    headers?: Record<string, string>;
    modelAliases?: Record<string, string>;
  }

  interface ChatCompletionParams {
    model?: string;
    messages: Array<{ role: string; content: string }>;
    stream?: boolean;
    [key: string]: any;
  }

  interface ImageGenerationParams {
    model?: string;
    prompt?: string;
    size?: string;
    nologo?: boolean;
    width?: string;
    height?: string;
    [key: string]: any;
  }

  interface Model {
    id: string;
    name?: string;
    type?: string;
  }

  interface ChatCompletions {
    create(params: ChatCompletionParams): Promise<any> | AsyncGenerator<any, void, unknown>;
  }

  interface Models {
    list(): Promise<Model[]>;
  }

  interface Images {
    generate(params: ImageGenerationParams): Promise<any>;
  }

  class Client {
    constructor(options?: ClientOptions);
    defaultModel: string | null;
    baseUrl: string;
    apiEndpoint: string;
    imageEndpoint: string;
    apiKey: string | undefined;
    headers: Record<string, string>;
    modelAliases: Record<string, string>;
    swapAliases: Record<string, string>;

    chat: {
      completions: ChatCompletions;
    };

    models: Models;

    images: Images;

    _regularCompletion(apiEndpoint: string, requestOptions: RequestInit): Promise<any>;
    _streamCompletion(apiEndpoint: string, requestOptions: RequestInit): AsyncGenerator<any, void, unknown>;
    _normalizeMessages(messages: Array<{ role: string; content: string }>): Array<{ role: string; content: string }>;
    _defaultImageGeneration(params: ImageGenerationParams, requestOptions: RequestInit): Promise<any>;
    _regularImageGeneration(params: ImageGenerationParams, requestOptions: RequestInit): Promise<any>;
  }

  class DeepInfra extends Client {
    constructor(options?: ClientOptions);
  }

  class Together extends Client {
    constructor(options?: ClientOptions);
    _regularImageGeneration(params: ImageGenerationParams, requestOptions: RequestInit): Promise<any>;
  }

  class Puter {
    constructor(options?: { defaultModel?: string; puter?: any });
    defaultModel: string | null;
    puter: Promise<any>;

    chat: {
      completions: ChatCompletions;
    };

    models: Models;

    _injectPuter(): Promise<any>;
    _streamCompletion(messages: Array<{ role: string; content: string }>, options?: any): AsyncGenerator<any, void, unknown>;
  }

  class HuggingFace {
    constructor(options?: { apiBase?: string; apiKey?: string; headers?: Record<string, string> });
    apiBase: string;
    apiKey: string;
    defaultModel: string;
    modelAliases: Record<string, string>;
    providerMapping: Record<string, any>;
    headers: Record<string, string>;

    models: Models;

    _getMapping(model: string): Promise<any>;

    chat: {
      completions: ChatCompletions;
    };
  }

  export { Client, DeepInfra, Together, Puter, HuggingFace };
  export default Client;
}