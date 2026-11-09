/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type {
  ConversationAccessControl,
  ConversationAccessControlEntryInput,
  ConversationAccessControlMode,
  ConversationAddEventInput,
  ConversationEvent,
  ConversationWithPermissions,
  ConversationWithoutRoundsWithPermissions,
} from '@kbn/agent-builder-common';

export type {
  ConversationPermissions,
  ConversationWithPermissions,
  ConversationWithoutRoundsWithPermissions,
} from '@kbn/agent-builder-common';

export type GetConversationResponse = ConversationWithPermissions;

export type ListConversationsResponseItem = ConversationWithoutRoundsWithPermissions;

export interface ListConversationsResponse {
  pagination: {
    total: number;
    page: number;
    per_page: number;
  };
  results: ListConversationsResponseItem[];
}

export type SearchConversationsResponse = ListConversationsResponse;

export interface DeleteConversationResponse {
  success: boolean;
}

export interface RenameConversationResponse {
  id: string;
  title: string;
}

export interface MarkReadConversationResponse {
  id: string;
  read: boolean;
}

export interface MarkPinnedConversationResponse {
  id: string;
  pinned: boolean;
}

export type CreateConversationResponse = ConversationWithPermissions;

export interface UpdateConversationAccessControlRequestBody {
  access_mode: ConversationAccessControlMode;
  entries: ConversationAccessControlEntryInput[];
}

export type UpdateConversationAccessControlResponse = ConversationAccessControl;

export interface AddConversationEventsRequestBody {
  events: ConversationAddEventInput[];
}

export interface AddConversationEventsResponse {
  events: ConversationEvent[];
}

/** One round of an imported transcript. Carries no agent state, tool calls, or attachments. */
export interface ImportConversationRoundInput {
  user_message: string;
  assistant_message: string;
  /** ISO timestamp. Defaults to the time the import is processed. */
  started_at?: string;
}

/**
 * Body for `POST /internal/agent_builder/conversations/_import`. No agent runs: the rounds are
 * stored verbatim with empty steps and zeroed usage. `mode: 'overwrite'` replaces an existing
 * conversation owned by the current user; `create` (default) fails with 409 if the id exists.
 */
export interface ImportConversationRequestBody {
  agent_id: string;
  id?: string;
  title?: string;
  mode?: 'create' | 'overwrite';
  rounds: ImportConversationRoundInput[];
}

export interface ImportConversationResponse {
  conversation_id: string;
  round_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Body for `POST /internal/agent_builder/conversations/_bulk_delete`. Always scoped to the
 * current user's conversations. At least one filter must be set.
 */
export interface BulkDeleteConversationsRequestBody {
  conversation_ids?: string[];
  agent_id?: string;
  /** Inclusive lower bound on `created_at`, ISO timestamp. */
  created_after?: string;
  /** Inclusive upper bound on `created_at`, ISO timestamp. */
  created_before?: string;
  /** Report counts without deleting. */
  dry_run?: boolean;
}

export interface BulkDeleteConversationsResponse {
  deleted: number;
  matched: number;
  not_found: string[];
}
