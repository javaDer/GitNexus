import { describe, expect, it } from 'vitest';
import {
  buildOpenAICompatibleChatCompletionsUrl,
  getOpenAICompatibleProxyConfig,
  LLM_PROXY_API_KEY_HEADER,
  LLM_PROXY_BASE_URL_HEADER,
  normalizeOpenAICompatibleBaseUrl,
} from '../../src/server/llm-proxy.js';

describe('OpenAI-compatible LLM proxy helpers', () => {
  it('normalizes provider base URLs and strips a pasted chat completions suffix', () => {
    expect(normalizeOpenAICompatibleBaseUrl(' https://llm.example.com/v1/ ')).toBe(
      'https://llm.example.com/v1',
    );
    expect(
      normalizeOpenAICompatibleBaseUrl('https://llm.example.com/v1/chat/completions'),
    ).toBe('https://llm.example.com/v1');
  });

  it('builds the upstream chat completions URL', () => {
    expect(buildOpenAICompatibleChatCompletionsUrl('https://llm.example.com/v1/')).toBe(
      'https://llm.example.com/v1/chat/completions',
    );
  });

  it('rejects missing or non-http upstream configuration', () => {
    expect(() =>
      getOpenAICompatibleProxyConfig({
        [LLM_PROXY_BASE_URL_HEADER]: 'file:///tmp/model',
        [LLM_PROXY_API_KEY_HEADER]: 'sk-test',
      }),
    ).toThrow(/http/);

    expect(() =>
      getOpenAICompatibleProxyConfig({
        [LLM_PROXY_BASE_URL_HEADER]: 'https://llm.example.com/v1',
      }),
    ).toThrow(/API key/);
  });
});
