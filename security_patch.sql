-- 기존 Supabase 프로젝트에 적용하는 최소 권한 보강. 기존 데이터 삭제 없음.
-- 공대원이 직접 대타 구인 상태/닉네임을 바꾸지 못하도록 열 단위 제한.
REVOKE UPDATE ON TABLE public.attendance FROM authenticated;
GRANT UPDATE (status, login_time, claim_nickname) ON TABLE public.attendance TO authenticated;
-- 자체 INSERT 시 대타 필드 값을 조작하는 것도 막기 위해
-- 서버에서 기본값을 사용하도록 INSERT 허용 열을 제한.
REVOKE INSERT ON TABLE public.attendance FROM authenticated;
GRANT INSERT (user_id, raid, raid_date, status, login_time, claim_nickname) ON TABLE public.attendance TO authenticated;
-- 기본 upsert의 ON CONFLICT UPDATE에는 SELECT/UPDATE 권한이 요구됩니다.
-- 관리자의 대타 변경은 기존 SECURITY DEFINER RPC만 사용합니다.
