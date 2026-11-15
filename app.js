import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const root = document.getElementById('root');
const config = window.MIRAE_CONFIG || {};
const RAIDS = ['혼테일', '카쿰 1공대', '카쿰 2공대'];
const state = {
  db: null, session: null, user: null, profile: null, memberships: [],
  profiles: [], attendance: [], completed: [], page: 'home', raid: '혼테일',
  date: new Date().toLocaleDateString('en-CA')
};
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[ch]);
const isAdmin = () => state.profile?.role === 'admin';
const allowedRaids = () => isAdmin() ? RAIDS : state.memberships.map(row => row.raid).filter(r => RAIDS.includes(r));
const options = (items, selected) => items.map(item => `<option value="${escapeHtml(item)}" ${item === selected ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('');
const formatDate = value => new Date(`${value}T12:00:00`).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
const timeBounds = () => state.raid === '혼테일' ? ['22:40', '23:00'] : ['20:40', '21:00'];
function timeOptions() {
  const [start, end] = timeBounds();
  let minute = Number(start.slice(0, 2)) * 60 + Number(start.slice(3));
  const last = Number(end.slice(0, 2)) * 60 + Number(end.slice(3));
  const result = ['<option value="">미정</option>'];
  for (; minute <= last; minute++) {
    const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    result.push(`<option value="${time}">${time}</option>`);
  }
  return result.join('');
}
function notice(message, isError = false) {
  const target = document.getElementById('message');
  if (!target) { alert(message); return; }
  target.textContent = message;
  target.className = isError ? 'error' : 'notice';
}
function showError(err) { notice(err?.message || String(err), true); }
function setContent(html) { document.getElementById('content').innerHTML = html; }

async function init() {
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    root.innerHTML = '<div class="card auth"><h2>Supabase 연결 설정이 없습니다.</h2><p>config.js의 프로젝트 URL과 공개 키를 확인하세요.</p></div>';
    return;
  }
  state.db = createClient(config.supabaseUrl, config.supabaseAnonKey);
  const { data, error: sessionError } = await state.db.auth.getSession();
  if (sessionError) throw sessionError;
  state.session = data.session;
  await load();
  state.db.auth.onAuthStateChange((_event, nextSession) => {
    state.session = nextSession;
    setTimeout(() => load().catch(showError), 0);
  });
}
async function load() {
  if (!state.session) {
    state.user = null; state.profile = null; state.memberships = [];
    authView();
    return;
  }
  state.user = state.session.user;
  const profileResult = await state.db.from('profiles').select('*').eq('id', state.user.id).single();
  if (profileResult.error) { showError(profileResult.error); return; }
  state.profile = profileResult.data;
  const memberResult = await state.db.from('memberships').select('*').eq('user_id', state.user.id);
  if (memberResult.error) { showError(memberResult.error); return; }
  state.memberships = memberResult.data || [];
  if (['pending', 'withdrawn'].includes(state.profile.role)) { pendingView(); return; }
  const allowed = allowedRaids();
  if (!allowed.includes(state.raid)) state.raid = allowed[0] || '혼테일';
  await refresh();
  render();
}
async function refresh() {
  const allowed = allowedRaids();
  if (!allowed.length) { state.profiles = []; state.attendance = []; state.completed = []; return; }
  const [profilesResult, attendanceResult, completedResult] = await Promise.all([
    state.db.from('profiles').select('id,nickname,role,level,job,damage,created_at').order('nickname'),
    state.db.from('attendance').select('*').in('raid', allowed).order('raid_date', { ascending: false }).limit(1000),
    state.db.from('completed_raids').select('*').in('raid', allowed).order('raid_date', { ascending: false }).limit(100)
  ]);
  const queryError = profilesResult.error || attendanceResult.error || completedResult.error;
  if (queryError) showError(queryError);
  state.profiles = profilesResult.data || [];
  state.attendance = attendanceResult.data || [];
  state.completed = completedResult.data || [];
}
function authView(mode = 'login') {
  root.innerHTML = `<div class="card auth"><h1>미래공대</h1><p class="muted">공대원 관리 · 정식 회원 인증</p>
    <div class="row"><button class="${mode === 'login' ? '' : 'secondary'}" id="loginTab">로그인</button><button class="${mode === 'signup' ? '' : 'secondary'}" id="signupTab">회원가입</button></div>
    <form id="authForm"><label>이메일<input type="email" name="email" required autocomplete="email"></label>
    <label>비밀번호 (6자 이상)<input type="password" name="password" minlength="6" required autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></label>
    ${mode === 'signup' ? '<label>게임 닉네임<input name="nickname" minlength="2" maxlength="20" required></label>' : ''}
    <button>${mode === 'signup' ? '가입 신청' : '로그인'}</button></form><div id="message"></div>
    <p class="muted">${mode === 'signup' ? '가입 후 공대장 승인이 필요합니다. 이메일 인증 설정에 따라 확인 메일이 발송됩니다.' : '비밀번호 분실 시 관리자에게 문의하세요.'}</p></div>`;
  document.getElementById('loginTab').onclick = () => authView('login');
  document.getElementById('signupTab').onclick = () => authView('signup');
  document.getElementById('authForm').onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = form.get('email');
    const password = form.get('password');
    const result = mode === 'signup'
      ? await state.db.auth.signUp({ email, password, options: { data: { nickname: form.get('nickname') } } })
      : await state.db.auth.signInWithPassword({ email, password });
    if (result.error) showError(result.error);
    else notice(mode === 'signup' ? '가입 신청이 접수되었습니다. 이메일 인증 후 로그인하세요.' : '로그인 성공');
  };
}
function pendingView() {
  root.innerHTML = `<div class="card auth"><h1>미래공대</h1><p>${escapeHtml(state.profile.nickname)} 님</p>
    <div class="notice">${state.profile.role === 'withdrawn' ? '탈퇴 처리된 계정입니다. 다시 이용하려면 공대장에게 문의하세요.' : '공대장 가입 승인을 기다리고 있습니다.'}</div>
    <button id="logout">로그아웃</button> <button id="reload" class="secondary">승인 상태 새로고침</button><div id="message"></div></div>`;
  document.getElementById('logout').onclick = () => state.db.auth.signOut();
  document.getElementById('reload').onclick = () => load().catch(showError);
}
function render() {
  const nav = [['home', '대시보드'], ['members', '공대원 명단'], ['attendance', '날짜별 참여'], ['completed', '트라이 완료 기록']];
  if (isAdmin()) nav.push(['admin', '가입 승인 · 탈퇴 관리']);
  root.innerHTML = `<div class="shell"><aside class="side"><div class="brand">미래공대<small>공대원 관리 시스템</small></div>
    ${nav.map(([id, title]) => `<button class="nav ${state.page === id ? 'active' : ''}" data-page="${id}">${title}</button>`).join('')}
    <div style="margin:25px 10px;color:#b9d4ef;font-size:13px">${escapeHtml(state.profile.nickname)} · ${isAdmin() ? '공대장' : '공대원'}</div>
    <button class="nav" id="logout">로그아웃</button></aside><main class="main"><div class="row space"><div>
    <h1>${escapeHtml(nav.find(([id]) => id === state.page)?.[1] || '대시보드')}</h1><div class="muted">공대별 접근 권한 및 서버 저장 적용</div>
    </div><button class="outline" id="reload">새로고침</button></div><div id="message"></div><div id="content"></div></main></div>`;
  document.querySelectorAll('[data-page]').forEach(button => {
    button.onclick = () => { state.page = button.dataset.page; render(); };
  });
  document.getElementById('logout').onclick = () => state.db.auth.signOut();
  document.getElementById('reload').onclick = async () => { await load(); notice('최신 데이터로 갱신했습니다.'); };
  const pages = { home, members, attendance: attendancePage, completed: completedPage, admin: adminPage };
  (pages[state.page] || home)();
}
function raidPicker() {
  return `<div class="row"><label>공대<select id="raid">${options(allowedRaids(), state.raid)}</select></label>
    <label>날짜<input id="day" type="date" value="${escapeHtml(state.date)}"></label>
    <button class="secondary" id="apply">조회</button></div>`;
}
function wirePicker() {
  document.getElementById('apply').onclick = () => {
    state.raid = document.getElementById('raid').value;
    state.date = document.getElementById('day').value;
    render();
  };
}
function home() {
  const today = state.attendance.filter(row => row.raid === state.raid && row.raid_date === state.date);
  const present = today.filter(row => row.status === '참여' || row.substitute_status === '구인완료').length;
  setContent(`<div class="card"><h2>공대 운영 현황</h2>${raidPicker()}
    <p class="muted">혼테일: 일·월·화·수 23:00 / 카쿰 1공대: 금 21:00 / 카쿰 2공대: 토 21:00</p>
    <div class="grid"><div class="stat">실제 참여 예정<strong>${present}명</strong></div>
    <div class="stat">참여 체크 기록<strong>${today.length}건</strong></div>
    <div class="stat">완료된 트라이<strong>${state.completed.filter(row => row.raid === state.raid).length}회</strong></div></div></div>
    <div class="card"><h2>안내</h2>공대원 탈퇴는 관리자 메뉴에서 처리합니다. 탈퇴하더라도 완료된 트라이 기록은 유지됩니다.</div>`);
  wirePicker();
}
function members() {
  const active = state.profiles.filter(person => ['member', 'admin'].includes(person.role));
  setContent(`<div class="card"><h2>공대원 명단</h2>${raidPicker()}
    <div class="tablewrap"><table><thead><tr><th>닉네임</th><th>직업</th><th>레벨</th><th>스공</th></tr></thead>
    <tbody>${active.map(person => `<tr><td>${escapeHtml(person.nickname)}</td><td>${escapeHtml(person.job || '-')}</td><td>${escapeHtml(person.level || '-')}</td><td>${escapeHtml(person.damage || '-')}</td></tr>`).join('')}</tbody></table></div></div>`);
  wirePicker();
}
function attendancePage() {
  const finished = state.completed.find(row => row.raid === state.raid && row.raid_date === state.date);
  const rows = state.attendance.filter(row => row.raid === state.raid && row.raid_date === state.date);
  const roster = state.profiles.filter(person => ['member', 'admin'].includes(person.role));
  const mine = rows.find(row => row.user_id === state.user.id);
  const adminTable = isAdmin() ? `<div class="card"><h2>공대장 참여 · 대타 관리</h2><div class="tablewrap"><table>
    <tr><th>닉네임</th><th>참여</th><th>대타</th><th>대타 닉네임</th><th>관리</th></tr>
    ${roster.map(person => {
      const entry = rows.find(row => row.user_id === person.id);
      return `<tr><td>${escapeHtml(person.nickname)}</td>
        <td><select id="s-${person.id}">${options(['참여', '미참여'], entry?.status || '미참여')}</select></td>
        <td><select id="sub-${person.id}">${options(['없음', '미구인', '구인완료'], entry?.substitute_status || '없음')}</select></td>
        <td><input id="name-${person.id}" value="${escapeHtml(entry?.substitute_nickname || '')}" placeholder="대타 닉네임"></td>
        <td><button data-save="${person.id}" ${finished ? 'disabled' : ''}>저장</button></td></tr>`;
    }).join('')}</table></div><div class="row"><button id="complete" ${finished ? 'disabled' : ''}>트라이 완료 처리</button>
    ${finished ? '<button id="reopen" class="danger">완료 취소</button>' : ''}</div></div>` : '';
  setContent(`<div class="card"><h2>날짜별 참여 체크</h2>${raidPicker()}
    <p class="muted">${formatDate(state.date)} · 완료 여부: ${finished ? '완료 및 수정 잠금' : '진행 중'}</p>
    <div class="grid"><div class="stat">실제 참여<strong>${rows.filter(row => row.status === '참여' || row.substitute_status === '구인완료').length}명</strong></div>
    <div class="stat">대타 구인완료<strong>${rows.filter(row => row.substitute_status === '구인완료').length}명</strong></div></div></div>
    <div class="card"><h2>내 참여 기록</h2><form id="myForm" class="grid">
    <label>참여 여부<select name="status">${options(['참여', '미참여'], mine?.status || '참여')}</select></label>
    <label>접속 시간<select name="login_time">${timeOptions()}</select></label>
    <label>부캐릭 청구 닉네임<input name="claim" maxlength="30" value="${escapeHtml(mine?.claim_nickname || '')}"></label>
    <button ${finished ? 'disabled' : ''}>내 참여 저장</button></form>
    <p class="muted">대타 구인 상태와 대타 닉네임은 공대장이 변경합니다.</p></div>${adminTable}`);
  wirePicker();
  if (mine?.login_time) document.querySelector('[name="login_time"]').value = mine.login_time.slice(0, 5);
  document.getElementById('myForm').onsubmit = async event => {
    event.preventDefault();
    if (finished) return notice('완료된 트라이는 수정할 수 없습니다.', true);
    const form = new FormData(event.currentTarget);
    const loginTime = form.get('login_time');
    if (loginTime) {
      const [start, end] = timeBounds();
      if (loginTime < start || loginTime > end) return notice('접속시간 범위를 확인하세요.', true);
    }
    const payload = {
      user_id: state.user.id, raid: state.raid, raid_date: state.date,
      status: form.get('status'), login_time: loginTime || null,
      claim_nickname: form.get('claim') || null,
      substitute_status: mine?.substitute_status || '없음',
      substitute_nickname: mine?.substitute_nickname || null
    };
    const { error: saveError } = await state.db.from('attendance').upsert(payload, { onConflict: 'user_id,raid,raid_date' });
    if (saveError) showError(saveError);
    else { await refresh(); render(); notice('참여 기록이 저장되었습니다.'); }
  };
  if (!isAdmin()) return;
  document.querySelectorAll('[data-save]').forEach(button => {
    button.onclick = async () => {
      const memberId = button.dataset.save;
      const previous = rows.find(row => row.user_id === memberId);
      const substituteStatus = document.getElementById(`sub-${memberId}`).value;
      const substituteName = document.getElementById(`name-${memberId}`).value.trim();
      if (substituteStatus === '구인완료' && !substituteName) return notice('대타 닉네임을 입력하세요.', true);
      const { error: saveError } = await state.db.rpc('admin_set_attendance', {
        p_user: memberId, p_raid: state.raid, p_date: state.date,
        p_status: document.getElementById(`s-${memberId}`).value,
        p_login: previous?.login_time || null, p_claim: previous?.claim_nickname || null,
        p_sub_status: substituteStatus, p_sub_name: substituteName || null
      });
      if (saveError) showError(saveError);
      else { await refresh(); render(); notice('관리자 변경사항 저장 완료'); }
    };
  });
  document.getElementById('complete').onclick = async () => {
    if (!confirm(`${state.raid} ${state.date} 트라이를 완료 처리할까요?`)) return;
    const { error: completeError } = await state.db.rpc('admin_complete_raid', { p_raid: state.raid, p_date: state.date });
    if (completeError) showError(completeError);
    else { await refresh(); render(); notice('완료 기록이 저장되고 참여 수정이 잠겼습니다.'); }
  };
  if (finished) document.getElementById('reopen').onclick = async () => {
    if (!confirm('완료 기록을 취소하고 수정 가능 상태로 되돌릴까요?')) return;
    const { error: reopenError } = await state.db.rpc('admin_reopen_raid', { p_raid: state.raid, p_date: state.date });
    if (reopenError) showError(reopenError);
    else { await refresh(); render(); }
  };
}
function completedPage() {
  const cards = state.completed.filter(row => row.raid === state.raid).map(record => `<div class="card">
    <h3>${formatDate(record.raid_date)} · ${escapeHtml(record.raid)}</h3><div class="tablewrap"><table>
    <tr><th>원 공대원</th><th>참여</th><th>대타 닉네임</th><th>부캐릭 청구 닉네임</th></tr>
    ${(record.snapshot || []).map(person => `<tr><td>${escapeHtml(person.nickname)}</td>
      <td>${escapeHtml(person.substitute_status === '구인완료' && person.status !== '참여' ? '대타 참여' : '본인 참여')}</td>
      <td>${escapeHtml(person.substitute_nickname || '-')}</td><td>${escapeHtml(person.claim_nickname || '-')}</td></tr>`).join('')}
    </table></div></div>`).join('');
  setContent(`<div class="card"><h2>트라이 완료 기록</h2>${raidPicker()}
    ${cards || '<p class="muted">아직 완료된 트라이가 없습니다.</p>'}</div>`);
  wirePicker();
}
async function adminPage() {
  if (!isAdmin()) { state.page = 'home'; render(); return; }
  const [profileResult, membershipResult] = await Promise.all([
    state.db.from('profiles').select('*').order('created_at', { ascending: false }),
    state.db.from('memberships').select('*')
  ]);
  if (profileResult.error || membershipResult.error) { showError(profileResult.error || membershipResult.error); return; }
  const people = profileResult.data || [];
  const allMemberships = membershipResult.data || [];
  setContent(`<div class="card"><h2>가입 승인 · 공대원 탈퇴</h2>
    <p class="muted">탈퇴는 로그인 권한을 즉시 차단하고 소속 공대를 해제합니다. 과거 트라이 완료 기록은 보존됩니다.</p>
    <div class="tablewrap"><table><tr><th>닉네임</th><th>상태</th><th>소속 공대</th><th>관리</th></tr>
    ${people.map(person => `<tr><td>${escapeHtml(person.nickname)}</td><td>${escapeHtml(person.role)}</td>
      <td>${RAIDS.map(raidName => `<label style="display:inline-flex;margin:3px">
        <input type="checkbox" data-raid="${person.id}" value="${escapeHtml(raidName)}"
        ${allMemberships.some(row => row.user_id === person.id && row.raid === raidName) ? 'checked' : ''}>${escapeHtml(raidName)}</label>`).join('')}</td>
      <td>${person.role === 'admin' ? '<span class="pill">관리자</span>' : `<div class="row">
        <button data-approve="${person.id}">승인·변경</button>
        ${person.role === 'member' ? `<button class="danger" data-withdraw="${person.id}">공대 탈퇴</button>` : ''}
        ${person.role === 'withdrawn' ? `<button class="secondary" data-pending="${person.id}">재가입 대기</button>` : ''}
        </div>`}</td></tr>`).join('')}</table></div></div>`);
  document.querySelectorAll('[data-approve]').forEach(button => {
    button.onclick = async () => {
      const memberId = button.dataset.approve;
      const selected = [...document.querySelectorAll(`[data-raid="${memberId}"]:checked`)].map(input => input.value);
      if (!selected.length) return notice('소속 공대를 하나 이상 선택하세요.', true);
      const { error: approveError } = await state.db.rpc('admin_set_member', { p_user: memberId, p_role: 'member', p_raids: selected });
      if (approveError) showError(approveError);
      else { await adminPage(); notice('승인 및 공대 배정 완료'); }
    };
  });
  document.querySelectorAll('[data-withdraw]').forEach(button => {
    button.onclick = async () => {
      const memberId = button.dataset.withdraw;
      const person = people.find(row => row.id === memberId);
      if (!confirm(`${person.nickname} 공대원을 탈퇴 처리할까요?\n이후 사이트 이용이 차단되며 과거 완료 기록은 보존됩니다.`)) return;
      const { error: withdrawError } = await state.db.rpc('admin_set_member', { p_user: memberId, p_role: 'withdrawn', p_raids: [] });
      if (withdrawError) showError(withdrawError);
      else { await adminPage(); notice('탈퇴 처리 완료'); }
    };
  });
  document.querySelectorAll('[data-pending]').forEach(button => {
    button.onclick = async () => {
      const { error: pendingError } = await state.db.rpc('admin_set_member', { p_user: button.dataset.pending, p_role: 'pending', p_raids: [] });
      if (pendingError) showError(pendingError);
      else { await adminPage(); notice('재가입 대기로 변경했습니다.'); }
    };
  });
}
init().catch(err => {
  console.error(err);
  root.innerHTML = `<div class="card auth"><h2>사이트 연결 오류</h2><p class="error">${escapeHtml(err?.message || String(err))}</p></div>`;
});
