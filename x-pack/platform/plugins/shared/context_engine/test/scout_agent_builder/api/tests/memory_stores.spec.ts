/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { randomUUID } from 'crypto';
import { CONTEXT_ENGINE_MEMORY_ENABLED_SETTING_ID } from '@kbn/management-settings-ids';
import { tags } from '@kbn/scout';
import { expect } from '@kbn/scout/api';
import { apiTest, testData } from '../fixtures';

const { INTERNAL_API_HEADERS, CONTEXT_ENGINE_ALL } = testData;

const RUN_ID = randomUUID().slice(0, 8);
const ROLE_NAME = `scout_memory_stores_${RUN_ID}`;
const SESSION_ID = `scout-session-${RUN_ID}`;
const RECALL_SESSION_ID = `scout-recall-session-${RUN_ID}`;

const SESSION_MEMORIES_PATH = 'internal/context_engine/session_memories';
const TRANSCRIPTS_PATH = 'internal/context_engine/transcripts';
const RECALL_PATH = 'internal/context_engine/_recall';

interface NativeUser {
  username: string;
  password: string;
}

const alice: NativeUser = { username: `scout_mem_alice_${RUN_ID}`, password: 'changeme-alice' };
const bob: NativeUser = { username: `scout_mem_bob_${RUN_ID}`, password: 'changeme-bob' };

/** Basic auth as a native user: the stores scope everything to the user a request runs as. */
const headersFor = ({ username, password }: NativeUser) => ({
  ...INTERNAL_API_HEADERS,
  Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
});

interface RecallBody {
  results: Array<{ source: string; id: string; session_id?: string; content: string }>;
  reranked: boolean;
  sources: Array<{ source: string; candidates: number }>;
}

// Native users and basic auth are stateful-only. The `agent_builder` config set pins
// `contextEngine:enabled`; memory is turned on for this suite only.
apiTest.describe(
  'context engine session memory, transcript and recall APIs',
  { tag: tags.stateful.classic },
  () => {
    apiTest.beforeAll(async ({ esClient, kbnClient }) => {
      await kbnClient.uiSettings.updateGlobal({ [CONTEXT_ENGINE_MEMORY_ENABLED_SETTING_ID]: true });
      await kbnClient.uiSettings.waitForEventualCacheRefresh();

      await kbnClient.request({
        method: 'PUT',
        path: `/api/security/role/${ROLE_NAME}`,
        body: { elasticsearch: { cluster: [], indices: [] }, kibana: [CONTEXT_ENGINE_ALL] },
      });
      for (const { username, password } of [alice, bob]) {
        await esClient.security.putUser({
          username,
          password,
          roles: [ROLE_NAME],
          refresh: 'wait_for',
        });
      }
    });

    apiTest.afterAll(async ({ apiClient, esClient, kbnClient }) => {
      for (const user of [alice, bob]) {
        for (const sessionId of [SESSION_ID, RECALL_SESSION_ID]) {
          await apiClient.post(`${SESSION_MEMORIES_PATH}/_bulk_delete`, {
            headers: headersFor(user),
            body: { session_id: sessionId },
          });
        }
        await apiClient.post(`${TRANSCRIPTS_PATH}/_bulk_delete`, {
          headers: headersFor(user),
          body: { session_ids: [SESSION_ID, RECALL_SESSION_ID] },
        });
        await esClient.security.deleteUser({ username: user.username }, { ignore: [404] });
      }
      await kbnClient.request({
        method: 'DELETE',
        path: `/api/security/role/${ROLE_NAME}`,
        ignoreErrors: [404],
      });
      await kbnClient.uiSettings.updateGlobal({
        [CONTEXT_ENGINE_MEMORY_ENABLED_SETTING_ID]: false,
      });
      await kbnClient.uiSettings.waitForEventualCacheRefresh();
    });

    apiTest(
      'writes, lists and deletes session memories of their owner only',
      async ({ apiClient }) => {
        const written = await apiClient.post(`${SESSION_MEMORIES_PATH}/_bulk`, {
          headers: headersFor(alice),
          responseType: 'json',
          body: {
            memories: [
              {
                id: 'safari',
                session_id: SESSION_ID,
                agent_id: 'scout-agent',
                type: 'memory.session_fact',
                title: 'Safari billing crash',
                content: 'Safari crashes on the billing page when the invoice preview loads.',
                tags: ['billing'],
              },
              {
                id: 'expired',
                session_id: SESSION_ID,
                type: 'memory.session',
                title: 'Old summary',
                content: 'Already past its expiry.',
                expires_at: '2020-01-01T00:00:00.000Z',
              },
            ],
          },
        });
        expect(written).toHaveStatusCode(200);
        expect(written.body).toStrictEqual({
          items: [
            { id: 'safari', result: 'created' },
            { id: 'expired', result: 'created' },
          ],
        });

        const rewritten = await apiClient.post(`${SESSION_MEMORIES_PATH}/_bulk`, {
          headers: headersFor(alice),
          responseType: 'json',
          body: {
            memories: [
              {
                id: 'safari',
                session_id: SESSION_ID,
                agent_id: 'scout-agent',
                type: 'memory.session_fact',
                title: 'Safari billing crash',
                content: 'Safari crashes on the billing page; fixed in 3.2.',
                expires_at: null,
              },
            ],
          },
        });
        expect(rewritten.body).toStrictEqual({ items: [{ id: 'safari', result: 'updated' }] });

        const listed = await apiClient.get(`${SESSION_MEMORIES_PATH}?session_id=${SESSION_ID}`, {
          headers: headersFor(alice),
          responseType: 'json',
        });
        expect(listed).toHaveStatusCode(200);
        expect(listed.body.total).toBe(1);
        expect(listed.body.memories[0]).toMatchObject({
          id: 'safari',
          content: 'Safari crashes on the billing page; fixed in 3.2.',
        });
        expect(listed.body.memories[0].expires_at).toBeUndefined();

        const otherOwner = await apiClient.get(
          `${SESSION_MEMORIES_PATH}?session_id=${SESSION_ID}`,
          {
            headers: headersFor(bob),
            responseType: 'json',
          }
        );
        expect(otherOwner.body.total).toBe(0);

        const othersDelete = await apiClient.post(`${SESSION_MEMORIES_PATH}/_bulk_delete`, {
          headers: headersFor(bob),
          responseType: 'json',
          body: { ids: ['safari'] },
        });
        expect(othersDelete.body).toStrictEqual({ deleted: 0 });
      }
    );

    apiTest('stores, appends to, returns and deletes a transcript', async ({ apiClient }) => {
      const path = `${TRANSCRIPTS_PATH}/${SESSION_ID}`;
      const created = await apiClient.put(path, {
        headers: headersFor(alice),
        responseType: 'json',
        body: {
          source: 'scout',
          agent_id: 'scout-agent',
          title: 'Trip planning',
          started_at: '2026-10-01T09:00:00.000Z',
          turns: [
            { role: 'user', content: 'I am flying to Lisbon and need a hotel near Alfama.' },
            { role: 'assistant', content: 'Memmo Alfama is walkable to the castle.' },
          ],
        },
      });
      expect(created).toHaveStatusCode(201);
      expect(created.body).toStrictEqual({
        session_id: SESSION_ID,
        result: 'created',
        turn_count: 2,
        chunk_count: 1,
      });

      const appended = await apiClient.put(path, {
        headers: headersFor(alice),
        responseType: 'json',
        body: {
          source: 'scout',
          mode: 'append',
          turns: [{ role: 'user', content: 'My budget is 180 EUR per night.' }],
        },
      });
      expect(appended).toHaveStatusCode(200);
      expect(appended.body).toMatchObject({ result: 'updated', turn_count: 3, chunk_count: 2 });

      const conflicting = await apiClient.put(path, {
        headers: headersFor(alice),
        responseType: 'json',
        body: { source: 'other', mode: 'append', turns: [{ role: 'user', content: 'x' }] },
      });
      expect(conflicting).toHaveStatusCode(409);

      const fetched = await apiClient.get(path, {
        headers: headersFor(alice),
        responseType: 'json',
      });
      expect(fetched).toHaveStatusCode(200);
      expect(fetched.body).toMatchObject({
        session_id: SESSION_ID,
        source: 'scout',
        agent_id: 'scout-agent',
        title: 'Trip planning',
      });
      expect(fetched.body.turns.map(({ content }: { content: string }) => content)).toStrictEqual([
        'I am flying to Lisbon and need a hotel near Alfama.',
        'Memmo Alfama is walkable to the castle.',
        'My budget is 180 EUR per night.',
      ]);

      const othersFetch = await apiClient.get(path, {
        headers: headersFor(bob),
        responseType: 'json',
      });
      expect(othersFetch).toHaveStatusCode(404);
      const othersDelete = await apiClient.delete(path, {
        headers: headersFor(bob),
        responseType: 'json',
      });
      expect(othersDelete).toHaveStatusCode(404);

      const deleted = await apiClient.delete(path, {
        headers: headersFor(alice),
        responseType: 'json',
      });
      expect(deleted).toHaveStatusCode(200);
      expect(deleted.body).toStrictEqual({ deleted: true });
      const gone = await apiClient.get(path, { headers: headersFor(alice), responseType: 'json' });
      expect(gone).toHaveStatusCode(404);
    });

    apiTest("recalls the caller's own memories and transcripts", async ({ apiClient }) => {
      const memoryWrite = await apiClient.post(`${SESSION_MEMORIES_PATH}/_bulk`, {
        headers: headersFor(alice),
        responseType: 'json',
        body: {
          memories: [
            {
              id: 'recall-safari',
              session_id: RECALL_SESSION_ID,
              type: 'memory.session_fact',
              title: 'Safari billing crash',
              content: 'Safari crashes on the billing page when the invoice preview loads.',
            },
          ],
        },
      });
      expect(memoryWrite).toHaveStatusCode(200);
      const transcriptWrite = await apiClient.put(`${TRANSCRIPTS_PATH}/${RECALL_SESSION_ID}`, {
        headers: headersFor(alice),
        responseType: 'json',
        body: {
          source: 'scout',
          turns: [
            { role: 'user', content: 'I need a hotel in Lisbon near Alfama.' },
            { role: 'user', content: 'My budget is 180 EUR per night.' },
          ],
        },
      });
      expect(transcriptWrite).toHaveStatusCode(201);

      const recall = async (user: NativeUser, body: Record<string, unknown>) => {
        const response = await apiClient.post(RECALL_PATH, {
          headers: headersFor(user),
          responseType: 'json',
          body: {
            sources: ['session_memories', 'transcripts'],
            // Model reranking is covered by unit tests; CI clusters may not deploy the reranker.
            rerank: { enabled: false },
            ...body,
          },
        });
        expect(response).toHaveStatusCode(200);
        return response.body as RecallBody;
      };

      const own = await recall(alice, {
        query: 'Safari billing Lisbon hotel budget',
        filters: { session_ids: [RECALL_SESSION_ID] },
      });
      expect(own.reranked).toBe(false);
      const ids = own.results.map(({ id }) => id);
      expect(ids).toContain('recall-safari');
      expect(ids).toContain(`${RECALL_SESSION_ID}#0`);
      expect(
        own.results.every(({ session_id: sessionId }) => sessionId === RECALL_SESSION_ID)
      ).toBe(true);

      const transcriptsOnly = await recall(alice, {
        query: 'budget per night',
        sources: ['transcripts'],
        filters: { session_ids: [RECALL_SESSION_ID] },
        max_content_chars: 20,
      });
      expect(transcriptsOnly.results.length).toBeGreaterThan(0);
      expect(transcriptsOnly.results.every(({ content }) => content.length <= 20)).toBe(true);

      const others = await recall(bob, { query: 'Safari billing Lisbon hotel budget' });
      expect(others.results).toStrictEqual([]);
    });

    apiTest('rejects unbounded or malformed requests', async ({ apiClient }) => {
      for (const [path, body] of [
        [RECALL_PATH, { query: '' }],
        [RECALL_PATH, { query: 'q', limit: 100_000 }],
        [`${SESSION_MEMORIES_PATH}/_bulk_delete`, {}],
        [
          `${SESSION_MEMORIES_PATH}/_bulk`,
          {
            memories: [
              { session_id: '_reserved', type: 'memory.session', title: 't', content: 'c' },
            ],
          },
        ],
      ] as const) {
        const response = await apiClient.post(path, {
          headers: headersFor(alice),
          responseType: 'json',
          body,
        });
        expect(response).toHaveStatusCode(400);
      }
    });
  }
);
