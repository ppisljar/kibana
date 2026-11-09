import { describe, expect, it, vi } from 'vitest';

import { answerPrompt, createAnthropicAnswerer, questionText } from '../memory/answerer.js';
import { parseClaudeStream } from '../memory/targets/claude_code.js';

describe('parseClaudeStream', () => {
  it('returns the final result event and keeps every event as trace', () => {
    const stdout = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__kibana__query' }] } }),
      'not json',
      JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Ljubljana' }),
    ].join('\n');
    const parsed = parseClaudeStream(stdout);
    expect(parsed.answer).toBe('Ljubljana');
    expect(parsed.isError).toBe(false);
    expect(parsed.events).toHaveLength(3);
  });

  it('reports an error result', () => {
    const parsed = parseClaudeStream(
      JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, result: '' })
    );
    expect(parsed.isError).toBe(true);
    expect(parsed.errorText).toContain('error_max_turns');
  });
});

describe('questionText', () => {
  it('prefixes the question date when present', () => {
    expect(questionText({ question: 'Where?', question_date: '2024/05/01' })).toBe(
      '(Asked on 2024/05/01) Where?'
    );
    expect(questionText({ question: 'Where?' })).toBe('Where?');
  });
});

describe('answerPrompt', () => {
  it('numbers memories and states when none were retrieved', () => {
    expect(answerPrompt({ question: 'Q', memories: ['a', 'b'] })).toContain('[2] b');
    expect(answerPrompt({ question: 'Q', memories: [] })).toContain('(no memories were retrieved)');
  });
});

describe('createAnthropicAnswerer', () => {
  it('posts the prompt and joins text blocks', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ content: [{ type: 'text', text: 'Lju' }, { type: 'text', text: 'bljana' }] }),
          { status: 200 }
        )
    );
    const answerer = createAnthropicAnswerer({
      apiKey: 'k',
      model: 'm',
      fetch: fetchMock as unknown as typeof fetch,
    });
    const answer = await answerer.answer({ question: 'Where?', memories: ['I live in Ljubljana'] });
    expect(answer).toBe('Ljubljana');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(JSON.parse(String(init.body)).messages[0].content).toContain('[1] I live in Ljubljana');
  });

  it('throws on a non-2xx response', async () => {
    const answerer = createAnthropicAnswerer({
      apiKey: 'k',
      model: 'm',
      fetch: (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch,
    });
    await expect(answerer.answer({ question: 'Q', memories: [] })).rejects.toThrow('401');
  });
});
