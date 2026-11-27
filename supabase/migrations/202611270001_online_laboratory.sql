create table if not exists public.online_lab_users (
  id uuid primary key,
  username text not null,
  display_name text not null,
  role text not null check (role in ('admin', 'student')),
  group_id text not null default '',
  active boolean not null default true,
  must_change_password boolean not null default false,
  password_salt text not null,
  password_hash text not null,
  created_at timestamptz not null default now(),
  password_changed_at timestamptz
);

create unique index if not exists online_lab_users_username_lower_uidx
  on public.online_lab_users (lower(username));

create table if not exists public.online_lab_documents (
  id text primary key check (id in ('curriculum', 'settings')),
  payload jsonb not null,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.online_lab_events (
  id text primary key,
  student_id uuid not null references public.online_lab_users(id) on delete cascade,
  is_measure boolean not null default false,
  payload jsonb not null
);

create index if not exists online_lab_events_student_idx
  on public.online_lab_events (student_id);

create table if not exists public.online_lab_sessions (
  token_hash text primary key,
  user_id uuid not null references public.online_lab_users(id) on delete cascade,
  expires_at timestamptz not null
);

create index if not exists online_lab_sessions_user_idx
  on public.online_lab_sessions (user_id);

alter table public.online_lab_users enable row level security;
alter table public.online_lab_documents enable row level security;
alter table public.online_lab_events enable row level security;
alter table public.online_lab_sessions enable row level security;

revoke all on public.online_lab_users from anon, authenticated;
revoke all on public.online_lab_documents from anon, authenticated;
revoke all on public.online_lab_events from anon, authenticated;
revoke all on public.online_lab_sessions from anon, authenticated;
grant all on public.online_lab_users to service_role;
grant all on public.online_lab_documents to service_role;
grant all on public.online_lab_events to service_role;
grant all on public.online_lab_sessions to service_role;
