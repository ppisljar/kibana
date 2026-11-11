/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { TranscriptTurn } from '../../common/http_api/transcripts';
import { chunkTranscriptTurns, renderTurn } from './transcript_chunks';

const turn = (
  role: TranscriptTurn['role'],
  content: string,
  extra: Partial<TranscriptTurn> = {}
) => ({
  role,
  content,
  ...extra,
});

describe('renderTurn', () => {
  it('labels the role, and the name when there is one', () => {
    expect(renderTurn(turn('user', 'hi'))).toBe('User: hi');
    expect(renderTurn(turn('tool', '{"ok":true}', { name: 'search' }))).toBe(
      'Tool (search): {"ok":true}'
    );
  });
});

describe('chunkTranscriptTurns', () => {
  it('keeps short sessions in one chunk', () => {
    const turns = [
      turn('user', 'Where should I stay?', { timestamp: '2026-10-01T09:00:00Z' }),
      turn('assistant', 'Alfama.'),
    ];
    expect(chunkTranscriptTurns(turns)).toEqual([
      {
        turn_start: 0,
        turn_end: 1,
        roles: ['user', 'assistant'],
        content: 'User: Where should I stay?\nAssistant: Alfama.',
        turns,
        timestamp: '2026-10-01T09:00:00Z',
      },
    ]);
  });

  it('starts a new chunk when the next turn would pass the size, never splitting a turn that fits', () => {
    const turns = [
      turn('user', 'a'.repeat(10)),
      turn('assistant', 'b'.repeat(10)),
      turn('user', 'c'),
    ];
    // "User: aaaaaaaaaa" is 16 characters, "Assistant: bbbbbbbbbb" 21.
    const chunks = chunkTranscriptTurns(turns, { maxChars: 30 });
    expect(chunks.map(({ turn_start: start, turn_end: end }) => [start, end])).toEqual([
      [0, 0],
      [1, 2],
    ]);
    expect(chunks.every(({ content }) => content.length <= 30)).toBe(true);
    expect(chunks.flatMap(({ turns: chunkTurns }) => chunkTurns)).toEqual(turns);
  });

  it('gives an oversized turn chunks of its own, keeping the whole turn only in the first', () => {
    const long = turn('assistant', 'x'.repeat(50), { timestamp: '2026-10-01T10:00:00Z' });
    const chunks = chunkTranscriptTurns([turn('user', 'q'), long, turn('user', 'thanks')], {
      maxChars: 20,
    });
    // "Assistant: " plus 50 characters is 61: four chunks of at most 20.
    expect(chunks.map(({ turn_start: start, turn_end: end }) => [start, end])).toEqual([
      [0, 0],
      [1, 1],
      [1, 1],
      [1, 1],
      [1, 1],
      [2, 2],
    ]);
    expect(
      chunks
        .slice(1, 5)
        .map(({ content }) => content)
        .join('')
    ).toBe(renderTurn(long));
    expect(chunks[1].turns).toEqual([long]);
    expect(chunks[2].turns).toEqual([]);
    expect(chunks[2].timestamp).toBe('2026-10-01T10:00:00Z');
  });

  it('numbers turns from firstTurn, for appends', () => {
    const [chunk] = chunkTranscriptTurns([turn('user', 'more')], { firstTurn: 7 });
    expect(chunk).toMatchObject({ turn_start: 7, turn_end: 7 });
  });

  it('returns no chunks for no turns', () => {
    expect(chunkTranscriptTurns([])).toEqual([]);
  });
});
