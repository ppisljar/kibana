/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  TRANSCRIPT_CHUNK_MAX_CHARS,
  type TranscriptRole,
  type TranscriptTurn,
} from '../../common/http_api/transcripts';

export interface TranscriptChunk {
  /** Zero-based, inclusive, in the numbering of the whole session. */
  turn_start: number;
  turn_end: number;
  roles: TranscriptRole[];
  /** The searchable rendering, one `Role: text` line per turn. */
  content: string;
  /** Turns that start in this chunk. A turn split over several chunks sits whole in its first. */
  turns: TranscriptTurn[];
  timestamp?: string;
}

const ROLE_LABELS: Record<TranscriptRole, string> = {
  user: 'User',
  assistant: 'Assistant',
  system: 'System',
  tool: 'Tool',
};

export const renderTurn = ({ role, name, content }: TranscriptTurn): string =>
  `${ROLE_LABELS[role]}${name ? ` (${name})` : ''}: ${content}`;

interface PendingChunk {
  lines: string[];
  size: number;
  turnStart: number;
  turnEnd: number;
  roles: Set<TranscriptRole>;
  turns: TranscriptTurn[];
  timestamp?: string;
}

/**
 * Groups consecutive turns into chunks of at most `maxChars` rendered characters. A turn longer
 * than `maxChars` gets chunks of its own, split on character boundaries.
 */
export const chunkTranscriptTurns = (
  turns: readonly TranscriptTurn[],
  {
    firstTurn = 0,
    maxChars = TRANSCRIPT_CHUNK_MAX_CHARS,
  }: { firstTurn?: number; maxChars?: number } = {}
): TranscriptChunk[] => {
  const chunks: TranscriptChunk[] = [];
  let pending: PendingChunk | undefined;

  const flush = () => {
    if (!pending) {
      return;
    }
    chunks.push({
      turn_start: pending.turnStart,
      turn_end: pending.turnEnd,
      roles: [...pending.roles],
      content: pending.lines.join('\n'),
      turns: pending.turns,
      ...(pending.timestamp !== undefined && { timestamp: pending.timestamp }),
    });
    pending = undefined;
  };

  turns.forEach((turn, offset) => {
    const turnIndex = firstTurn + offset;
    const line = renderTurn(turn);

    if (line.length > maxChars) {
      flush();
      for (let start = 0; start < line.length; start += maxChars) {
        chunks.push({
          turn_start: turnIndex,
          turn_end: turnIndex,
          roles: [turn.role],
          content: line.slice(start, start + maxChars),
          turns: start === 0 ? [turn] : [],
          ...(turn.timestamp !== undefined && { timestamp: turn.timestamp }),
        });
      }
      return;
    }

    // `+ 1` for the newline that joins it to the previous line.
    if (pending && pending.size + 1 + line.length > maxChars) {
      flush();
    }
    if (!pending) {
      pending = {
        lines: [],
        size: -1,
        turnStart: turnIndex,
        turnEnd: turnIndex,
        roles: new Set(),
        turns: [],
        ...(turn.timestamp !== undefined && { timestamp: turn.timestamp }),
      };
    }
    pending.lines.push(line);
    pending.size += line.length + 1;
    pending.turnEnd = turnIndex;
    pending.roles.add(turn.role);
    pending.turns.push(turn);
  });
  flush();

  return chunks;
};
