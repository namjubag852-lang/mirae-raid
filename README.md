# 미래공대 공대원 관리 — 정식 운영 연결 준비본

## 먼저 읽기
이 패키지는 기존 Vercel 데모를 대체할 **실제 서버 저장/인증 연결용 코드**입니다. 현재 `config.js` 값은 비어 있어 회원가입이 열리지 않습니다. Supabase 연결과 보안 검증을 끝낸 후 공개하세요. 기존 분배사이트는 수정하지 않습니다.

## 1. Supabase 무료 프로젝트 생성
1. https://supabase.com/dashboard 에 가입하고 새 프로젝트를 만듭니다.
2. 프로젝트 **SQL Editor**에서 `schema.sql` 전체를 실행합니다. **신규 프로젝트에서만** 실행하도록 설계했습니다.
3. **Authentication > Providers > Email**에서 이메일 인증 정책을 확인합니다. 운영 전 이메일 확인을 활성화하는 것을 권장합니다. 이메일 발송은 무료 요금제 제한이 있으므로 실제 가입 전 확인하세요.
4. **Project Settings > API** 또는 **Connect** 화면에서 `Project URL`과 `anon/publishable key`를 복사합니다. `service_role`/`secret` 키는 절대로 공개 파일에 넣지 마세요.
5. `config.js`에 위 두 값을 입력합니다.

## 2. 관리자 계정 생성
1. Vercel에 배포한 사이트에서 본인 이메일과 게임 닉네임으로 회원가입하고 이메일 인증을 마칩니다.
2. Supabase SQL Editor에서 본인의 가입 계정인지 확인한 뒤 아래 SQL을 실행합니다.

```sql
select id, nickname, role from public.profiles;
update public.profiles set role='admin' where id='본인_UUID';
```

`본인_UUID`는 조회 결과에서 확인한 관리자 계정의 ID로 바꿉니다. 임의 닉네임만으로 다른 계정을 관리자로 지정하지 마세요. SQL Editor에 붙여 넣을 때 따옴표를 유지하세요.

## 3. 기존 Vercel 프로젝트 재배포
1. GitHub `mirae-raid` 저장소에서 기존 HTML 파일이 들어 있는 **하위 폴더**를 확인합니다.
2. 이 패키지의 `index.html`, `admin.html`, `app.js`, `config.js`, `schema.sql`, `vercel.json`, `README.md`를 **기존 Vercel Root Directory로 지정한 동일 폴더**에 업로드/덮어쓰기 합니다. GitHub 업로드 시 ZIP 파일 자체가 아니라 압축 해제한 파일들을 올립니다.
3. GitHub Commit 후 Vercel Deployments에서 자동 배포 결과를 확인합니다.
4. 실제 회원가입을 받기 전 두 개의 다른 브라우저로 가입·승인·접근제한·탈퇴를 검증합니다.

## 구현 범위
- 이메일/비밀번호 인증, 가입 승인, 공대별 접근 제어 (Supabase Auth + RLS)
- 공대장 가입 승인 및 소속 공대 배정
- **공대 탈퇴**: `withdrawn` 처리, 소속 해제, 기존 트라이 완료 스냅샷 보존. 데이터 영구 삭제는 하지 않습니다.
- 날짜별 참여, 부캐릭 청구 닉네임, 관리자 대타 상태/닉네임
- 완료 처리 시 실제 참여자 또는 구인완료 대타 기록을 스냅샷으로 저장, 완료 후 참여 수정 잠금
- 완료 취소 및 기록 조회

## 아직 미구현 (운영 시작 전 결정 필요)
- 기존 데모의 손님 구인/입금, 인증 스크린샷 업로드, 아이템 획득 기록, 휴대폰 번호 관리 기능은 **아직 서버에 이식하지 않았습니다.**
- 개인정보 처리 안내, 백업 및 복구 절차, 관리자 2FA, 비밀번호 재설정 메일 설정, 사용자 가입 부하 테스트가 필요합니다.
- 탈퇴는 계정/개인정보의 영구 삭제가 아닙니다. 개인정보 삭제 요청 대응 정책을 별도로 정해야 합니다.
- Vercel/Supabase 무료 요금제에는 사용량/휴면 제한이 있으며 영구 무료 운영이 보장되지는 않습니다.

## 안전 주의
- `config.js`의 anon/publishable key는 공개용이지만 DB 접근은 RLS 정책이 보호해야 합니다. 운영 전 정책 검증은 필수입니다.
- GitHub Public 저장소에는 비밀번호, `service_role` 키, 실제 공대원 연락처, 백업 데이터 등을 올리지 마세요.
- 현재 코드/SQL은 배포 준비용이며 실제 서비스 계정과 연결한 종단 간 테스트는 아직 진행하지 않았습니다.
