-- Tables, sequences and constraints. Applied only to an empty database.
-- Maintained directly as PostgreSQL SQL.

CREATE TABLE public.agent_runs (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    request_id text NOT NULL,
    request_hash text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    input jsonb NOT NULL,
    checkpoint jsonb NOT NULL,
    public_message jsonb NOT NULL,
    billing text NOT NULL,
    worker_id text,
    fence bigint DEFAULT 0 NOT NULL,
    lease_until timestamp with time zone,
    cancel_requested boolean DEFAULT false NOT NULL,
    record_id uuid,
    event_cursor bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_runs_billing_check CHECK ((billing = ANY (ARRAY['charged'::text, 'exempt'::text, 'refunded'::text]))),
    CONSTRAINT agent_runs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'awaiting_input'::text, 'cancelling'::text, 'completed'::text, 'cancelled'::text, 'failed'::text])))
)
WITH (fillfactor='80', autovacuum_vacuum_scale_factor='0.02', autovacuum_analyze_scale_factor='0.02');
ALTER TABLE ONLY public.agent_runs ALTER COLUMN checkpoint SET COMPRESSION lz4;
ALTER TABLE ONLY public.agent_runs ALTER COLUMN public_message SET COMPRESSION lz4;

CREATE TABLE public.agent_run_artifacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    call_id text NOT NULL,
    tool_name text NOT NULL,
    kind text NOT NULL,
    args jsonb NOT NULL,
    result jsonb NOT NULL,
    CONSTRAINT agent_run_artifacts_kind_check CHECK ((kind = ANY (ARRAY['calculation'::text, 'tool'::text])))
);

CREATE TABLE public.agent_run_commands (
    sequence bigint NOT NULL,
    run_id uuid NOT NULL,
    request_id text NOT NULL,
    mode text NOT NULL,
    message jsonb NOT NULL,
    consumed boolean DEFAULT false NOT NULL,
    durable_admitted boolean DEFAULT false NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    sort_order bigint NOT NULL,
    delivery_state text DEFAULT 'pending'::text NOT NULL,
    original_message jsonb,
    original_mode text,
    CONSTRAINT agent_run_commands_delivery_state_check CHECK ((delivery_state = ANY (ARRAY['pending'::text, 'claimed'::text, 'admitted'::text, 'consumed'::text, 'cancelled'::text]))),
    CONSTRAINT agent_run_commands_mode_check CHECK ((mode = ANY (ARRAY['steer'::text, 'follow_up'::text, 'reply'::text])))
);

CREATE TABLE public.user_agent_memory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    kind text DEFAULT 'preference'::text NOT NULL,
    fingerprint text GENERATED ALWAYS AS (md5(content)) STORED,
    source_run_id uuid,
    source_text text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_agent_memory_content_check CHECK (((length(btrim(content)) >= 1) AND (length(btrim(content)) <= 2000))),
    CONSTRAINT user_agent_memory_kind_check CHECK ((kind = ANY (ARRAY['preference'::text, 'context'::text]))),
    CONSTRAINT user_agent_memory_title_check CHECK (((length(btrim(title)) >= 1) AND (length(btrim(title)) <= 80)))
);

CREATE TABLE public.agent_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    object_path text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    mime_type text NOT NULL,
    size integer NOT NULL,
    sha256 text NOT NULL,
    width integer,
    height integer,
    status text DEFAULT 'uploading'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    orphaned_at timestamp with time zone DEFAULT now(),
    CONSTRAINT agent_attachments_kind_check CHECK ((kind = ANY (ARRAY['image'::text, 'text'::text]))),
    CONSTRAINT agent_attachments_size_check CHECK (((size > 0) AND (size <= 10485760))),
    CONSTRAINT agent_attachments_status_check CHECK ((status = ANY (ARRAY['uploading'::text, 'ready'::text, 'deleting'::text])))
);

CREATE TABLE public.daily_briefing_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    local_date date NOT NULL,
    timezone text NOT NULL,
    deadline timestamp with time zone NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    billing text DEFAULT 'none'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    lease_token uuid,
    lease_until timestamp with time zone,
    result_conversation_id uuid,
    content text,
    error text,
    notification_pending boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT daily_briefing_jobs_attempts_check CHECK (((attempts >= 0) AND (attempts <= 3))),
    CONSTRAINT daily_briefing_jobs_billing_check CHECK ((billing = ANY (ARRAY['none'::text, 'reserved'::text, 'settled'::text, 'refunded'::text]))),
    CONSTRAINT daily_briefing_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'generating'::text, 'completed'::text, 'failed'::text, 'cancelled'::text, 'skipped'::text])))
);

CREATE TABLE public.conversation_shares (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token text NOT NULL,
    user_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
    include_charts boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT conversation_shares_snapshot_check CHECK ((jsonb_typeof(snapshot) = 'array'::text)),
    CONSTRAINT conversation_shares_title_check CHECK ((char_length(title) <= 200)),
    CONSTRAINT conversation_shares_token_check CHECK ((token ~ '^[A-Za-z0-9_-]{43}$'::text))
);

CREATE TABLE identity.accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    account_id text NOT NULL,
    provider_id text NOT NULL,
    access_token text,
    refresh_token text,
    id_token text,
    access_token_expires_at timestamp with time zone,
    refresh_token_expires_at timestamp with time zone,
    scope text,
    password text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE identity.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    ip_address text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE identity.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    image text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT identity_users_email_lowercase CHECK ((email = lower(email)))
);

CREATE TABLE identity.verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.activation_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key_code text NOT NULL,
    key_type text NOT NULL,
    membership_type text,
    credits_amount integer,
    is_used boolean DEFAULT false,
    used_by uuid,
    used_at timestamp with time zone,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    source text DEFAULT 'admin'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT activation_keys_key_type_check CHECK ((key_type = ANY (ARRAY['membership'::text, 'credits'::text])))
);

CREATE TABLE public.agent_attachment_refs (
    attachment_id uuid NOT NULL,
    conversation_id uuid,
    command_sequence bigint,
    CONSTRAINT agent_attachment_refs_check CHECK (((conversation_id IS NULL) <> (command_sequence IS NULL)))
);

CREATE TABLE public.agent_durable_commits (
    run_id uuid NOT NULL,
    sequence bigint NOT NULL,
    writes jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_durable_commits_sequence_check CHECK ((sequence > 0)),
    CONSTRAINT agent_durable_commits_writes_check CHECK ((jsonb_typeof(writes) = 'array'::text))
);

ALTER TABLE public.agent_run_commands ALTER COLUMN sequence ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.agent_run_commands_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.agent_run_credentials (
    run_id uuid NOT NULL,
    ciphertext jsonb NOT NULL
);

CREATE TABLE public.agent_run_events (
    sequence bigint NOT NULL,
    run_id uuid NOT NULL,
    type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.agent_run_events ALTER COLUMN sequence ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.agent_run_events_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.agent_workers (
    id text NOT NULL,
    heartbeat_at timestamp with time zone DEFAULT now() NOT NULL,
    engine text DEFAULT 'pi-agent-core/1.0.2'::text NOT NULL
)
WITH (fillfactor='80', autovacuum_vacuum_scale_factor='0.02', autovacuum_analyze_scale_factor='0.02');

CREATE TABLE public.ai_gateways (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gateway_key text NOT NULL,
    display_name text NOT NULL,
    base_url text DEFAULT ''::text NOT NULL,
    api_key_env_var text NOT NULL,
    transport text DEFAULT 'openai_compatible'::text NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_gateways_gateway_key_check CHECK ((gateway_key = ANY (ARRAY['newapi'::text, 'octopus'::text]))),
    CONSTRAINT ai_gateways_transport_check CHECK ((transport = 'openai_compatible'::text))
);

CREATE TABLE public.ai_model_gateway_bindings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_id uuid NOT NULL,
    gateway_id uuid NOT NULL,
    model_id_override text,
    reasoning_model_id text,
    is_enabled boolean DEFAULT true NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.ai_models (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_key text NOT NULL,
    display_name text NOT NULL,
    vendor text NOT NULL,
    is_enabled boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    required_tier text DEFAULT 'free'::text NOT NULL,
    supports_reasoning boolean DEFAULT false,
    reasoning_required_tier text DEFAULT 'plus'::text,
    is_reasoning_default boolean DEFAULT false,
    supports_vision boolean DEFAULT false,
    default_temperature numeric DEFAULT 0.7,
    default_max_tokens integer DEFAULT 4000,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    usage_type text DEFAULT 'chat'::text NOT NULL,
    routing_mode text DEFAULT 'auto'::text NOT NULL,
    default_top_p numeric DEFAULT 1,
    default_presence_penalty numeric DEFAULT 0,
    default_frequency_penalty numeric DEFAULT 0,
    default_reasoning_effort text,
    reasoning_effort_format text,
    custom_parameters jsonb,
    CONSTRAINT ai_models_default_reasoning_effort_check CHECK (((default_reasoning_effort IS NULL) OR (default_reasoning_effort = ANY (ARRAY['minimal'::text, 'low'::text, 'medium'::text, 'high'::text, 'xhigh'::text, 'max'::text])))),
    CONSTRAINT ai_models_reasoning_effort_format_check CHECK (((reasoning_effort_format IS NULL) OR (reasoning_effort_format = ANY (ARRAY['reasoning_object'::text, 'reasoning_effort'::text])))),
    CONSTRAINT ai_models_reasoning_required_tier_check CHECK ((reasoning_required_tier = ANY (ARRAY['free'::text, 'plus'::text, 'pro'::text]))),
    CONSTRAINT ai_models_required_tier_check CHECK ((required_tier = ANY (ARRAY['free'::text, 'plus'::text, 'pro'::text]))),
    CONSTRAINT ai_models_routing_mode_check CHECK ((routing_mode = ANY (ARRAY['auto'::text, 'newapi'::text, 'octopus'::text]))),
    CONSTRAINT ai_models_usage_type_check CHECK ((usage_type = ANY (ARRAY['chat'::text, 'vision'::text, 'embedding'::text, 'rerank'::text])))
);

CREATE TABLE public.announcements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    content text NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.annual_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    year integer NOT NULL,
    report_data jsonb NOT NULL,
    generated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.app_settings (
    setting_key text NOT NULL,
    setting_value boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.archived_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    source_type text NOT NULL,
    source_id text NOT NULL,
    kb_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT archived_sources_source_type_check CHECK ((source_type = ANY (ARRAY['conversation'::text, 'record'::text, 'chat_message'::text, 'bazi_chart'::text, 'ziwei_chart'::text, 'tarot_reading'::text, 'liuyao_divination'::text, 'hepan_chart'::text, 'face_reading'::text, 'palm_reading'::text, 'mbti_reading'::text, 'ming_record'::text, 'daily_fortune'::text, 'monthly_fortune'::text, 'qimen_chart'::text, 'daliuren_divination'::text, 'meihua_divination'::text, 'xiaoliuren_divination'::text])))
);

CREATE TABLE public.bazi_case_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    user_id uuid NOT NULL,
    bazi_chart_id uuid NOT NULL,
    event_date date NOT NULL,
    category text NOT NULL,
    title text NOT NULL,
    detail text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_run_id uuid,
    CONSTRAINT bazi_case_events_category_check CHECK ((category = ANY (ARRAY['事业'::text, '学业'::text, '财富'::text, '婚姻'::text, '健康'::text, '六亲'::text, '其他'::text])))
);

CREATE TABLE public.bazi_case_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    bazi_chart_id uuid NOT NULL,
    master_review jsonb DEFAULT '{}'::jsonb NOT NULL,
    owner_feedback jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_run_id uuid
);

CREATE TABLE public.bazi_charts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    name text NOT NULL,
    gender text,
    birth_date date NOT NULL,
    birth_time text,
    birth_place text,
    created_at timestamp with time zone DEFAULT now(),
    calendar_type text DEFAULT 'solar'::text,
    is_leap_month boolean DEFAULT false,
    day_master text,
    day_branch text,
    longitude double precision,
    timezone text DEFAULT 'Asia/Shanghai'::text NOT NULL,
    disambiguation text DEFAULT 'reject'::text NOT NULL,
    CONSTRAINT bazi_charts_disambiguation_check CHECK ((disambiguation = ANY (ARRAY['reject'::text, 'earlier'::text, 'later'::text, 'compatible'::text]))),
    CONSTRAINT bazi_charts_gender_check CHECK ((gender = ANY (ARRAY['male'::text, 'female'::text]))),
    CONSTRAINT bazi_charts_timezone_check CHECK (((char_length(timezone) >= 1) AND (char_length(timezone) <= 100) AND (timezone = btrim(timezone))))
);

CREATE TABLE public.community_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    parent_id uuid,
    content text NOT NULL,
    upvote_count integer DEFAULT 0,
    downvote_count integer DEFAULT 0,
    is_deleted boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.community_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    category text DEFAULT 'general'::text,
    tags text[] DEFAULT '{}'::text[],
    view_count integer DEFAULT 0,
    upvote_count integer DEFAULT 0,
    downvote_count integer DEFAULT 0,
    comment_count integer DEFAULT 0,
    is_pinned boolean DEFAULT false,
    is_featured boolean DEFAULT false,
    is_deleted boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.community_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reporter_id uuid NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    reason text NOT NULL,
    description text,
    status text DEFAULT 'pending'::text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    review_notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT community_reports_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'reviewed'::text, 'resolved'::text, 'dismissed'::text]))),
    CONSTRAINT community_reports_target_type_check CHECK ((target_type = ANY (ARRAY['post'::text, 'comment'::text])))
);

CREATE TABLE public.community_votes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    vote_type text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT community_votes_target_type_check CHECK ((target_type = ANY (ARRAY['post'::text, 'comment'::text]))),
    CONSTRAINT community_votes_vote_type_check CHECK ((vote_type = ANY (ARRAY['up'::text, 'down'::text])))
);

CREATE TABLE public.conversation_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    sequence integer NOT NULL,
    message_id text NOT NULL,
    role text NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.conversations (
    next_task_config jsonb,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    personality text DEFAULT 'master'::text,
    title text DEFAULT '新对话'::text,
    messages jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    source_type text DEFAULT 'chat'::text,
    source_data jsonb,
    CONSTRAINT conversations_source_type_check CHECK ((source_type = ANY (ARRAY['chat'::text, 'bazi_wuxing'::text, 'bazi_personality'::text, 'tarot'::text, 'liuyao'::text, 'mbti'::text, 'hepan'::text, 'palm'::text, 'face'::text, 'dream'::text, 'qimen'::text, 'daliuren'::text, 'meihua'::text, 'xiaoliuren'::text, 'ziwei'::text])))
);

CREATE TABLE public.credit_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    amount integer NOT NULL,
    type text NOT NULL,
    source text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    balance_after integer,
    reference_type text,
    reference_id text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT credit_transactions_type_check CHECK ((type = ANY (ARRAY['earn'::text, 'spend'::text, 'refund'::text])))
);

CREATE TABLE public.daily_checkins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    checkin_date date NOT NULL,
    reward_credits integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.daliuren_divinations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    question text,
    solar_date text NOT NULL,
    day_ganzhi text NOT NULL,
    hour_ganzhi text NOT NULL,
    yue_jiang text NOT NULL,
    result_data jsonb NOT NULL,
    settings jsonb,
    conversation_id uuid,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.face_readings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    analysis_type text DEFAULT 'full'::text,
    created_at timestamp with time zone DEFAULT now(),
    conversation_id uuid
);

CREATE TABLE public.hepan_charts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    type text NOT NULL,
    person1_name text NOT NULL,
    person1_birth jsonb NOT NULL,
    person2_name text NOT NULL,
    person2_birth jsonb NOT NULL,
    compatibility_score integer,
    created_at timestamp with time zone DEFAULT now(),
    conversation_id uuid,
    result_data jsonb,
    CONSTRAINT hepan_charts_type_check CHECK ((type = ANY (ARRAY['love'::text, 'business'::text, 'family'::text])))
);

CREATE TABLE public.knowledge_bases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    weight text DEFAULT 'normal'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT knowledge_bases_weight_check CHECK ((weight = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text])))
);

CREATE TABLE public.knowledge_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kb_id uuid NOT NULL,
    content text NOT NULL,
    content_vector extensions.vector,
    source_type text NOT NULL,
    source_id text NOT NULL,
    chunk_index integer DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    embedding_dim integer GENERATED ALWAYS AS (extensions.vector_dims(content_vector)) STORED,
    CONSTRAINT vector_metadata_check CHECK (((content_vector IS NULL) OR ((metadata ? 'embedding_model'::text) AND (metadata ? 'embedding_dim'::text))))
);

CREATE TABLE public.liuyao_divinations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    question text NOT NULL,
    hexagram_code text NOT NULL,
    changed_hexagram_code text,
    changed_lines jsonb,
    created_at timestamp with time zone DEFAULT now(),
    conversation_id uuid,
    yongshen_targets text[],
    CONSTRAINT liuyao_divinations_yongshen_targets_check CHECK (((yongshen_targets IS NULL) OR ((COALESCE(array_length(yongshen_targets, 1), 0) >= 1) AND (yongshen_targets <@ ARRAY['父母'::text, '兄弟'::text, '子孙'::text, '妻财'::text, '官鬼'::text]))))
);

CREATE TABLE public.mbti_readings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    mbti_type text NOT NULL,
    scores jsonb,
    percentages jsonb,
    created_at timestamp with time zone DEFAULT now(),
    conversation_id uuid
);

CREATE TABLE public.meihua_divinations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    question text NOT NULL,
    method text NOT NULL,
    cast_datetime timestamp without time zone NOT NULL,
    main_hexagram text NOT NULL,
    changed_hexagram text,
    input_data jsonb NOT NULL,
    result_data jsonb NOT NULL,
    conversation_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT meihua_divinations_method_check CHECK ((method = ANY (ARRAY['time'::text, 'text_split'::text, 'number_pair'::text, 'number_triplet'::text]))),
    CONSTRAINT meihua_divinations_question_check CHECK ((length(btrim(question)) > 0))
);

CREATE TABLE public.ming_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    note_date date DEFAULT CURRENT_DATE NOT NULL,
    content text NOT NULL,
    mood text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.ming_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    content text,
    category text DEFAULT 'general'::text,
    tags text[] DEFAULT '{}'::text[],
    event_date date,
    related_chart_type text,
    related_chart_id uuid,
    is_pinned boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    source_run_id uuid
);

CREATE TABLE public.notifications (
    event_key text,
    event_data jsonb,
    popup_claimed_at timestamp with time zone,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    type character varying NOT NULL,
    title text NOT NULL,
    content text,
    is_read boolean DEFAULT false,
    link text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.palm_readings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    analysis_type text DEFAULT 'full'::text,
    hand_type text DEFAULT 'left'::text,
    created_at timestamp with time zone DEFAULT now(),
    conversation_id uuid,
    CONSTRAINT palm_readings_hand_type_check CHECK ((hand_type = ANY (ARRAY['left'::text, 'right'::text, 'both'::text])))
);

CREATE TABLE public.prompt_enhancement_usage (
    user_id uuid NOT NULL,
    local_date date NOT NULL,
    calls integer DEFAULT 0 NOT NULL,
    CONSTRAINT prompt_enhancement_usage_calls_check CHECK (((calls >= 0) AND (calls <= 5)))
);

CREATE TABLE public.qimen_charts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    question text,
    chart_time timestamp with time zone NOT NULL,
    dun_type text NOT NULL,
    ju_number integer NOT NULL,
    pan_type text DEFAULT 'zhuan'::text NOT NULL,
    ju_method text DEFAULT 'chaibu'::text NOT NULL,
    conversation_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    year integer NOT NULL,
    month integer NOT NULL,
    day integer NOT NULL,
    hour integer NOT NULL,
    minute integer NOT NULL,
    timezone text DEFAULT 'Asia/Shanghai'::text NOT NULL,
    zhi_fu_ji_gong text DEFAULT 'ji_liuyi'::text NOT NULL,
    CONSTRAINT qimen_charts_day_check CHECK (((day >= 1) AND (day <= 31))),
    CONSTRAINT qimen_charts_dun_type_check CHECK ((dun_type = ANY (ARRAY['yang'::text, 'yin'::text]))),
    CONSTRAINT qimen_charts_hour_check CHECK (((hour >= 0) AND (hour <= 23))),
    CONSTRAINT qimen_charts_ju_method_check CHECK ((ju_method = ANY (ARRAY['chaibu'::text, 'maoshan'::text]))),
    CONSTRAINT qimen_charts_ju_number_check CHECK (((ju_number >= 1) AND (ju_number <= 9))),
    CONSTRAINT qimen_charts_minute_check CHECK (((minute >= 0) AND (minute <= 59))),
    CONSTRAINT qimen_charts_month_check CHECK (((month >= 1) AND (month <= 12))),
    CONSTRAINT qimen_charts_pan_type_check CHECK ((pan_type = 'zhuan'::text)),
    CONSTRAINT qimen_charts_zhi_fu_ji_gong_check CHECK ((zhi_fu_ji_gong = ANY (ARRAY['ji_liuyi'::text, 'ji_wugong'::text])))
);

CREATE TABLE public.reminder_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    reminder_type text NOT NULL,
    enabled boolean DEFAULT true,
    notify_email boolean DEFAULT false,
    notify_site boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT reminder_subscription_type CHECK ((reminder_type = ANY (ARRAY['solar_term'::text, 'fortune'::text, 'key_date'::text, 'daily_briefing'::text])))
);

CREATE TABLE public.scheduled_reminders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    reminder_type text NOT NULL,
    scheduled_for timestamp with time zone NOT NULL,
    content jsonb,
    sent boolean DEFAULT false,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.tarot_readings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    spread_id text NOT NULL,
    question text,
    cards jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    conversation_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE public.user_oauth_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider text NOT NULL,
    provider_user_id text NOT NULL,
    provider_email text,
    provider_username text,
    provider_avatar_url text,
    provider_metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.user_settings (
    chat_preferences jsonb DEFAULT '{}'::jsonb NOT NULL,
    daily_briefing_settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    user_id uuid NOT NULL,
    notifications_enabled boolean DEFAULT true,
    notify_email boolean DEFAULT true,
    notify_site boolean DEFAULT true,
    language text DEFAULT 'zh'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    default_bazi_chart_id uuid,
    default_ziwei_chart_id uuid,
    custom_instructions text,
    expression_style text DEFAULT 'direct'::text,
    user_profile jsonb DEFAULT '{}'::jsonb,
    prompt_kb_ids jsonb DEFAULT '[]'::jsonb,
    visualization_settings jsonb DEFAULT '{}'::jsonb,
    chart_prompt_detail_level text DEFAULT 'default'::text NOT NULL,
    CONSTRAINT user_settings_chart_prompt_detail_level_check CHECK ((chart_prompt_detail_level = ANY (ARRAY['default'::text, 'more'::text, 'full'::text]))),
    CONSTRAINT user_settings_expression_style_check CHECK ((expression_style = ANY (ARRAY['direct'::text, 'gentle'::text])))
);

CREATE TABLE public.users (
    id uuid NOT NULL,
    nickname text,
    avatar_url text,
    membership text DEFAULT 'free'::text,
    membership_expires_at timestamp with time zone,
    ai_chat_count integer DEFAULT 1,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_admin boolean DEFAULT false,
    CONSTRAINT users_membership_check CHECK ((membership = ANY (ARRAY['free'::text, 'plus'::text, 'pro'::text])))
);

CREATE TABLE public.xiaoliuren_divinations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    question text,
    solar_datetime timestamp without time zone NOT NULL,
    lunar_month smallint NOT NULL,
    lunar_day smallint NOT NULL,
    is_leap_month boolean DEFAULT false NOT NULL,
    shichen text NOT NULL,
    final_status text NOT NULL,
    input_data jsonb NOT NULL,
    result_data jsonb NOT NULL,
    conversation_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT xiaoliuren_divinations_final_status_check CHECK ((final_status = ANY (ARRAY['大安'::text, '留连'::text, '速喜'::text, '赤口'::text, '小吉'::text, '空亡'::text]))),
    CONSTRAINT xiaoliuren_divinations_lunar_day_check CHECK (((lunar_day >= 1) AND (lunar_day <= 30))),
    CONSTRAINT xiaoliuren_divinations_lunar_month_check CHECK (((lunar_month >= 1) AND (lunar_month <= 12)))
);

CREATE TABLE public.ziwei_charts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    name text NOT NULL,
    gender text,
    birth_date date NOT NULL,
    birth_time text NOT NULL,
    calendar_type text DEFAULT 'solar'::text,
    created_at timestamp with time zone DEFAULT now(),
    is_leap_month boolean DEFAULT false,
    birth_place text,
    longitude double precision,
    timezone text DEFAULT 'Asia/Shanghai'::text NOT NULL,
    disambiguation text DEFAULT 'reject'::text NOT NULL,
    CONSTRAINT ziwei_charts_birth_time_check CHECK ((btrim(birth_time) <> ''::text)),
    CONSTRAINT ziwei_charts_disambiguation_check CHECK ((disambiguation = ANY (ARRAY['reject'::text, 'earlier'::text, 'later'::text, 'compatible'::text]))),
    CONSTRAINT ziwei_charts_timezone_check CHECK (((char_length(timezone) >= 1) AND (char_length(timezone) <= 100) AND (timezone = btrim(timezone))))
);

ALTER TABLE ONLY identity.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY identity.accounts
    ADD CONSTRAINT identity_accounts_provider_account_key UNIQUE (provider_id, account_id);

ALTER TABLE ONLY identity.sessions
    ADD CONSTRAINT identity_sessions_token_key UNIQUE (token);

ALTER TABLE ONLY identity.users
    ADD CONSTRAINT identity_users_email_key UNIQUE (email);

ALTER TABLE ONLY identity.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY identity.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY identity.verifications
    ADD CONSTRAINT verifications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.activation_keys
    ADD CONSTRAINT activation_keys_key_code_key UNIQUE (key_code);

ALTER TABLE ONLY public.activation_keys
    ADD CONSTRAINT activation_keys_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.agent_attachments
    ADD CONSTRAINT agent_attachments_object_path_key UNIQUE (object_path);

ALTER TABLE ONLY public.agent_attachments
    ADD CONSTRAINT agent_attachments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.agent_durable_commits
    ADD CONSTRAINT agent_durable_commits_pkey PRIMARY KEY (run_id, sequence);

ALTER TABLE ONLY public.agent_run_artifacts
    ADD CONSTRAINT agent_run_artifacts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.agent_run_artifacts
    ADD CONSTRAINT agent_run_artifacts_run_id_call_id_key UNIQUE (run_id, call_id);

ALTER TABLE ONLY public.agent_run_commands
    ADD CONSTRAINT agent_run_commands_pkey PRIMARY KEY (sequence);

ALTER TABLE ONLY public.agent_run_commands
    ADD CONSTRAINT agent_run_commands_run_id_request_id_key UNIQUE (run_id, request_id);

ALTER TABLE ONLY public.agent_run_credentials
    ADD CONSTRAINT agent_run_credentials_pkey PRIMARY KEY (run_id);

ALTER TABLE ONLY public.agent_run_events
    ADD CONSTRAINT agent_run_events_pkey PRIMARY KEY (sequence);

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_user_id_request_id_key UNIQUE (user_id, request_id);

ALTER TABLE ONLY public.agent_workers
    ADD CONSTRAINT agent_workers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ai_gateways
    ADD CONSTRAINT ai_gateways_gateway_key_key UNIQUE (gateway_key);

ALTER TABLE ONLY public.ai_gateways
    ADD CONSTRAINT ai_gateways_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ai_model_gateway_bindings
    ADD CONSTRAINT ai_model_gateway_bindings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ai_models
    ADD CONSTRAINT ai_models_model_key_key UNIQUE (model_key);

ALTER TABLE ONLY public.ai_models
    ADD CONSTRAINT ai_models_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.annual_reports
    ADD CONSTRAINT annual_reports_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (setting_key);

ALTER TABLE ONLY public.archived_sources
    ADD CONSTRAINT archived_sources_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.bazi_case_events
    ADD CONSTRAINT bazi_case_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.bazi_case_profiles
    ADD CONSTRAINT bazi_case_profiles_bazi_chart_id_key UNIQUE (bazi_chart_id);

ALTER TABLE ONLY public.bazi_case_profiles
    ADD CONSTRAINT bazi_case_profiles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.bazi_charts
    ADD CONSTRAINT bazi_charts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.community_comments
    ADD CONSTRAINT community_comments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.community_posts
    ADD CONSTRAINT community_posts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.community_reports
    ADD CONSTRAINT community_reports_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.community_votes
    ADD CONSTRAINT community_votes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.conversation_messages
    ADD CONSTRAINT conversation_messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.conversation_shares
    ADD CONSTRAINT conversation_shares_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.conversation_shares
    ADD CONSTRAINT conversation_shares_token_key UNIQUE (token);

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.credit_transactions
    ADD CONSTRAINT credit_transactions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.daily_briefing_jobs
    ADD CONSTRAINT daily_briefing_jobs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.daily_briefing_jobs
    ADD CONSTRAINT daily_briefing_jobs_user_id_local_date_key UNIQUE (user_id, local_date);

ALTER TABLE ONLY public.daily_checkins
    ADD CONSTRAINT daily_checkins_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.daliuren_divinations
    ADD CONSTRAINT daliuren_divinations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.face_readings
    ADD CONSTRAINT face_readings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hepan_charts
    ADD CONSTRAINT hepan_charts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.knowledge_bases
    ADD CONSTRAINT knowledge_bases_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.knowledge_entries
    ADD CONSTRAINT knowledge_entries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.liuyao_divinations
    ADD CONSTRAINT liuyao_divinations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.mbti_readings
    ADD CONSTRAINT mbti_readings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.meihua_divinations
    ADD CONSTRAINT meihua_divinations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ming_notes
    ADD CONSTRAINT ming_notes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ming_records
    ADD CONSTRAINT ming_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.palm_readings
    ADD CONSTRAINT palm_readings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.prompt_enhancement_usage
    ADD CONSTRAINT prompt_enhancement_usage_pkey PRIMARY KEY (user_id, local_date);

ALTER TABLE ONLY public.qimen_charts
    ADD CONSTRAINT qimen_charts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.reminder_subscriptions
    ADD CONSTRAINT reminder_subscriptions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.scheduled_reminders
    ADD CONSTRAINT scheduled_reminders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ai_model_gateway_bindings
    ADD CONSTRAINT selfhost_ai_model_gateway_bindings_unique UNIQUE (model_id, gateway_id);

ALTER TABLE ONLY public.annual_reports
    ADD CONSTRAINT selfhost_annual_reports_unique UNIQUE (user_id, year);

ALTER TABLE ONLY public.archived_sources
    ADD CONSTRAINT selfhost_archived_sources_unique UNIQUE (source_type, source_id, kb_id);

ALTER TABLE ONLY public.daily_checkins
    ADD CONSTRAINT selfhost_daily_checkins_unique UNIQUE (user_id, checkin_date);

ALTER TABLE ONLY public.knowledge_entries
    ADD CONSTRAINT selfhost_knowledge_entries_unique UNIQUE (kb_id, source_type, source_id, chunk_index);

ALTER TABLE ONLY public.reminder_subscriptions
    ADD CONSTRAINT selfhost_reminder_subscriptions_unique UNIQUE (user_id, reminder_type);

ALTER TABLE ONLY public.scheduled_reminders
    ADD CONSTRAINT selfhost_scheduled_reminders_unique UNIQUE (user_id, reminder_type, scheduled_for);

ALTER TABLE ONLY public.user_oauth_providers
    ADD CONSTRAINT selfhost_user_oauth_providers_unique UNIQUE (provider, provider_user_id);

ALTER TABLE ONLY public.tarot_readings
    ADD CONSTRAINT tarot_readings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_agent_memory
    ADD CONSTRAINT user_agent_memory_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_agent_memory
    ADD CONSTRAINT user_agent_memory_user_id_fingerprint_key UNIQUE (user_id, fingerprint);

ALTER TABLE ONLY public.user_oauth_providers
    ADD CONSTRAINT user_oauth_providers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.xiaoliuren_divinations
    ADD CONSTRAINT xiaoliuren_divinations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ziwei_charts
    ADD CONSTRAINT ziwei_charts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY identity.accounts
    ADD CONSTRAINT accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES identity.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY identity.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES identity.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.activation_keys
    ADD CONSTRAINT activation_keys_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);

ALTER TABLE ONLY public.activation_keys
    ADD CONSTRAINT activation_keys_used_by_fkey FOREIGN KEY (used_by) REFERENCES public.users(id);

ALTER TABLE ONLY public.agent_attachment_refs
    ADD CONSTRAINT agent_attachment_refs_attachment_id_fkey FOREIGN KEY (attachment_id) REFERENCES public.agent_attachments(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_attachment_refs
    ADD CONSTRAINT agent_attachment_refs_command_sequence_fkey FOREIGN KEY (command_sequence) REFERENCES public.agent_run_commands(sequence) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_attachment_refs
    ADD CONSTRAINT agent_attachment_refs_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_attachments
    ADD CONSTRAINT agent_attachments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_durable_commits
    ADD CONSTRAINT agent_durable_commits_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.agent_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_run_artifacts
    ADD CONSTRAINT agent_run_artifacts_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.agent_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_run_commands
    ADD CONSTRAINT agent_run_commands_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.agent_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_run_credentials
    ADD CONSTRAINT agent_run_credentials_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.agent_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_run_events
    ADD CONSTRAINT agent_run_events_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.agent_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_record_id_fkey FOREIGN KEY (record_id) REFERENCES public.ming_records(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ai_model_gateway_bindings
    ADD CONSTRAINT ai_model_gateway_bindings_gateway_id_fkey FOREIGN KEY (gateway_id) REFERENCES public.ai_gateways(id);

ALTER TABLE ONLY public.ai_model_gateway_bindings
    ADD CONSTRAINT ai_model_gateway_bindings_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.ai_models(id);

ALTER TABLE ONLY public.annual_reports
    ADD CONSTRAINT annual_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.archived_sources
    ADD CONSTRAINT archived_sources_kb_id_fkey FOREIGN KEY (kb_id) REFERENCES public.knowledge_bases(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.archived_sources
    ADD CONSTRAINT archived_sources_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.bazi_case_events
    ADD CONSTRAINT bazi_case_events_bazi_chart_id_fkey FOREIGN KEY (bazi_chart_id) REFERENCES public.bazi_charts(id);

ALTER TABLE ONLY public.bazi_case_events
    ADD CONSTRAINT bazi_case_events_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.bazi_case_profiles(id);

ALTER TABLE ONLY public.bazi_case_events
    ADD CONSTRAINT bazi_case_events_source_run_id_fkey FOREIGN KEY (source_run_id) REFERENCES public.agent_runs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.bazi_case_events
    ADD CONSTRAINT bazi_case_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.bazi_case_profiles
    ADD CONSTRAINT bazi_case_profiles_bazi_chart_id_fkey FOREIGN KEY (bazi_chart_id) REFERENCES public.bazi_charts(id);

ALTER TABLE ONLY public.bazi_case_profiles
    ADD CONSTRAINT bazi_case_profiles_source_run_id_fkey FOREIGN KEY (source_run_id) REFERENCES public.agent_runs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.bazi_case_profiles
    ADD CONSTRAINT bazi_case_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.bazi_charts
    ADD CONSTRAINT bazi_charts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.community_comments
    ADD CONSTRAINT community_comments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.community_comments(id);

ALTER TABLE ONLY public.community_comments
    ADD CONSTRAINT community_comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.community_posts(id);

ALTER TABLE ONLY public.community_comments
    ADD CONSTRAINT community_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.community_posts
    ADD CONSTRAINT community_posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.community_reports
    ADD CONSTRAINT community_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.community_reports
    ADD CONSTRAINT community_reports_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);

ALTER TABLE ONLY public.community_votes
    ADD CONSTRAINT community_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.conversation_messages
    ADD CONSTRAINT conversation_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.conversation_shares
    ADD CONSTRAINT conversation_shares_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.conversation_shares
    ADD CONSTRAINT conversation_shares_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.credit_transactions
    ADD CONSTRAINT credit_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.daily_briefing_jobs
    ADD CONSTRAINT daily_briefing_jobs_result_conversation_id_fkey FOREIGN KEY (result_conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.daily_briefing_jobs
    ADD CONSTRAINT daily_briefing_jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.daily_checkins
    ADD CONSTRAINT daily_checkins_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.daliuren_divinations
    ADD CONSTRAINT daliuren_divinations_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);

ALTER TABLE ONLY public.daliuren_divinations
    ADD CONSTRAINT daliuren_divinations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.face_readings
    ADD CONSTRAINT face_readings_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);

ALTER TABLE ONLY public.face_readings
    ADD CONSTRAINT face_readings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.hepan_charts
    ADD CONSTRAINT hepan_charts_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);

ALTER TABLE ONLY public.hepan_charts
    ADD CONSTRAINT hepan_charts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.knowledge_bases
    ADD CONSTRAINT knowledge_bases_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.knowledge_entries
    ADD CONSTRAINT knowledge_entries_kb_id_fkey FOREIGN KEY (kb_id) REFERENCES public.knowledge_bases(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.liuyao_divinations
    ADD CONSTRAINT liuyao_divinations_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);

ALTER TABLE ONLY public.liuyao_divinations
    ADD CONSTRAINT liuyao_divinations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.mbti_readings
    ADD CONSTRAINT mbti_readings_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);

ALTER TABLE ONLY public.mbti_readings
    ADD CONSTRAINT mbti_readings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.meihua_divinations
    ADD CONSTRAINT meihua_divinations_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.meihua_divinations
    ADD CONSTRAINT meihua_divinations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ming_notes
    ADD CONSTRAINT ming_notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.ming_records
    ADD CONSTRAINT ming_records_source_run_id_fkey FOREIGN KEY (source_run_id) REFERENCES public.agent_runs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.ming_records
    ADD CONSTRAINT ming_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.palm_readings
    ADD CONSTRAINT palm_readings_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);

ALTER TABLE ONLY public.palm_readings
    ADD CONSTRAINT palm_readings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.prompt_enhancement_usage
    ADD CONSTRAINT prompt_enhancement_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.qimen_charts
    ADD CONSTRAINT qimen_charts_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);

ALTER TABLE ONLY public.qimen_charts
    ADD CONSTRAINT qimen_charts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.reminder_subscriptions
    ADD CONSTRAINT reminder_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.scheduled_reminders
    ADD CONSTRAINT scheduled_reminders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.tarot_readings
    ADD CONSTRAINT tarot_readings_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);

ALTER TABLE ONLY public.tarot_readings
    ADD CONSTRAINT tarot_readings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.user_agent_memory
    ADD CONSTRAINT user_agent_memory_source_run_id_fkey FOREIGN KEY (source_run_id) REFERENCES public.agent_runs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.user_agent_memory
    ADD CONSTRAINT user_agent_memory_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_oauth_providers
    ADD CONSTRAINT user_oauth_providers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_default_bazi_chart_id_fkey FOREIGN KEY (default_bazi_chart_id) REFERENCES public.bazi_charts(id);

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_default_ziwei_chart_id_fkey FOREIGN KEY (default_ziwei_chart_id) REFERENCES public.ziwei_charts(id);

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES identity.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.xiaoliuren_divinations
    ADD CONSTRAINT xiaoliuren_divinations_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.xiaoliuren_divinations
    ADD CONSTRAINT xiaoliuren_divinations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ziwei_charts
    ADD CONSTRAINT ziwei_charts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);
