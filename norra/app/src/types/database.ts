/**
 * Types for the Norra OS schema.
 *
 * Hand-written to mirror `norra/supabase/migrations`. Once the project is
 * linked, regenerate instead of editing by hand:
 *
 *   supabase gen types typescript --linked > app/src/types/database.ts
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type UserRole = 'admin' | 'agent' | 'customer';
export type AgentStatus = 'draft' | 'live' | 'archived';
export type ConversationChannel = 'web' | 'email' | 'whatsapp' | 'voice' | 'slack' | 'api';
export type ConversationStatus = 'open' | 'pending' | 'escalated' | 'resolved' | 'closed';
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';
export type KbSourceType = 'upload' | 'url' | 'text' | 'shopify';
export type KbDocumentStatus = 'pending' | 'processing' | 'ready' | 'failed';
export type TicketStatus = 'open' | 'pending' | 'solved' | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TicketSource = 'agent_escalation' | 'manual' | 'email' | 'api';
export type ToolCallStatus = 'pending' | 'success' | 'error';

/** Keys whose column accepts NULL. Postgres lets those be omitted on insert. */
type NullableKeys<Row> = { [K in keyof Row]-?: null extends Row[K] ? K : never }[keyof Row];

/**
 * Insert shape: columns the database fills in itself (`Defaulted`) and columns
 * that accept NULL are both optional. Everything else stays required.
 */
type WithDefaults<Row, Defaulted extends keyof Row> = Omit<Row, Defaulted | NullableKeys<Row>> &
  Partial<Pick<Row, Defaulted | NullableKeys<Row>>>;

export type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  settings: Json;
  created_at: string;
  updated_at: string;
}

export type UserRow = {
  id: string;
  organization_id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export type AgentRow = {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description: string | null;
  status: AgentStatus;
  system_prompt: string;
  model: string;
  temperature: number;
  max_tokens: number;
  guardrails: Json;
  tools: Json;
  escalation_rules: Json;
  channels: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ConversationRow = {
  id: string;
  organization_id: string;
  agent_id: string | null;
  channel: ConversationChannel;
  external_id: string | null;
  end_user_name: string | null;
  end_user_email: string | null;
  end_user_external_id: string | null;
  status: ConversationStatus;
  assigned_user_id: string | null;
  title: string | null;
  metadata: Json;
  last_message_at: string | null;
  escalated_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type MessageRow = {
  id: string;
  seq: number;
  organization_id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  content_json: Json | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  latency_ms: number | null;
  n8n_execution_id: string | null;
  created_at: string;
}

export type KnowledgeBaseDocumentRow = {
  id: string;
  organization_id: string;
  agent_id: string | null;
  title: string;
  source_type: KbSourceType;
  source_url: string | null;
  storage_path: string | null;
  mime_type: string | null;
  checksum: string | null;
  status: KbDocumentStatus;
  error: string | null;
  chunk_count: number;
  metadata: Json;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type KnowledgeBaseChunkRow = {
  id: string;
  organization_id: string;
  document_id: string;
  content: string;
  metadata: Json;
  /** pgvector column; serialised as a string over PostgREST. */
  embedding: string | null;
  chunk_index: number | null;
  token_count: number | null;
  created_at: string;
}

export type TicketRow = {
  id: string;
  number: number;
  organization_id: string;
  conversation_id: string | null;
  agent_id: string | null;
  subject: string;
  description: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  source: TicketSource;
  assignee_id: string | null;
  tags: string[];
  external_ref: Json;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export type ToolCallLogRow = {
  id: string;
  organization_id: string;
  conversation_id: string | null;
  message_id: string | null;
  agent_id: string | null;
  tool_name: string;
  n8n_workflow_id: string | null;
  n8n_execution_id: string | null;
  input: Json;
  output: Json | null;
  status: ToolCallStatus;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
}

/** A foreign key, in the shape PostgREST's select parser expects. */
type Rel<Name extends string, Column extends string, Target extends string> = {
  foreignKeyName: Name;
  columns: [Column];
  isOneToOne: false;
  referencedRelation: Target;
  referencedColumns: ['id'];
};

type OrgRel<T extends string> = Rel<`${T}_organization_id_fkey`, 'organization_id', 'organizations'>;

type Table<Row, Defaulted extends keyof Row, Relationships extends readonly unknown[] = []> = {
  Row: Row;
  Insert: WithDefaults<Row, Defaulted>;
  Update: Partial<WithDefaults<Row, Defaulted>>;
  Relationships: Relationships;
};

type Timestamps = 'id' | 'created_at' | 'updated_at';

export type Database = {
  public: {
    Tables: {
      organizations: Table<OrganizationRow, Timestamps | 'settings'>;

      users: Table<UserRow, Timestamps | 'role', [OrgRel<'users'>]>;

      agents: Table<
        AgentRow,
        | Timestamps
        | 'status'
        | 'system_prompt'
        | 'model'
        | 'temperature'
        | 'max_tokens'
        | 'guardrails'
        | 'tools'
        | 'escalation_rules'
        | 'channels',
        [OrgRel<'agents'>, Rel<'agents_created_by_fkey', 'created_by', 'users'>]
      >;

      conversations: Table<
        ConversationRow,
        Timestamps | 'channel' | 'status' | 'metadata',
        [
          OrgRel<'conversations'>,
          Rel<'conversations_agent_id_fkey', 'agent_id', 'agents'>,
          Rel<'conversations_assigned_user_id_fkey', 'assigned_user_id', 'users'>,
        ]
      >;

      messages: Table<
        MessageRow,
        'id' | 'seq' | 'created_at' | 'content',
        [OrgRel<'messages'>, Rel<'messages_conversation_id_fkey', 'conversation_id', 'conversations'>]
      >;

      knowledge_base_documents: Table<
        KnowledgeBaseDocumentRow,
        Timestamps | 'source_type' | 'status' | 'chunk_count' | 'metadata',
        [
          OrgRel<'knowledge_base_documents'>,
          Rel<'knowledge_base_documents_agent_id_fkey', 'agent_id', 'agents'>,
          Rel<'knowledge_base_documents_created_by_fkey', 'created_by', 'users'>,
        ]
      >;

      knowledge_base_chunks: Table<
        KnowledgeBaseChunkRow,
        'id' | 'created_at' | 'metadata' | 'organization_id' | 'document_id',
        [
          OrgRel<'knowledge_base_chunks'>,
          Rel<'knowledge_base_chunks_document_id_fkey', 'document_id', 'knowledge_base_documents'>,
        ]
      >;

      tickets: Table<
        TicketRow,
        Timestamps | 'number' | 'status' | 'priority' | 'source' | 'tags' | 'external_ref',
        [
          OrgRel<'tickets'>,
          Rel<'tickets_conversation_id_fkey', 'conversation_id', 'conversations'>,
          Rel<'tickets_agent_id_fkey', 'agent_id', 'agents'>,
          Rel<'tickets_assignee_id_fkey', 'assignee_id', 'users'>,
        ]
      >;

      tool_calls_log: Table<
        ToolCallLogRow,
        'id' | 'created_at' | 'input' | 'status',
        [
          OrgRel<'tool_calls_log'>,
          Rel<'tool_calls_log_conversation_id_fkey', 'conversation_id', 'conversations'>,
          Rel<'tool_calls_log_message_id_fkey', 'message_id', 'messages'>,
          Rel<'tool_calls_log_agent_id_fkey', 'agent_id', 'agents'>,
        ]
      >;
    };
    Views: Record<never, never>;
    Functions: {
      match_kb_chunks: {
        Args: {
          query_embedding: string;
          match_count?: number;
          filter?: Json;
          p_organization_id?: string;
        };
        Returns: Array<{
          id: string;
          content: string;
          metadata: Json;
          similarity: number;
        }>;
      };
    };
    Enums: {
      user_role: UserRole;
      agent_status: AgentStatus;
      conversation_channel: ConversationChannel;
      conversation_status: ConversationStatus;
      message_role: MessageRole;
      kb_source_type: KbSourceType;
      kb_document_status: KbDocumentStatus;
      ticket_status: TicketStatus;
      ticket_priority: TicketPriority;
      ticket_source: TicketSource;
      tool_call_status: ToolCallStatus;
    };
    CompositeTypes: Record<never, never>;
  };
};
