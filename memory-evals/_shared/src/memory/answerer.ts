/**
 * Answers a question from retrieved memories. Used by the Context Engine
 * target, which has no agent of its own. Agent Builder and Claude Code answer
 * with their own models.
 */

export interface AnswerRequest {
  question: string;
  question_date?: string;
  memories: string[];
}

export interface Answerer {
  readonly name: string;
  answer(req: AnswerRequest): Promise<string>;
}

/** The question as targets that answer on their own should receive it, so the date context matches across targets. */
export const questionText = (q: { question: string; question_date?: string }): string =>
  q.question_date ? `(Asked on ${q.question_date}) ${q.question}` : q.question;

export const answerPrompt = (req: AnswerRequest): string => {
  const memories =
    req.memories.length === 0
      ? '(no memories were retrieved)'
      : req.memories.map((m, i) => `[${i + 1}] ${m}`).join('\n');
  const date = req.question_date ? `Today's date is ${req.question_date}.\n` : '';
  return [
    'Answer the question using only the memories below. If they do not contain the answer, say you do not know.',
    'Reply with the answer only, as briefly as possible.',
    '',
    `${date}Memories:\n${memories}`,
    '',
    `Question: ${req.question}`,
  ].join('\n');
};

export interface AnthropicAnswererOptions {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  maxTokens?: number;
}

export const createAnthropicAnswerer = (opts: AnthropicAnswererOptions): Answerer => {
  const fetchImpl = opts.fetch ?? fetch;
  return {
    name: `anthropic:${opts.model}`,
    async answer(req) {
      const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': opts.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: opts.maxTokens ?? 512,
          temperature: 0,
          messages: [{ role: 'user', content: answerPrompt(req) }],
        }),
      });
      if (!res.ok) {
        throw new Error(`answerer ${opts.model} returned ${res.status}: ${await res.text()}`);
      }
      const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      return (body.content ?? [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('')
        .trim();
    },
  };
};
