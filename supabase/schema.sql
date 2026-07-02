create table if not exists public.rooms (
  code text primary key,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.private_states (
  room_code text not null references public.rooms(code) on delete cascade,
  uid text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_code, uid)
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_rooms_updated_at on public.rooms;
create trigger touch_rooms_updated_at
before update on public.rooms
for each row execute function public.touch_updated_at();

drop trigger if exists touch_private_states_updated_at on public.private_states;
create trigger touch_private_states_updated_at
before update on public.private_states
for each row execute function public.touch_updated_at();

alter table public.rooms enable row level security;
alter table public.private_states enable row level security;

create or replace function public.is_room_participant(target_room_code text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.rooms
    where rooms.code = target_room_code
      and (rooms.data -> 'players') ? (auth.uid()::text)
  );
$$;

create or replace function public.is_room_host(target_room_code text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.rooms
    where rooms.code = target_room_code
      and rooms.data ->> 'hostUid' = auth.uid()::text
  );
$$;

grant execute on function public.is_room_participant(text) to authenticated;
grant execute on function public.is_room_host(text) to authenticated;

drop policy if exists "participants can read rooms" on public.rooms;
create policy "participants can read rooms"
on public.rooms for select
to authenticated
using (public.is_room_participant(code));

drop policy if exists "authenticated users can create hosted rooms" on public.rooms;
create policy "authenticated users can create hosted rooms"
on public.rooms for insert
to authenticated
with check ((data ->> 'hostUid') = auth.uid()::text);

drop policy if exists "participants can update rooms" on public.rooms;
create policy "participants can update rooms"
on public.rooms for update
to authenticated
using (public.is_room_participant(code))
with check (public.is_room_participant(code));

drop policy if exists "players can read own private state during night" on public.private_states;
drop policy if exists "authenticated users can read private states" on public.private_states;
create policy "authenticated users can read private states"
on public.private_states for select
to authenticated
using (true);

drop policy if exists "host can create private states" on public.private_states;
drop policy if exists "participants can create private states" on public.private_states;
drop policy if exists "authenticated users can create private states" on public.private_states;
create policy "authenticated users can create private states"
on public.private_states for insert
to authenticated
with check (true);

drop policy if exists "owner or host can update private states" on public.private_states;
drop policy if exists "authenticated users can update private states" on public.private_states;
create policy "authenticated users can update private states"
on public.private_states for update
to authenticated
using (true)
with check (true);

drop policy if exists "owner or host can delete private states" on public.private_states;
drop policy if exists "authenticated users can delete private states" on public.private_states;
create policy "authenticated users can delete private states"
on public.private_states for delete
to authenticated
using (true);

do $$
begin
  alter publication supabase_realtime add table public.rooms;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.private_states;
exception
  when duplicate_object then null;
end $$;
