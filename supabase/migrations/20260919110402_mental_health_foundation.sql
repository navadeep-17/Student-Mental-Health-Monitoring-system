create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text,
  role text not null default 'student' check (role in ('student', 'teacher', 'counselor', 'admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (
    username is null or username ~ '^[a-z0-9][a-z0-9_.-]{2,31}$'
  )
);

create table public.student_teacher_assignments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  is_active boolean not null default true,
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  check (student_id <> teacher_id),
  check ((is_active and ended_at is null) or (not is_active))
);

create unique index one_active_teacher_per_student
  on public.student_teacher_assignments(student_id)
  where is_active;

create index assignments_teacher_active_idx
  on public.student_teacher_assignments(teacher_id, is_active);

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  mood text,
  anxiety smallint not null check (anxiety between 1 and 5),
  depression smallint not null check (depression between 1 and 5),
  academic_pressure smallint not null check (academic_pressure between 1 and 5),
  study_satisfaction smallint not null check (study_satisfaction between 1 and 5),
  average_sleep numeric(4,1) not null check (average_sleep between 0 and 24),
  social_relationships smallint not null check (social_relationships between 1 and 5),
  academic_workload smallint not null check (academic_workload between 1 and 5),
  financial_concerns smallint not null check (financial_concerns between 1 and 5),
  isolation smallint not null check (isolation between 1 and 5),
  future_insecurity smallint not null check (future_insecurity between 1 and 5),
  created_at timestamptz not null default now()
);

create index assessments_student_created_idx
  on public.assessments(student_id, created_at desc);

create table public.predictions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null unique references public.assessments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  model_version text not null default 'legacy-v1',
  prediction smallint not null check (prediction between 0 and 2),
  label text not null check (label in ('Low Risk', 'Medium Risk', 'High Risk')),
  low_prob double precision not null check (low_prob between 0 and 1),
  medium_prob double precision not null check (medium_prob between 0 and 1),
  high_prob double precision not null check (high_prob between 0 and 1),
  stress_score double precision,
  mental_health_index double precision,
  social_support_score double precision,
  stress_load_index double precision,
  lifestyle_risk double precision,
  emotional_stability double precision,
  suggestion text,
  insight text,
  created_at timestamptz not null default now(),
  constraint predictions_probabilities_sum check (
    abs((low_prob + medium_prob + high_prob) - 1.0) < 0.01
  )
);

create index predictions_student_created_idx
  on public.predictions(student_id, created_at desc);

create index predictions_high_risk_idx
  on public.predictions(student_id, created_at desc)
  where label = 'High Risk';

create table public.user_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  consent_type text not null check (consent_type in ('privacy', 'monitoring', 'data_processing')),
  policy_version text not null,
  granted boolean not null,
  recorded_at timestamptz not null default now(),
  unique (user_id, consent_type, policy_version)
);

create index user_consents_user_idx
  on public.user_consents(user_id, recorded_at desc);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    nullif(lower(new.raw_user_meta_data ->> 'username'), ''),
    nullif(new.raw_user_meta_data ->> 'display_name', '')
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.student_teacher_assignments enable row level security;
alter table public.assessments enable row level security;
alter table public.predictions enable row level security;
alter table public.user_consents enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.student_teacher_assignments from anon, authenticated;
revoke all on public.assessments from anon, authenticated;
revoke all on public.predictions from anon, authenticated;
revoke all on public.user_consents from anon, authenticated;

grant select on public.profiles to authenticated;
grant select on public.student_teacher_assignments to authenticated;
grant select on public.assessments to authenticated;
grant select on public.predictions to authenticated;
grant select on public.user_consents to authenticated;

grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.student_teacher_assignments to service_role;
grant select, insert, update, delete on public.assessments to service_role;
grant select, insert, update, delete on public.predictions to service_role;
grant select, insert, update, delete on public.user_consents to service_role;

create policy "profiles visible to self and assigned counterpart"
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1
    from public.student_teacher_assignments a
    where a.is_active
      and (
        (a.teacher_id = (select auth.uid()) and a.student_id = profiles.id)
        or
        (a.student_id = (select auth.uid()) and a.teacher_id = profiles.id)
      )
  )
);

create policy "assignments visible to participants"
on public.student_teacher_assignments
for select
to authenticated
using (
  student_id = (select auth.uid())
  or teacher_id = (select auth.uid())
);

create policy "students can read own assessments"
on public.assessments
for select
to authenticated
using (student_id = (select auth.uid()));

create policy "predictions visible to student and assigned teacher"
on public.predictions
for select
to authenticated
using (
  student_id = (select auth.uid())
  or exists (
    select 1
    from public.student_teacher_assignments a
    where a.is_active
      and a.student_id = predictions.student_id
      and a.teacher_id = (select auth.uid())
  )
);

create policy "users can read own consents"
on public.user_consents
for select
to authenticated
using (user_id = (select auth.uid()));
