import { afterEach, describe, expect, it } from 'vitest';
import { createChatModel } from '../../src/core/llm/agent';
import { getDefaultBackendUrl, setAuthToken, setBackendUrl } from '../../src/services/backend-client';
import type { GLMConfig, OpenAIConfig, OpenRouterConfig } from '../../src/core/llm/types';

const getModelFields = (model: unknown) =>
  model as {
    useResponsesApi?: boolean;
    invocationParams: (options?: unknown) => { model?: string };
    fields?: {
      useResponsesApi?: boolean;
      configuration?: {
        baseURL?: string;
      };
    };
    clientConfig?: {
      baseURL?: string;
      apiKey?: string;
      defaultHeaders?: Record<string, string>;
    };
  };

afterEach(() => {
  setAuthToken(null);
  setBackendUrl(getDefaultBackendUrl());
});

describe('createChatModel', () => {
  it('routes custom OpenAI-compatible endpoints through the GitNexus backend proxy', () => {
    setBackendUrl('https://backend.example.test');
    setAuthToken('session-token');

    const config: OpenAIConfig = {
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-5.2-pro-compatible',
      baseUrl: 'https://llm.example.com/v1/',
    };

    const model = createChatModel(config);
    const fields = getModelFields(model);

    expect(fields.invocationParams({}).model).toBe('gpt-5.2-pro-compatible');
    expect(fields.useResponsesApi).toBeUndefined();
    expect(fields.clientConfig?.baseURL).toBe(
      'https://backend.example.test/api/llm/openai-compatible',
    );
    expect(fields.clientConfig?.apiKey).toBe('session-token');
    expect(fields.clientConfig?.maxRetries).toBe(0);
    expect(fields.clientConfig?.defaultHeaders?.['x-gitnexus-llm-base-url']).toBe(
      'https://llm.example.com/v1',
    );
    expect(fields.clientConfig?.defaultHeaders?.['x-gitnexus-llm-api-key']).toBe('sk-test');
  });

  it('routes OpenRouter-compatible models through the GitNexus backend proxy', () => {
    setBackendUrl('https://backend.example.test');
    setAuthToken('session-token');

    const config: OpenRouterConfig = {
      provider: 'openrouter',
      apiKey: 'sk-or-test',
      model: 'openai/gpt-5.2-pro',
      baseUrl: 'https://openrouter.ai/api/v1',
    };

    const model = createChatModel(config);

    expect(getModelFields(model).invocationParams({}).model).toBe('openai/gpt-5.2-pro');
    expect(getModelFields(model).useResponsesApi).toBeUndefined();
    expect(getModelFields(model).clientConfig?.baseURL).toBe(
      'https://backend.example.test/api/llm/openai-compatible',
    );
    expect(getModelFields(model).clientConfig?.defaultHeaders?.['x-gitnexus-llm-base-url']).toBe(
      'https://openrouter.ai/api/v1',
    );
  });

  it('uses Chat Completions for GLM OpenAI-compatible API', () => {
    setBackendUrl('https://backend.example.test');
    setAuthToken('session-token');

    const config: GLMConfig = {
      provider: 'glm',
      apiKey: 'glm-test',
      model: 'GLM-5',
      baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    };

    const model = createChatModel(config);

    expect(getModelFields(model).invocationParams({}).model).toBe('GLM-5');
    expect(getModelFields(model).useResponsesApi).toBeUndefined();
    expect(getModelFields(model).clientConfig?.baseURL).toBe(
      'https://backend.example.test/api/llm/openai-compatible',
    );
  });

  it('requires a GitNexus session before creating proxied OpenAI-compatible models', () => {
    const config: OpenAIConfig = {
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-5.2-pro-compatible',
      baseUrl: 'https://llm.example.com/v1',
    };

    expect(() => createChatModel(config)).toThrow(/GitNexus login is required/);
  });

  it('trims model names before sending OpenAI-compatible requests', () => {
    setBackendUrl('https://backend.example.test');
    setAuthToken('session-token');

    const config: OpenAIConfig = {
      provider: 'openai',
      apiKey: 'sk-test',
      model: ' 360-deepseek-v4-flash（抢鲜）',
      baseUrl: 'https://code.jizhi.360.cn/v1',
    };

    const model = createChatModel(config);

    expect(getModelFields(model).invocationParams({}).model).toBe(
      '360-deepseek-v4-flash（抢鲜）',
    );
  });
});
