import type express from 'express';
import { BadRequestError } from './validation.js';

export const LLM_PROXY_BASE_URL_HEADER = 'x-gitnexus-llm-base-url';
export const LLM_PROXY_API_KEY_HEADER = 'x-gitnexus-llm-api-key';

export interface OpenAICompatibleProxyConfig {
  baseUrl: string;
  apiKey: string;
  upstreamUrl: string;
}

const singleHeaderValue = (value: string | string[] | undefined): string | undefined => {
  if (Array.isArray(value)) return value[0];
  return value;
};

export const normalizeOpenAICompatibleBaseUrl = (input: string): string => {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new BadRequestError('OpenAI-compatible base URL is required');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new BadRequestError('OpenAI-compatible base URL must be a valid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestError('OpenAI-compatible base URL must use http or https');
  }

  parsed.pathname = parsed.pathname.replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';

  return parsed.toString().replace(/\/+$/, '');
};

export const buildOpenAICompatibleChatCompletionsUrl = (baseUrl: string): string =>
  `${normalizeOpenAICompatibleBaseUrl(baseUrl)}/chat/completions`;

export const getOpenAICompatibleProxyConfig = (
  headers: express.Request['headers'],
): OpenAICompatibleProxyConfig => {
  const baseUrl = normalizeOpenAICompatibleBaseUrl(
    singleHeaderValue(headers[LLM_PROXY_BASE_URL_HEADER]) ?? '',
  );
  const apiKey = singleHeaderValue(headers[LLM_PROXY_API_KEY_HEADER])?.trim();

  if (!apiKey) {
    throw new BadRequestError('OpenAI-compatible API key is required');
  }

  return {
    baseUrl,
    apiKey,
    upstreamUrl: buildOpenAICompatibleChatCompletionsUrl(baseUrl),
  };
};

export const proxyOpenAICompatibleChatCompletions: express.RequestHandler = async (req, res) => {
  let config: OpenAICompatibleProxyConfig;
  try {
    config = getOpenAICompatibleProxyConfig(req.headers);
  } catch (err) {
    const status = err instanceof BadRequestError ? err.status : 400;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Invalid LLM proxy request' });
    return;
  }

  try {
    const upstream = await fetch(config.upstreamUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(req.body ?? {}),
    });

    res.status(upstream.status);
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    const cacheControl = upstream.headers.get('cache-control');
    if (cacheControl) res.setHeader('Cache-Control', cacheControl);

    if (!upstream.body) {
      res.end();
      return;
    }

    const reader = upstream.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (res.destroyed) return;
        res.write(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    res.end();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown upstream error';
    res.status(502).json({ error: `OpenAI-compatible upstream request failed: ${message}` });
  }
};
