-- Supabase SQL Editor에서 전체 실행. 신규 프로젝트 기준.
create extension if not exists pgcrypto;
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 nickname text not null unique check (char_length(nickname) between 2 and 20),
 role text not null default 'pending' check (role in ('pending','member','admin','withdrawn')),
 level integer check (level between 1 and 300),
 job text,
 damage text,
 created_at timestamptz not null default now()
);
create table public.memberships (
 user_id uuid not null references public.profiles(id) on delete cascade,
 raid text not null check (raid in ('혼테일','카쿰 1공대','카쿰 2공대')),
 primary key(user_id,raid)
);
create table public.attendance (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id),
 raid text not null check (raid in ('혼테일','카쿰 1공대','카쿰 2공대')),
 raid_date date not null,
 status text not null check (status in ('참여','미참여')),
 login_time time,
 claim_nickname text,
 substitute_status text not null default '없음' check (substitute_status in ('없음','미구인','구인완료')),
 substitute_nickname text,
 updated_at timestamptz not null default now(),
 unique(user_id,raid,raid_date)
);
create table public.completed_raids (
 id uuid primary key default gen_random_uuid(),
 raid text not null check (raid in ('혼테일','카쿰 1공대','카쿰 2공대')),
 raid_date date not null,
 completed_at timestamptz not null default now(),
 completed_by uuid references public.profiles(id),
 snapshot jsonb not null,
 unique(raid,raid_date)
);
create index attendance_raid_date_idx on public.attendance(raid,raid_date);
create index completed_raids_date_idx on public.completed_raids(raid_date desc);

create function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role='admin');
$$;
create function public.is_active_member() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role in ('member','admin'));
$$;
create function public.has_raid_access(p_raid text) returns boolean language sql stable security definer set search_path = '' as $$
 select public.is_admin() or (public.is_active_member() and exists(select 1 from public.memberships where user_id=auth.uid() and raid=p_raid));
$$;
create function public.raid_is_completed(p_raid text,p_date date) returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.completed_raids where raid=p_raid and raid_date=p_date);
$$;

-- 회원가입 시 닉네임은 Auth user_metadata에서 생성. 관리자 권한은 메타데이터로 지정 불가.
create function public.on_auth_user_created() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.profiles(id,nickname) values(new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'nickname'),''),'user_'||substr(new.id::text,1,8)));
 return new;
end; $$;
create trigger auth_user_created after insert on auth.users for each row execute function public.on_auth_user_created();

alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.attendance enable row level security;
alter table public.completed_raids enable row level security;

create policy profiles_select on public.profiles for select to authenticated using (
 id=auth.uid() or public.is_admin() or (public.is_active_member() and role='member' and exists(
  select 1 from public.memberships m1 join public.memberships m2 on m1.raid=m2.raid
  where m1.user_id=auth.uid() and m2.user_id=profiles.id
 ))
);
create policy profiles_update_self on public.profiles for update to authenticated using (id=auth.uid() and role in ('member','pending')) with check (id=auth.uid() and role in ('member','pending'));
-- role 필드는 일반 사용자에게 UPDATE 권한을 부여하지 않음
revoke update on public.profiles from authenticated;
grant update(level,job,damage) on public.profiles to authenticated;

create policy memberships_read on public.memberships for select to authenticated using (public.is_admin() or (public.is_active_member() and (user_id=auth.uid() or public.has_raid_access(raid))));

create policy attendance_read on public.attendance for select to authenticated using(public.has_raid_access(raid));
create policy attendance_insert on public.attendance for insert to authenticated with check (
 user_id=auth.uid() and public.has_raid_access(raid) and not public.raid_is_completed(raid,raid_date)
);
create policy attendance_update on public.attendance for update to authenticated using (
 user_id=auth.uid() and public.has_raid_access(raid) and not public.raid_is_completed(raid,raid_date)
) with check (user_id=auth.uid() and public.has_raid_access(raid) and not public.raid_is_completed(raid,raid_date));
create policy completed_read on public.completed_raids for select to authenticated using(public.has_raid_access(raid));

-- 관리 기능은 검증된 SECURITY DEFINER 함수로만 실행
create function public.admin_set_member(p_user uuid,p_role text,p_raids text[]) returns void language plpgsql security definer set search_path = '' as $$
declare v_raid text;
begin
 if not public.is_admin() then raise exception '관리자 전용'; end if;
 if p_role not in ('member','pending','withdrawn') then raise exception '잘못된 상태'; end if;
 if p_user=auth.uid() then raise exception '본인 상태 변경 불가'; end if;
 if not exists(select 1 from public.profiles where id=p_user and role<>'admin') then raise exception '대상 없음 또는 관리자'; end if;
 if p_role='member' and (p_raids is null or cardinality(p_raids)=0) then raise exception '공대 선택 필요'; end if;
 if exists(select 1 from unnest(coalesce(p_raids,array[]::text[])) r where r not in ('혼테일','카쿰 1공대','카쿰 2공대')) then raise exception '잘못된 공대'; end if;
 update public.profiles set role=p_role where id=p_user;
 delete from public.memberships where user_id=p_user;
 if p_role='member' then
  foreach v_raid in array p_raids loop insert into public.memberships(user_id,raid) values(p_user,v_raid); end loop;
 end if;
end; $$;

create function public.admin_set_attendance(p_user uuid,p_raid text,p_date date,p_status text,p_login time,p_claim text,p_sub_status text,p_sub_name text) returns void language plpgsql security definer set search_path = '' as $$
begin
 if not public.is_admin() then raise exception '관리자 전용'; end if;
 if public.raid_is_completed(p_raid,p_date) then raise exception '완료된 트라이'; end if;
 if not exists(select 1 from public.memberships where user_id=p_user and raid=p_raid) then raise exception '소속 공대원이 아님'; end if;
 insert into public.attendance(user_id,raid,raid_date,status,login_time,claim_nickname,substitute_status,substitute_nickname)
 values(p_user,p_raid,p_date,p_status,p_login,p_claim,coalesce(p_sub_status,'없음'),p_sub_name)
 on conflict(user_id,raid,raid_date) do update set status=excluded.status,login_time=excluded.login_time,claim_nickname=excluded.claim_nickname,substitute_status=excluded.substitute_status,substitute_nickname=excluded.substitute_nickname,updated_at=now();
end; $$;

create function public.admin_complete_raid(p_raid text,p_date date) returns void language plpgsql security definer set search_path = '' as $$
declare v_snapshot jsonb;
begin
 if not public.is_admin() then raise exception '관리자 전용'; end if;
 if p_raid not in ('혼테일','카쿰 1공대','카쿰 2공대') then raise exception '잘못된 공대'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('nickname',p.nickname,'status',a.status,'login_time',a.login_time,'claim_nickname',a.claim_nickname,'substitute_status',a.substitute_status,'substitute_nickname',a.substitute_nickname) order by p.nickname),'[]'::jsonb)
 into v_snapshot from public.attendance a join public.profiles p on p.id=a.user_id
 where a.raid=p_raid and a.raid_date=p_date and (a.status='참여' or a.substitute_status='구인완료');
 insert into public.completed_raids(raid,raid_date,completed_by,snapshot) values(p_raid,p_date,auth.uid(),v_snapshot);
end; $$;
create function public.admin_reopen_raid(p_raid text,p_date date) returns void language plpgsql security definer set search_path = '' as $$
begin
 if not public.is_admin() then raise exception '관리자 전용'; end if;
 delete from public.completed_raids where raid=p_raid and raid_date=p_date;
end; $$;
revoke all on function public.admin_set_member(uuid,text,text[]) from public;
revoke all on function public.admin_set_attendance(uuid,text,date,text,time,text,text,text) from public;
revoke all on function public.admin_complete_raid(text,date) from public;
revoke all on function public.admin_reopen_raid(text,date) from public;
grant execute on function public.admin_set_member(uuid,text,text[]) to authenticated;
grant execute on function public.admin_set_attendance(uuid,text,date,text,time,text,text,text) to authenticated;
grant execute on function public.admin_complete_raid(text,date) to authenticated;
grant execute on function public.admin_reopen_raid(text,date) to authenticated;

-- 중요: 최초 관리자 계정은 일반 가입 후 SQL Editor에서 직접 지정:
-- update public.profiles set role='admin' where nickname='관리자닉네임';
-- 반드시 본인이 가입한 계정인지 확인 후 실행할 것.
