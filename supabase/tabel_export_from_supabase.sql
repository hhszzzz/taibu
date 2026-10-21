-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.
-- Backend access for the 20261007 Agent additions is defined by 20261007_190000_agent_backend_access.sql:
-- authenticated system admin RLS, guarded briefing/cleanup RPCs, and private Storage backend policies.

CREATE TABLE public.activation_keys (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  key_code text NOT NULL UNIQUE,
  key_type text NOT NULL CHECK (key_type = ANY (ARRAY['membership'::text, 'credits'::text])),
  membership_type text,
  credits_amount integer,
  is_used boolean DEFAULT false,
  used_by uuid,
  used_at timestamp with time zone,
  created_by uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  source text NOT NULL DEFAULT 'admin'::text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT activation_keys_pkey PRIMARY KEY (id),
  CONSTRAINT activation_keys_used_by_fkey FOREIGN KEY (used_by) REFERENCES auth.users(id),
  CONSTRAINT activation_keys_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)
);
CREATE TABLE public.ai_gateways (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  gateway_key text NOT NULL UNIQUE CHECK (gateway_key = ANY (ARRAY['newapi'::text, 'octopus'::text])),
  display_name text NOT NULL,
  base_url text NOT NULL DEFAULT ''::text,
  api_key_env_var text NOT NULL,
  transport text NOT NULL DEFAULT 'openai_compatible'::text CHECK (transport = 'openai_compatible'::text),
  is_enabled boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ai_gateways_pkey PRIMARY KEY (id)
);
CREATE TABLE public.ai_model_gateway_bindings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  model_id uuid NOT NULL,
  gateway_id uuid NOT NULL,
  model_id_override text,
  reasoning_model_id text,
  is_enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ai_model_gateway_bindings_pkey PRIMARY KEY (id),
  CONSTRAINT ai_model_gateway_bindings_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.ai_models(id),
  CONSTRAINT ai_model_gateway_bindings_gateway_id_fkey FOREIGN KEY (gateway_id) REFERENCES public.ai_gateways(id)
);
CREATE TABLE public.ai_models (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  model_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  vendor text NOT NULL,
  is_enabled boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  required_tier text NOT NULL DEFAULT 'free'::text CHECK (required_tier = ANY (ARRAY['free'::text, 'plus'::text, 'pro'::text])),
  supports_reasoning boolean DEFAULT false,
  reasoning_required_tier text DEFAULT 'plus'::text CHECK (reasoning_required_tier = ANY (ARRAY['free'::text, 'plus'::text, 'pro'::text])),
  is_reasoning_default boolean DEFAULT false,
  supports_vision boolean DEFAULT false,
  default_temperature numeric DEFAULT 0.7,
  default_max_tokens integer DEFAULT 4000,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  usage_type text NOT NULL DEFAULT 'chat'::text CHECK (usage_type = ANY (ARRAY['chat'::text, 'vision'::text, 'embedding'::text, 'rerank'::text])),
  routing_mode text NOT NULL DEFAULT 'auto'::text CHECK (routing_mode = ANY (ARRAY['auto'::text, 'newapi'::text, 'octopus'::text])),
  default_top_p numeric DEFAULT 1,
  default_presence_penalty numeric DEFAULT 0,
  default_frequency_penalty numeric DEFAULT 0,
  default_reasoning_effort text CHECK (default_reasoning_effort IS NULL OR (default_reasoning_effort = ANY (ARRAY['minimal'::text, 'low'::text, 'medium'::text, 'high'::text, 'xhigh'::text, 'max'::text]))),
  reasoning_effort_format text CHECK (reasoning_effort_format IS NULL OR (reasoning_effort_format = ANY (ARRAY['reasoning_object'::text, 'reasoning_effort'::text]))),
  custom_parameters jsonb,
  CONSTRAINT ai_models_pkey PRIMARY KEY (id)
);
CREATE TABLE public.announcements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  content text NOT NULL,
  published_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT announcements_pkey PRIMARY KEY (id)
);
CREATE TABLE public.annual_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  year integer NOT NULL,
  report_data jsonb NOT NULL,
  generated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT annual_reports_pkey PRIMARY KEY (id),
  CONSTRAINT annual_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.app_settings (
  setting_key text NOT NULL,
  setting_value boolean NOT NULL DEFAULT false,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT app_settings_pkey PRIMARY KEY (setting_key)
);
CREATE TABLE public.archived_sources (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_type text NOT NULL CHECK (source_type = ANY (ARRAY['conversation'::text, 'record'::text, 'chat_message'::text, 'bazi_chart'::text, 'ziwei_chart'::text, 'tarot_reading'::text, 'liuyao_divination'::text, 'hepan_chart'::text, 'face_reading'::text, 'palm_reading'::text, 'mbti_reading'::text, 'ming_record'::text, 'daily_fortune'::text, 'monthly_fortune'::text, 'qimen_chart'::text, 'daliuren_divination'::text, 'meihua_divination'::text, 'xiaoliuren_divination'::text])),
  source_id text NOT NULL,
  kb_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT archived_sources_pkey PRIMARY KEY (id),
  CONSTRAINT archived_sources_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT archived_sources_kb_id_fkey FOREIGN KEY (kb_id) REFERENCES public.knowledge_bases(id)
);
CREATE TABLE public.bazi_case_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  user_id uuid NOT NULL,
  bazi_chart_id uuid NOT NULL,
  event_date date NOT NULL,
  category text NOT NULL CHECK (category = ANY (ARRAY['事业'::text, '学业'::text, '财富'::text, '婚姻'::text, '健康'::text, '六亲'::text, '其他'::text])),
  title text NOT NULL,
  detail text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT bazi_case_events_pkey PRIMARY KEY (id),
  CONSTRAINT bazi_case_events_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.bazi_case_profiles(id),
  CONSTRAINT bazi_case_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT bazi_case_events_bazi_chart_id_fkey FOREIGN KEY (bazi_chart_id) REFERENCES public.bazi_charts(id)
);
CREATE TABLE public.bazi_case_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  bazi_chart_id uuid NOT NULL UNIQUE,
  master_review jsonb NOT NULL DEFAULT '{}'::jsonb,
  owner_feedback jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT bazi_case_profiles_pkey PRIMARY KEY (id),
  CONSTRAINT bazi_case_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT bazi_case_profiles_bazi_chart_id_fkey FOREIGN KEY (bazi_chart_id) REFERENCES public.bazi_charts(id)
);
CREATE TABLE public.bazi_charts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  name text NOT NULL,
  gender text CHECK (gender = ANY (ARRAY['male'::text, 'female'::text])),
  birth_date date NOT NULL,
  birth_time text,
  birth_place text,
  created_at timestamp with time zone DEFAULT now(),
  calendar_type text DEFAULT 'solar'::text,
  is_leap_month boolean DEFAULT false,
  day_master text,
  day_branch text,
  longitude double precision,
  timezone text NOT NULL DEFAULT 'Asia/Shanghai' CHECK (char_length(timezone) BETWEEN 1 AND 100 AND timezone = btrim(timezone)),
  disambiguation text NOT NULL DEFAULT 'reject' CHECK (disambiguation IN ('reject', 'earlier', 'later', 'compatible')),
  CONSTRAINT bazi_charts_pkey PRIMARY KEY (id),
  CONSTRAINT bazi_charts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.community_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL,
  user_id uuid NOT NULL,
  parent_id uuid,
  content text NOT NULL,
  upvote_count integer DEFAULT 0,
  downvote_count integer DEFAULT 0,
  is_deleted boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT community_comments_pkey PRIMARY KEY (id),
  CONSTRAINT community_comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.community_posts(id),
  CONSTRAINT community_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT community_comments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.community_comments(id)
);
CREATE TABLE public.community_posts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  category text DEFAULT 'general'::text,
  tags ARRAY DEFAULT '{}'::text[],
  view_count integer DEFAULT 0,
  upvote_count integer DEFAULT 0,
  downvote_count integer DEFAULT 0,
  comment_count integer DEFAULT 0,
  is_pinned boolean DEFAULT false,
  is_featured boolean DEFAULT false,
  is_deleted boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT community_posts_pkey PRIMARY KEY (id),
  CONSTRAINT community_posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.community_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL,
  target_type text NOT NULL CHECK (target_type = ANY (ARRAY['post'::text, 'comment'::text])),
  target_id uuid NOT NULL,
  reason text NOT NULL,
  description text,
  status text DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'reviewed'::text, 'resolved'::text, 'dismissed'::text])),
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  review_notes text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT community_reports_pkey PRIMARY KEY (id),
  CONSTRAINT community_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES auth.users(id),
  CONSTRAINT community_reports_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id)
);
CREATE TABLE public.community_votes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  target_type text NOT NULL CHECK (target_type = ANY (ARRAY['post'::text, 'comment'::text])),
  target_id uuid NOT NULL,
  vote_type text NOT NULL CHECK (vote_type = ANY (ARRAY['up'::text, 'down'::text])),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT community_votes_pkey PRIMARY KEY (id),
  CONSTRAINT community_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.conversation_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  sequence integer NOT NULL,
  message_id text NOT NULL,
  role text NOT NULL,
  content text NOT NULL DEFAULT ''::text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT conversation_messages_pkey PRIMARY KEY (id),
  CONSTRAINT conversation_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id)
);
CREATE TABLE public.conversations (
  next_task_config jsonb,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  personality text DEFAULT 'master'::text,
  title text DEFAULT '新对话'::text,
  messages jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  source_type text DEFAULT 'chat'::text CHECK (source_type = ANY (ARRAY['chat'::text, 'bazi_wuxing'::text, 'bazi_personality'::text, 'tarot'::text, 'liuyao'::text, 'mbti'::text, 'hepan'::text, 'palm'::text, 'face'::text, 'dream'::text, 'qimen'::text, 'daliuren'::text, 'meihua'::text, 'xiaoliuren'::text, 'ziwei'::text])) NOT VALID,
  source_data jsonb,
  CONSTRAINT conversations_pkey PRIMARY KEY (id),
  CONSTRAINT conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.credit_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  amount integer NOT NULL,
  type text NOT NULL CHECK (type = ANY (ARRAY['earn'::text, 'spend'::text, 'refund'::text])),
  source text NOT NULL,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  balance_after integer,
  reference_type text,
  reference_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT credit_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT credit_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.daily_checkins (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  checkin_date date NOT NULL,
  reward_credits integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT daily_checkins_pkey PRIMARY KEY (id),
  CONSTRAINT daily_checkins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.daliuren_divinations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  question text,
  solar_date text NOT NULL,
  day_ganzhi text NOT NULL,
  hour_ganzhi text NOT NULL,
  yue_jiang text NOT NULL,
  result_data jsonb NOT NULL,
  settings jsonb,
  conversation_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT daliuren_divinations_pkey PRIMARY KEY (id),
  CONSTRAINT daliuren_divinations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT daliuren_divinations_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id)
);
CREATE TABLE public.face_readings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  analysis_type text DEFAULT 'full'::text,
  created_at timestamp with time zone DEFAULT now(),
  conversation_id uuid,
  CONSTRAINT face_readings_pkey PRIMARY KEY (id),
  CONSTRAINT face_readings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT face_readings_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id)
);
CREATE TABLE public.hepan_charts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  type text NOT NULL CHECK (type = ANY (ARRAY['love'::text, 'business'::text, 'family'::text])),
  person1_name text NOT NULL,
  person1_birth jsonb NOT NULL,
  person2_name text NOT NULL,
  person2_birth jsonb NOT NULL,
  compatibility_score integer,
  created_at timestamp with time zone DEFAULT now(),
  conversation_id uuid,
  result_data jsonb,
  CONSTRAINT hepan_charts_pkey PRIMARY KEY (id),
  CONSTRAINT hepan_charts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT hepan_charts_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id)
);
CREATE TABLE public.knowledge_bases (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  weight text DEFAULT 'normal'::text CHECK (weight = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text])),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT knowledge_bases_pkey PRIMARY KEY (id),
  CONSTRAINT knowledge_bases_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.knowledge_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  kb_id uuid NOT NULL,
  content text NOT NULL,
  content_vector USER-DEFINED,
  source_type text NOT NULL,
  source_id text NOT NULL,
  chunk_index integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT knowledge_entries_pkey PRIMARY KEY (id),
  CONSTRAINT knowledge_entries_kb_id_fkey FOREIGN KEY (kb_id) REFERENCES public.knowledge_bases(id)
);
CREATE TABLE public.liuyao_divinations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  question text NOT NULL,
  hexagram_code text NOT NULL,
  changed_hexagram_code text,
  changed_lines jsonb,
  created_at timestamp with time zone DEFAULT now(),
  conversation_id uuid,
  yongshen_targets ARRAY CHECK (yongshen_targets IS NULL OR COALESCE(array_length(yongshen_targets, 1), 0) >= 1 AND yongshen_targets <@ ARRAY['父母'::text, '兄弟'::text, '子孙'::text, '妻财'::text, '官鬼'::text]),
  CONSTRAINT liuyao_divinations_pkey PRIMARY KEY (id),
  CONSTRAINT liuyao_divinations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT liuyao_divinations_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id)
);
CREATE TABLE public.login_attempts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email text NOT NULL,
  ip_address text,
  attempt_at timestamp with time zone DEFAULT now(),
  success boolean DEFAULT false,
  CONSTRAINT login_attempts_pkey PRIMARY KEY (id)
);
CREATE TABLE public.mbti_readings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  mbti_type text NOT NULL,
  scores jsonb,
  percentages jsonb,
  created_at timestamp with time zone DEFAULT now(),
  conversation_id uuid,
  CONSTRAINT mbti_readings_pkey PRIMARY KEY (id),
  CONSTRAINT mbti_readings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT mbti_readings_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id)
);
CREATE TABLE public.meihua_divinations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  question text NOT NULL CHECK (length(btrim(question)) > 0),
  method text NOT NULL CHECK (method = ANY (ARRAY['time'::text, 'text_split'::text, 'number_pair'::text, 'number_triplet'::text])),
  cast_datetime timestamp without time zone NOT NULL,
  main_hexagram text NOT NULL,
  changed_hexagram text,
  input_data jsonb NOT NULL,
  result_data jsonb NOT NULL,
  conversation_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT meihua_divinations_pkey PRIMARY KEY (id),
  CONSTRAINT meihua_divinations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT meihua_divinations_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL
);
CREATE TABLE public.ming_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  note_date date NOT NULL DEFAULT CURRENT_DATE,
  content text NOT NULL,
  mood text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT ming_notes_pkey PRIMARY KEY (id),
  CONSTRAINT ming_notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.ming_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  content text,
  category text DEFAULT 'general'::text,
  tags ARRAY DEFAULT '{}'::text[],
  event_date date,
  related_chart_type text,
  related_chart_id uuid,
  is_pinned boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT ming_records_pkey PRIMARY KEY (id),
  CONSTRAINT ming_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.notifications (
  event_key text,
  event_data jsonb,
  popup_claimed_at timestamptz,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type character varying NOT NULL,
  title text NOT NULL,
  content text,
  is_read boolean DEFAULT false,
  link text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.palm_readings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  analysis_type text DEFAULT 'full'::text,
  hand_type text DEFAULT 'left'::text CHECK (hand_type = ANY (ARRAY['left'::text, 'right'::text, 'both'::text])),
  created_at timestamp with time zone DEFAULT now(),
  conversation_id uuid,
  CONSTRAINT palm_readings_pkey PRIMARY KEY (id),
  CONSTRAINT palm_readings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT palm_readings_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id)
);
CREATE TABLE public.qimen_charts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  question text,
  chart_time timestamp with time zone NOT NULL,
  dun_type text NOT NULL CHECK (dun_type = ANY (ARRAY['yang'::text, 'yin'::text])),
  ju_number integer NOT NULL CHECK (ju_number >= 1 AND ju_number <= 9),
  pan_type text NOT NULL DEFAULT 'zhuan'::text CHECK (pan_type = 'zhuan'::text),
  ju_method text NOT NULL DEFAULT 'chaibu'::text CHECK (ju_method = ANY (ARRAY['chaibu'::text, 'maoshan'::text])),
  conversation_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  year integer NOT NULL,
  month integer NOT NULL CHECK (month >= 1 AND month <= 12),
  day integer NOT NULL CHECK (day >= 1 AND day <= 31),
  hour integer NOT NULL CHECK (hour >= 0 AND hour <= 23),
  minute integer NOT NULL CHECK (minute >= 0 AND minute <= 59),
  timezone text NOT NULL DEFAULT 'Asia/Shanghai'::text,
  zhi_fu_ji_gong text NOT NULL DEFAULT 'ji_liuyi'::text CHECK (zhi_fu_ji_gong = ANY (ARRAY['ji_liuyi'::text, 'ji_wugong'::text])),
  CONSTRAINT qimen_charts_pkey PRIMARY KEY (id),
  CONSTRAINT qimen_charts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT qimen_charts_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id)
);
CREATE TABLE public.rate_limits (
  id integer NOT NULL DEFAULT nextval('rate_limits_id_seq'::regclass),
  identifier character varying NOT NULL,
  endpoint character varying NOT NULL,
  request_count integer DEFAULT 1,
  window_start timestamp with time zone DEFAULT now(),
  CONSTRAINT rate_limits_pkey PRIMARY KEY (id)
);
CREATE TABLE public.reminder_subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  reminder_type text NOT NULL CHECK (reminder_type = ANY (ARRAY['solar_term'::text, 'fortune'::text, 'key_date'::text])),
  enabled boolean DEFAULT true,
  notify_email boolean DEFAULT false,
  notify_site boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT reminder_subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT reminder_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.scheduled_reminders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  reminder_type text NOT NULL,
  scheduled_for timestamp with time zone NOT NULL,
  content jsonb,
  sent boolean DEFAULT false,
  sent_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT scheduled_reminders_pkey PRIMARY KEY (id),
  CONSTRAINT scheduled_reminders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.tarot_readings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  spread_id text NOT NULL,
  question text,
  cards jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  conversation_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT tarot_readings_pkey PRIMARY KEY (id),
  CONSTRAINT tarot_readings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT tarot_readings_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id)
);
CREATE TABLE public.user_oauth_providers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider text NOT NULL,
  provider_user_id text NOT NULL,
  provider_email text,
  provider_username text,
  provider_avatar_url text,
  provider_metadata jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_oauth_providers_pkey PRIMARY KEY (id),
  CONSTRAINT user_oauth_providers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.user_settings (
  chat_preferences jsonb NOT NULL DEFAULT '{}',
  daily_briefing_settings jsonb NOT NULL DEFAULT '{}',
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
  expression_style text DEFAULT 'direct'::text CHECK (expression_style = ANY (ARRAY['direct'::text, 'gentle'::text])),
  user_profile jsonb DEFAULT '{}'::jsonb,
  prompt_kb_ids jsonb DEFAULT '[]'::jsonb,
  visualization_settings jsonb DEFAULT '{}'::jsonb,
  chart_prompt_detail_level text NOT NULL DEFAULT 'default'::text CHECK (chart_prompt_detail_level = ANY (ARRAY['default'::text, 'more'::text, 'full'::text])),
  CONSTRAINT user_settings_pkey PRIMARY KEY (user_id),
  CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT user_settings_default_bazi_chart_id_fkey FOREIGN KEY (default_bazi_chart_id) REFERENCES public.bazi_charts(id),
  CONSTRAINT user_settings_default_ziwei_chart_id_fkey FOREIGN KEY (default_ziwei_chart_id) REFERENCES public.ziwei_charts(id)
);
CREATE TABLE public.users (
  id uuid NOT NULL,
  nickname text,
  avatar_url text,
  membership text DEFAULT 'free'::text CHECK (membership = ANY (ARRAY['free'::text, 'plus'::text, 'pro'::text])),
  membership_expires_at timestamp with time zone,
  ai_chat_count integer DEFAULT 1,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  is_admin boolean DEFAULT false,
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.xiaoliuren_divinations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  question text,
  solar_datetime timestamp without time zone NOT NULL,
  lunar_month smallint NOT NULL CHECK (lunar_month >= 1 AND lunar_month <= 12),
  lunar_day smallint NOT NULL CHECK (lunar_day >= 1 AND lunar_day <= 30),
  is_leap_month boolean NOT NULL DEFAULT false,
  shichen text NOT NULL,
  final_status text NOT NULL CHECK (final_status = ANY (ARRAY['大安'::text, '留连'::text, '速喜'::text, '赤口'::text, '小吉'::text, '空亡'::text])),
  input_data jsonb NOT NULL,
  result_data jsonb NOT NULL,
  conversation_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT xiaoliuren_divinations_pkey PRIMARY KEY (id),
  CONSTRAINT xiaoliuren_divinations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT xiaoliuren_divinations_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL
);
CREATE TABLE public.ziwei_charts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  name text NOT NULL,
  gender text,
  birth_date date NOT NULL,
  birth_time text NOT NULL CHECK (btrim(birth_time) <> ''::text),
  calendar_type text DEFAULT 'solar'::text,
  created_at timestamp with time zone DEFAULT now(),
  is_leap_month boolean DEFAULT false,
  birth_place text,
  longitude double precision,
  timezone text NOT NULL DEFAULT 'Asia/Shanghai' CHECK (char_length(timezone) BETWEEN 1 AND 100 AND timezone = btrim(timezone)),
  disambiguation text NOT NULL DEFAULT 'reject' CHECK (disambiguation IN ('reject', 'earlier', 'later', 'compatible')),
  CONSTRAINT ziwei_charts_pkey PRIMARY KEY (id),
  CONSTRAINT ziwei_charts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);

-- Agent schema additions from 20261005_100000_agent_runtime.sql.
-- Apply the complete migration for indexes, RLS, grants, functions and triggers.
CREATE TABLE public.agent_runs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  request_id text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','awaiting_input','cancelling','completed','cancelled','failed')),
  input jsonb NOT NULL,
  checkpoint jsonb NOT NULL,
  public_message jsonb NOT NULL,
  billing text NOT NULL CHECK (billing IN ('charged','exempt','refunded')),
  worker_id text,
  fence bigint NOT NULL DEFAULT 0,
  lease_until timestamptz,
  cancel_requested boolean NOT NULL DEFAULT false,
  -- Historical links only; 20261007_100000_agent_chat_results no longer creates records.
  record_id uuid REFERENCES public.ming_records(id) ON DELETE SET NULL,
  event_cursor bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, request_id)
);
CREATE TABLE public.agent_run_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.agent_run_commands (
  revision integer NOT NULL DEFAULT 1,
  sort_order bigint NOT NULL,
  delivery_state text NOT NULL DEFAULT 'pending' CHECK(delivery_state IN ('pending','claimed','admitted','consumed','cancelled')),
  original_message jsonb,
  original_mode text,
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  request_id text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('steer','follow_up','reply')),
  message jsonb NOT NULL,
  consumed boolean NOT NULL DEFAULT false,
  durable_admitted boolean NOT NULL DEFAULT false,
  UNIQUE (run_id, request_id)
);
CREATE TABLE public.agent_run_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  call_id text NOT NULL,
  tool_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('calculation','tool')),
  args jsonb NOT NULL,
  result jsonb NOT NULL,
  UNIQUE (run_id, call_id)
);
CREATE TABLE public.agent_run_credentials (
  run_id uuid PRIMARY KEY REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  ciphertext jsonb NOT NULL
);
CREATE TABLE public.agent_workers (
  id text PRIMARY KEY,
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  engine text NOT NULL DEFAULT 'pi-agent-core/1.0.2'
);

-- Pi Durable storage and ownership from 20261006_100000_agent_pi_durable.sql.
-- Closed to clients: the worker reads it through its lease (agent_durable_read); administrators read task and
-- conversation records without transcript content through agent_admin_task_log (20261021_100000_agent_admin_task_log.sql).
CREATE TABLE public.agent_durable_commits (
  run_id uuid NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  sequence bigint NOT NULL CHECK(sequence > 0),
  writes jsonb NOT NULL CHECK(jsonb_typeof(writes)='array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(run_id,sequence)
);

CREATE TABLE public.agent_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  object_path text NOT NULL UNIQUE, name text NOT NULL, kind text NOT NULL CHECK(kind IN ('image','text')),
  mime_type text NOT NULL, size integer NOT NULL CHECK(size>0 AND size<=10485760), sha256 text NOT NULL,
  width integer, height integer, status text NOT NULL DEFAULT 'uploading' CHECK(status IN ('uploading','ready','deleting')),
  created_at timestamptz NOT NULL DEFAULT now(), orphaned_at timestamptz DEFAULT now()
);
CREATE TABLE public.agent_attachment_refs (
  attachment_id uuid NOT NULL REFERENCES public.agent_attachments(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  command_sequence bigint REFERENCES public.agent_run_commands(sequence) ON DELETE CASCADE,
  CHECK((conversation_id IS NULL)<>(command_sequence IS NULL))
);
CREATE TABLE public.prompt_enhancement_usage (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  local_date date NOT NULL, calls integer NOT NULL DEFAULT 0 CHECK(calls BETWEEN 0 AND 5),
  PRIMARY KEY(user_id,local_date)
);
CREATE TABLE public.daily_briefing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  local_date date NOT NULL, timezone text NOT NULL, deadline timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','generating','completed','failed','cancelled','skipped')),
  billing text NOT NULL DEFAULT 'none' CHECK(billing IN ('none','reserved','settled','refunded')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3), lease_token uuid, lease_until timestamptz,
  result_conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL, content text, error text,
  notification_pending boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,local_date)
);

-- Agent long-term memory; maintained by 20261008_180000_agent_competence.sql
CREATE TABLE public.user_agent_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 80),
  content text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 2000),
  kind text NOT NULL DEFAULT 'preference' CHECK (kind IN ('preference','context')),
  fingerprint text GENERATED ALWAYS AS (md5(content)) STORED,
  source_run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  source_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id,fingerprint)
);

-- Public read-only conversation shares; maintained by 20261019_100000_conversation_shares.sql
CREATE TABLE public.conversation_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE CHECK (token ~ '^[A-Za-z0-9_-]{43}$'),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 200),
  snapshot jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(snapshot) = 'array'),
  include_charts boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
