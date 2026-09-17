/**
 * Types for the Norra schema.
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
export type KbSourceType = 'upload' | 'url' | 'text' | 'api';
export type KbDocumentStatus = 'pending' | 'processing' | 'ready' | 'failed';
export type TicketStatus = 'open' | 'pending' | 'solved' | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TicketSource = 'agent_escalation' | 'manual' | 'email' | 'api';
export type ToolCallStatus = 'pending' | 'success' | 'error';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type AuditAction = 'create' | 'update' | 'delete' | 'approve' | 'reject' | 'takeover' | 'release';
export type TestRunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'error';
export type TelephonyProvider = 'twilio';
export type PhoneNumberStatus = 'unconfigured' | 'active' | 'paused';
export type AfterHoursBehavior = 'agent' | 'voicemail' | 'transfer' | 'reject';
export type CallStatus =
  | 'ringing' | 'in_progress' | 'completed' | 'failed' | 'no_answer' | 'busy' | 'transferred' | 'voicemail';
export type CallDirection = 'inbound' | 'outbound';
export type CallbackStatus = 'pending' | 'done' | 'cancelled';
/** Nachbereitung eines Anrufs. `skipped` heißt: der Agent hatte nichts zu extrahieren. */
export type WrapupStatus = 'pending' | 'skipped' | 'done' | 'failed';
export type CampaignStatus = 'draft' | 'running' | 'paused' | 'done';
export type MessageUrgency = 'normal' | 'dringend';
export type StaffMessageStatus = 'neu' | 'zugestellt' | 'erledigt';
export type TargetOutcome =
  | 'pending' | 'reached' | 'no_answer' | 'busy' | 'voicemail' | 'failed' | 'opted_out';
/** Twilios Anrufbeantworter-Erkennung. Nur bei ausgehenden Anrufen gesetzt. */
export type AnsweredBy = 'human' | 'machine' | 'fax' | 'unknown';

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
  escalation_email: string | null;
  timezone: string;
  locale: string;
  created_at: string;
  updated_at: string;
}

/**
 * Opening hours per weekday, local to the number's timezone. A day with no
 * entry is closed; `[["08:00", "12:00"], ["13:00", "17:00"]]` is a lunch break.
 */
export type BusinessHours = Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', Array<[string, string]>>>;

export type PhoneNumberRow = {
  id: string;
  organization_id: string;
  e164: string;
  label: string | null;
  provider: TelephonyProvider;
  provider_sid: string | null;
  agent_id: string | null;
  greeting: string;
  voice: string;
  language: string;
  transfer_number: string | null;
  voicemail_message: string | null;
  max_call_seconds: number;
  recording_enabled: boolean;
  /** Ansage vor dem Mitschnitt. Ohne sie darf recording_enabled nicht gesetzt werden. */
  recording_notice: string | null;
  business_hours: Json;
  timezone: string;
  after_hours: AfterHoursBehavior;
  status: PhoneNumberStatus;
  last_call_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type CallRow = {
  id: string;
  organization_id: string;
  phone_number_id: string | null;
  /** The caller behind this row, once the number resolved. Null for chat and widget. */
  contact_id: string | null;
  conversation_id: string | null;
  agent_id: string | null;
  direction: CallDirection;
  provider_call_id: string;
  from_e164: string | null;
  to_e164: string | null;
  status: CallStatus;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  turn_count: number;
  recording_url: string | null;
  transferred_to: string | null;
  /** Ansage für den Mitarbeiter vor dem Verbinden. Der Anrufer hört sie nicht. */
  transfer_briefing: string | null;
  ended_reason: string | null;
  /** Nach Gesprächsende gezogen, Schlüssel = agents.voice_config.extract[].name. */
  extracted_variables: Json;
  summary: string | null;
  /** pending | skipped | done | failed — trennt "nichts gefunden" von "nicht gelaufen". */
  wrapup_status: WrapupStatus;
  /** Das Ziel einer Kampagne, wenn dieser Anruf ausgehend war. */
  campaign_target_id: string | null;
  answered_by: AnsweredBy | null;
  created_at: string;
  updated_at: string;
}

export type StaffMemberRow = {
  id: string;
  organization_id: string;
  name: string;
  role: string | null;
  /** Gewählt wird immer hier. Die Durchwahl ist nur, was ein Anrufer nennt. */
  e164: string | null;
  extension: string | null;
  email: string | null;
  accepts_transfers: boolean;
  accepts_messages: boolean;
  active: boolean;
  /** Was der Agent über diese Person sagen darf. */
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type StaffMessageRow = {
  id: string;
  organization_id: string;
  staff_member_id: string;
  call_id: string | null;
  conversation_id: string | null;
  contact_id: string | null;
  caller_name: string | null;
  caller_e164: string | null;
  body: string;
  urgency: MessageUrgency;
  status: StaffMessageStatus;
  delivered_at: string | null;
  handled_at: string | null;
  handled_by: string | null;
  created_at: string;
  updated_at: string;
}

export type CallCampaignRow = {
  id: string;
  organization_id: string;
  name: string;
  agent_id: string | null;
  phone_number_id: string | null;
  /** Was der Agent erreichen soll, in einem Satz. Wandert in den Gesprächskontext. */
  goal: string;
  opening_line: string;
  status: CampaignStatus;
  /** {"mon": ["09:00","17:00"], …}. Ein fehlender Tag heißt: an dem Tag wird nicht angerufen. */
  calling_window: Json;
  timezone: string;
  max_attempts: number;
  retry_after_minutes: number;
  max_concurrent: number;
  started_at: string | null;
  finished_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type CampaignTargetRow = {
  id: string;
  organization_id: string;
  campaign_id: string;
  e164: string;
  contact_id: string | null;
  display_name: string | null;
  /** Was dieser eine Angerufene mitbringt: Vorgangsnummer, Termin, Betrag. */
  context: Json;
  outcome: TargetOutcome;
  attempts: number;
  /** `null` heißt: nie wieder — der Zustand nach einem endgültigen Ergebnis. */
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  last_call_id: string | null;
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
  /** Origins allowed to mint a widget session for this agent. Empty = any. */
  allowed_origins: string[];
  /** {keyterms, extract, followup} — Telefon-Feinschliff. Leer = aus. */
  voice_config: Json;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ConversationRow = {
  id: string;
  organization_id: string;
  agent_id: string | null;
  /** The caller behind this row, once the number resolved. Null for chat and widget. */
  contact_id: string | null;
  channel: ConversationChannel;
  external_id: string | null;
  end_user_name: string | null;
  end_user_email: string | null;
  end_user_external_id: string | null;
  status: ConversationStatus;
  assigned_user_id: string | null;
  title: string | null;
  topic: string | null;
  csat: number | null;
  knowledge_gap: boolean;
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

export type ApprovalRow = {
  id: string;
  organization_id: string;
  conversation_id: string | null;
  agent_id: string | null;
  ticket_id: string | null;
  tool_name: string;
  summary: string;
  payload: Json;
  amount: number | null;
  currency: string | null;
  status: ApprovalStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export type AuditLogRow = {
  id: string;
  organization_id: string;
  actor_id: string | null;
  actor_label: string;
  action: AuditAction;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  changes: Json;
  created_at: string;
};

export type AgentTestCaseRow = {
  id: string;
  organization_id: string;
  agent_id: string;
  name: string;
  input: string;
  expect_contains: string[];
  expect_absent: string[];
  expect_tool: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AgentTestRunRow = {
  id: string;
  organization_id: string;
  agent_id: string;
  test_case_id: string;
  status: TestRunStatus;
  output: string | null;
  failures: string[];
  tools_used: string[];
  duration_ms: number | null;
  n8n_execution_id: string | null;
  created_at: string;
};

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

/**
 * A caller, recognised by their number.
 *
 * Created by the first call with nothing but `e164` filled in; everything a
 * human knows about them arrives later. See `touch_contact` in the schema.
 */
export type ContactRow = {
  id: string;
  organization_id: string;
  e164: string;
  display_name: string | null;
  email: string | null;
  note: string | null;
  first_seen_at: string;
  last_seen_at: string;
  call_count: number;
  created_at: string;
  updated_at: string;
}

/** A promise to ring someone back. `requested_for` stays null unless the caller named a time. */
export type CallbackRow = {
  id: string;
  organization_id: string;
  conversation_id: string | null;
  contact_id: string | null;
  e164: string;
  requested_for: string | null;
  preference: string | null;
  reason: string;
  status: CallbackStatus;
  assignee_id: string | null;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * A number the agent may transfer to, and the words it uses to choose.
 *
 * `description` is written for a model, not a human: the agent reads it to
 * decide. `e164` never leaves the server — the agent names the department, the
 * voice route looks the number up here.
 */
export type PhoneDepartmentRow = {
  id: string;
  organization_id: string;
  name: string;
  e164: string;
  description: string;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Ein Tag oder Zeitraum, an dem geschlossen ist.
 *
 * `phone_number_id = null` heißt: alle Leitungen dieser Organisation. Der
 * Normalfall — an Weihnachten ist das ganze Haus zu, nicht eine Durchwahl.
 */
export type ClosureDayRow = {
  id: string;
  organization_id: string;
  phone_number_id: string | null;
  starts_on: string;
  ends_on: string;
  label: string;
  /** Leer heißt: es gilt, was unter `after_hours` für die Nummer eingestellt ist. */
  message: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
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
        | 'channels'
        | 'allowed_origins'
        | 'voice_config',
        [OrgRel<'agents'>, Rel<'agents_created_by_fkey', 'created_by', 'users'>]
      >;

      conversations: Table<
        ConversationRow,
        Timestamps | 'channel' | 'status' | 'metadata' | 'knowledge_gap',
        [
          OrgRel<'conversations'>,
          Rel<'conversations_agent_id_fkey', 'agent_id', 'agents'>,
          Rel<'conversations_assigned_user_id_fkey', 'assigned_user_id', 'users'>,
          Rel<'conversations_contact_id_fkey', 'contact_id', 'contacts'>,
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

      approvals: Table<
        ApprovalRow,
        Timestamps | 'status' | 'payload' | 'expires_at',
        [
          OrgRel<'approvals'>,
          Rel<'approvals_conversation_id_fkey', 'conversation_id', 'conversations'>,
          Rel<'approvals_agent_id_fkey', 'agent_id', 'agents'>,
          Rel<'approvals_ticket_id_fkey', 'ticket_id', 'tickets'>,
          Rel<'approvals_decided_by_fkey', 'decided_by', 'users'>,
        ]
      >;

      audit_log: Table<
        AuditLogRow,
        'id' | 'created_at' | 'changes',
        [OrgRel<'audit_log'>, Rel<'audit_log_actor_id_fkey', 'actor_id', 'users'>]
      >;

      agent_test_cases: Table<
        AgentTestCaseRow,
        Timestamps | 'expect_contains' | 'expect_absent',
        [
          OrgRel<'agent_test_cases'>,
          Rel<'agent_test_cases_agent_id_fkey', 'agent_id', 'agents'>,
          Rel<'agent_test_cases_created_by_fkey', 'created_by', 'users'>,
        ]
      >;

      agent_test_runs: Table<
        AgentTestRunRow,
        'id' | 'created_at' | 'status' | 'failures' | 'tools_used',
        [
          OrgRel<'agent_test_runs'>,
          Rel<'agent_test_runs_agent_id_fkey', 'agent_id', 'agents'>,
          Rel<'agent_test_runs_test_case_id_fkey', 'test_case_id', 'agent_test_cases'>,
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

      phone_numbers: Table<
        PhoneNumberRow,
        | 'id' | 'created_at' | 'updated_at' | 'provider' | 'greeting' | 'voice' | 'language'
        | 'max_call_seconds' | 'recording_enabled' | 'business_hours' | 'timezone'
        | 'after_hours' | 'status',
        [
          OrgRel<'phone_numbers'>,
          Rel<'phone_numbers_agent_id_fkey', 'agent_id', 'agents'>,
          Rel<'phone_numbers_created_by_fkey', 'created_by', 'users'>,
        ]
      >;

      calls: Table<
        CallRow,
        | 'id' | 'created_at' | 'updated_at' | 'direction' | 'status' | 'started_at'
        | 'turn_count' | 'extracted_variables' | 'wrapup_status',
        [
          OrgRel<'calls'>,
          Rel<'calls_phone_number_id_fkey', 'phone_number_id', 'phone_numbers'>,
          Rel<'calls_conversation_id_fkey', 'conversation_id', 'conversations'>,
          Rel<'calls_agent_id_fkey', 'agent_id', 'agents'>,
          Rel<'calls_contact_id_fkey', 'contact_id', 'contacts'>,
          Rel<'calls_campaign_target_id_fkey', 'campaign_target_id', 'campaign_targets'>,
        ]
      >;

      call_campaigns: Table<
        CallCampaignRow,
        | Timestamps | 'status' | 'opening_line' | 'calling_window' | 'timezone'
        | 'max_attempts' | 'retry_after_minutes' | 'max_concurrent',
        [
          OrgRel<'call_campaigns'>,
          Rel<'call_campaigns_agent_id_fkey', 'agent_id', 'agents'>,
          Rel<'call_campaigns_phone_number_id_fkey', 'phone_number_id', 'phone_numbers'>,
          Rel<'call_campaigns_created_by_fkey', 'created_by', 'users'>,
        ]
      >;

      staff_members: Table<
        StaffMemberRow,
        Timestamps | 'accepts_transfers' | 'accepts_messages' | 'active',
        [OrgRel<'staff_members'>, Rel<'staff_members_created_by_fkey', 'created_by', 'users'>]
      >;

      messages_for_staff: Table<
        StaffMessageRow,
        Timestamps | 'urgency' | 'status',
        [
          OrgRel<'messages_for_staff'>,
          Rel<'messages_for_staff_staff_member_id_fkey', 'staff_member_id', 'staff_members'>,
          Rel<'messages_for_staff_call_id_fkey', 'call_id', 'calls'>,
          Rel<'messages_for_staff_conversation_id_fkey', 'conversation_id', 'conversations'>,
          Rel<'messages_for_staff_contact_id_fkey', 'contact_id', 'contacts'>,
          Rel<'messages_for_staff_handled_by_fkey', 'handled_by', 'users'>,
        ]
      >;

      campaign_targets: Table<
        CampaignTargetRow,
        Timestamps | 'outcome' | 'attempts' | 'next_attempt_at' | 'context',
        [
          OrgRel<'campaign_targets'>,
          Rel<'campaign_targets_campaign_id_fkey', 'campaign_id', 'call_campaigns'>,
          Rel<'campaign_targets_contact_id_fkey', 'contact_id', 'contacts'>,
          Rel<'campaign_targets_last_call_fk', 'last_call_id', 'calls'>,
        ]
      >;

      contacts: Table<
        ContactRow,
        'id' | 'created_at' | 'updated_at' | 'first_seen_at' | 'last_seen_at' | 'call_count',
        [OrgRel<'contacts'>]
      >;

      callbacks: Table<
        CallbackRow,
        'id' | 'created_at' | 'updated_at' | 'status',
        [
          OrgRel<'callbacks'>,
          Rel<'callbacks_conversation_id_fkey', 'conversation_id', 'conversations'>,
          Rel<'callbacks_contact_id_fkey', 'contact_id', 'contacts'>,
          Rel<'callbacks_assignee_id_fkey', 'assignee_id', 'users'>,
          Rel<'callbacks_completed_by_fkey', 'completed_by', 'users'>,
        ]
      >;

      closure_days: Table<
        ClosureDayRow,
        'id' | 'created_at' | 'updated_at',
        [
          OrgRel<'closure_days'>,
          Rel<'closure_days_phone_number_id_fkey', 'phone_number_id', 'phone_numbers'>,
          Rel<'closure_days_created_by_fkey', 'created_by', 'users'>,
        ]
      >;

      phone_departments: Table<
        PhoneDepartmentRow,
        'id' | 'created_at' | 'updated_at' | 'active',
        [
          OrgRel<'phone_departments'>,
          Rel<'phone_departments_created_by_fkey', 'created_by', 'users'>,
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
      take_rate_limit: {
        Args: { p_bucket: string; p_limit: number; p_window_seconds: number };
        Returns: boolean;
      };
      touch_contact: {
        Args: { p_organization_id: string; p_e164: string };
        Returns: string;
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
      approval_status: ApprovalStatus;
      audit_action: AuditAction;
      test_run_status: TestRunStatus;
      telephony_provider: TelephonyProvider;
      phone_number_status: PhoneNumberStatus;
      after_hours_behavior: AfterHoursBehavior;
      call_status: CallStatus;
      callback_status: CallbackStatus;
    };
    CompositeTypes: Record<never, never>;
  };
};
