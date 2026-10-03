-- Migration: create_conversations_table
-- Run this in Supabase SQL Editor

-- 创建对话历史表
create table if not exists public.conversations (
    id uuid default gen_random_uuid() primary key,
    user_id uuid references auth.users(id) on delete cascade,
    bazi_chart_id uuid references public.bazi_charts(id) on delete set null,
    ziwei_chart_id uuid references public.ziwei_charts(id) on delete set null,
    personality text default 'master',
    title text default '新对话',
    messages jsonb default '[]'::jsonb,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- 创建索引
create index if not exists conversations_user_id_idx on public.conversations(user_id);
create index if not exists conversations_updated_at_idx on public.conversations(updated_at desc);

-- 启用 RLS
alter table public.conversations enable row level security;

-- RLS 策略：用户只能访问自己的对话
create policy "Users can view own conversations"
    on public.conversations for select
    using (auth.uid() = user_id);

create policy "Users can insert own conversations"
    on public.conversations for insert
    with check (auth.uid() = user_id);

create policy "Users can update own conversations"
    on public.conversations for update
    using (auth.uid() = user_id);

create policy "Users can delete own conversations"
    on public.conversations for delete
    using (auth.uid() = user_id);

-- 更新时间触发器
create or replace function update_conversations_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

create trigger conversations_updated_at
    before update on public.conversations
    for each row
    execute function update_conversations_updated_at();
