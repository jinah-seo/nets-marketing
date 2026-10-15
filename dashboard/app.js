/* NETS 마케팅 대시보드 v0.7 — 노션형 레이아웃 (업무+캘린더 통합)
 * 데이터: data/config.json · posts.json · tasks.json · metrics.json · budget.json · meetings.json (server.js 가 읽고 씀)
 * - 화면에서 바꾼 내용은 해당 JSON 파일 전체를 다시 저장한다.
 * - 저장할 때 파일 버전을 보내, 대시보드 밖(Claude Code 등)에서 고친 파일은 덮어쓰지 않는다.
 * - 페이지는 JS로 그린다. 항목을 누르면 오른쪽 상세 패널(peek)에서 모든 필드를 고치고 지울 수 있다.
 */
(function () {
  'use strict';
  const S = { config: null, posts: [], tasks: [], metrics: [], budget: null, meetings: { series: [], meetings: [] } };
  const ui = {
    page: 'week', taskView: 'table', area: '전체', kind: '전체', status: '전체', owner: '전체', q: '',
    expanded: new Set(), collapsed: new Set(), keep: new Set(), pillar: '전체', pstatus: '전체',
    calMonth: null, calProd: true, calPosts: true, calShowTasks: true, calHidden: false, calOpenDays: new Set(), peek: null, fresh: null,
    editing: null, freshPost: null, // editing: 표 칸에서 바로 이름을 입력 중인 항목 { type: 'task'|'post', id }
    rp: { period: 'thisWeek', group: 'area', area: '전체', from: null, to: null }, rpOpen: new Set(), byear: null, pchannel: '전체 채널',
    mtype: '전체', mperiod: '다가오는 회의', mq: ''
  };
  let dragTask = null; // 업무 표에서 끌고 있는 업무 ID
  let online = false;
  const KINDS = ['업무', '마일스톤', '확인'];
  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const $ = id => document.getElementById(id);

  /* ---------- helpers ---------- */
  function el(tag, attrs, kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'text') e.textContent = v;
      else if (k === 'cls') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    (kids || []).forEach(c => { if (c == null || c === false) return; e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const P = s => new Date(s + 'T00:00:00');
  const TODAY = ymd(new Date());
  const diff = (a, b) => Math.round((P(b) - P(a)) / 86400000);
  const addDays = (s, n) => { const d = P(s); d.setDate(d.getDate() + n); return ymd(d); };
  const md = s => { if (!s) return '—'; const d = P(s); return (d.getMonth() + 1) + '/' + d.getDate() + ' (' + DAYS[d.getDay()] + ')'; };
  const mdShort = s => { const d = P(s); return (d.getMonth() + 1) + '/' + d.getDate(); };
  const weekStart = s => { const d = P(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };
  const num = v => (v === '' || v == null || !Number.isFinite(Number(v))) ? null : Number(v);
  const rate = (e, b) => { e = num(e); b = num(b); return (e == null || !b) ? null : e / b; };
  const pct = r => r == null ? '—' : (r * 100).toFixed(1) + '%';
  const pad2 = n => String(n).padStart(2, '0');
  const lc = s => String(s || '').toLowerCase();
  const cfg = k => (S.config && S.config[k]) || [];
  const isPostDone = p => p.status === '게시완료';
  const isPostDrop = p => p.status === '대체·보류';
  const isTaskDone = t => t.status === '완료';
  const isTaskOff = t => t.status === '보류';
  // 제작·승인 요청 마감: 월·화 게시물은 직전 금요일, 수~금 게시물은 그 주 월요일 (승인 대기 24시간 확보)
  const prodDeadline = p => { const d = P(p.date).getDay(); return (d === 1 || d === 2) ? addDays(weekStart(p.date), -3) : weekStart(p.date); };
  const prodDone = p => ['승인대기', '예약완료', '게시완료'].includes(p.status);
  // SNS 채널: 게시물마다 채널별로 게시 여부(on)·게시 완료(done)·링크(url)·성과를 따로 둔다 (posts.json의 li·fb)
  const CHANNELS = [{ k: 'li', label: 'LinkedIn', short: 'LI', color: 'var(--li)', src: 'linkedin' }, { k: 'fb', label: 'Facebook', short: 'FB', color: 'var(--fb)', src: 'facebook' }];
  const chOn = (p, k) => (p[k] || {}).on !== false;
  const chDone = (p, k) => !!(p[k] || {}).done;
  const chOf = label => CHANNELS.find(c => c.label === label);
  // 쓰는 채널이 모두 게시 완료면 상태도 게시완료, 하나라도 풀리면 예약완료로
  function syncPostStatus(p) {
    const ons = CHANNELS.filter(c => chOn(p, c.k));
    if (ons.length && ons.every(c => chDone(p, c.k))) p.status = '게시완료';
    else if (p.status === '게시완료') p.status = '예약완료';
  }
  // 채널 칩: 누르면 그 채널 게시 완료 ↔ 예정. 이 채널에 안 올리는 게시물은 흐린 칩(상세에서 켬)
  function chChips(p, idp) {
    return el('span', { cls: 'chs' }, CHANNELS.map(C => {
      const on = chOn(p, C.k), done = chDone(p, C.k);
      return el('button', { type: 'button', id: idp + '-ch-' + C.k + '-' + p.id, cls: 'ch ch-' + C.k + (on ? '' : ' off') + (done ? ' done' : ''), disabled: !online || !on,
        title: C.label + (on ? (done ? ' · 게시 완료 (누르면 취소)' : ' · 게시 예정 (누르면 게시 완료)') : ' · 이 채널에는 올리지 않음 (상세에서 켤 수 있음)'),
        'aria-pressed': on ? String(done) : null, text: (done ? '✓ ' : '') + C.short, onclick: e => { e.stopPropagation(); setChannel(p, C.k, 'done', !done); } });
    }));
  }
  function setChannel(p, k, field, v) { p[k] = p[k] || {}; p[k][field] = v; syncPostStatus(p); commit('posts', true); }
  // 상태를 게시완료로 바꾸면 쓰는 채널을 모두 게시 완료로
  function setPostStatus(p, v) {
    p.status = v;
    if (v === '게시완료') CHANNELS.forEach(c => { if (chOn(p, c.k)) { p[c.k] = p[c.k] || {}; p[c.k].done = true; } });
    commit('posts', true);
  }
  const consentDays = () => (S.config && S.config.rules && num(S.config.rules.consentLeadDays)) || 14;
  const eventLabel = id => (cfg('events').find(e => e.id === id) || {}).label || id;
  const taskById = id => S.tasks.find(t => t.id === id);
  const postById = id => S.posts.find(p => p.id === id);
  // 하위 항목 순서: 끌어서(또는 ↑↓) 정한 order. 날짜가 바뀌어도 자리는 그대로. order가 없는 항목만 맨 아래에 마감순
  const childrenOf = id => S.tasks.filter(c => c.parent === id).sort((a, b) => {
    const oa = num(a.order), ob = num(b.order);
    return (oa == null ? 1e9 : oa) - (ob == null ? 1e9 : ob) || (a.due || '9').localeCompare(b.due || '9');
  });

  /* ---------- tag colors (노션 팔레트) ---------- */
  const TAGS = {
    taskStatus: { '대기': 'gray', '진행': 'blue', '완료': 'green', '보류': 'brown' },
    postStatus: { '기획': 'gray', '제작중': 'yellow', '승인대기': 'orange', '예약완료': 'blue', '게시완료': 'green', '대체·보류': 'red' },
    priority: { 'P0': 'red', 'P1': 'orange', 'P2': 'gray' },
    kind: { '업무': 'default', '마일스톤': 'purple', '확인': 'yellow' },
    pillar: { '이벤트': 'orange', '인사이트': 'green', '제품': 'blue', '사례': 'pink', '회사': 'gray' },
    owner: { 'Marketing': 'blue' }
  };
  const PALETTE = ['brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red', 'gray'];
  function tagc(kind, v) {
    const m = TAGS[kind]; if (m && m[v]) return m[v];
    // 영역은 config 순서대로 서로 다른 색 (캘린더에서 영역을 색으로 구분)
    if (kind === 'area') { const i = cfg('areas').indexOf(v); if (i >= 0) return PALETTE[i % PALETTE.length]; }
    let h = 0; for (const ch of String(v)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }
  const tagEl = (v, kind) => el('span', { cls: 'tag t-' + tagc(kind, v), text: v });
  const pillarColor = v => 'var(--' + tagc('pillar', v) + ')';

  /* ---------- form controls ---------- */
  const stop = e => e.stopPropagation();
  function tagSelect(values, current, ck, onChange, o) {
    o = o || {};
    const s = el('select', { id: o.id, 'aria-label': o.label });
    const vals = [...values]; if (current && !vals.includes(current)) vals.push(current);
    if (o.empty != null) s.appendChild(el('option', { value: '', text: o.empty }));
    vals.forEach(v => { const opt = el('option', { value: v, text: v }); if (v === current) opt.selected = true; s.appendChild(opt); });
    if (!current && o.empty != null) s.value = '';
    const paint = () => { s.className = 'tag-select ' + (s.value ? 't-' + tagc(ck, s.value) : 't-empty'); };
    paint(); s.disabled = !online;
    s.addEventListener('click', stop);
    s.addEventListener('change', () => { paint(); onChange(s.value); });
    return s;
  }
  // values: [{value,label}] 또는 문자열
  function plainSelect(values, current, onChange, o) {
    o = o || {};
    const s = el('select', { id: o.id, cls: o.cls || 'pselect', 'aria-label': o.label });
    values.forEach(v => { const val = typeof v === 'object' ? v.value : v; const o2 = el('option', { value: val, text: typeof v === 'object' ? v.label : v }); if (val === (current == null ? '' : current)) o2.selected = true; s.appendChild(o2); });
    s.disabled = !online;
    s.addEventListener('click', stop);
    s.addEventListener('change', () => onChange(s.value));
    return s;
  }
  function autosize(t) { const f = () => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }; t.addEventListener('input', f); requestAnimationFrame(f); }
  function textIn(value, onSet, o) {
    o = o || {};
    const i = el(o.multi ? 'textarea' : 'input', { type: o.multi ? null : 'text', id: o.id, cls: o.cls || 'pinput', placeholder: o.ph || '', 'aria-label': o.label, rows: o.multi ? (o.rows || 1) : null });
    i.value = value == null ? '' : value; i.disabled = !online;
    if (o.multi) autosize(i);
    i.addEventListener('click', stop);
    i.addEventListener('keydown', e => { if (e.key === 'Enter' && (!o.multi || o.enterCommits) && !e.isComposing) { e.preventDefault(); i.blur(); } });
    i.addEventListener('change', () => onSet(o.raw ? i.value : i.value.trim()));
    return i;
  }
  // 타이핑한 날짜 읽기: 11/24 · 11.24 · 1124 · 11월 24일 · 2026-11-24 · 26.11.24 · 24(이번 달) · 오늘 · 내일 · 모레 · +3 · -2 · +1주
  // 연도를 안 쓰면 올해, 그 날짜가 반년 넘게 지났으면 내년. 못 읽으면 null, 비우면 ''
  function parseDateText(s, base) {
    s = String(s || '').trim().replace(/\s*\([^)]*\)\s*$/, '');
    if (!s) return '';
    const rel = { '오늘': 0, '내일': 1, '모레': 2, '어제': -1 }; if (s in rel) return addDays(TODAY, rel[s]);
    let m = s.match(/^([+-])\s*(\d{1,3})\s*(일|주)?$/); if (m) return addDays(TODAY, (m[1] === '-' ? -1 : 1) * Number(m[2]) * (m[3] === '주' ? 7 : 1));
    let y = null, mo, d;
    if ((m = s.match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?$/) || s.match(/^(\d{4})(\d{2})(\d{2})$/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = s.match(/^(\d{2})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})$/))) { y = 2000 + +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = s.match(/^(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?$/) || s.match(/^(\d{2})(\d{2})$/))) { mo = +m[1]; d = +m[2]; }
    else if ((m = s.match(/^(\d{1,2})\s*일?$/))) { const b = P(base || TODAY); y = b.getFullYear(); mo = b.getMonth() + 1; d = +m[1]; }
    else return null;
    if (y == null) { y = +TODAY.slice(0, 4); if (diff(ymd(new Date(y, mo - 1, d)), TODAY) > 183) y++; }
    const dt = new Date(y, mo - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? ymd(dt) : null;
  }
  const dateShow = (v, short) => v ? (v.slice(0, 4) !== TODAY.slice(0, 4) ? v.slice(2, 4) + '. ' : '') + (short ? md(v).replace(' (', '(') : md(v)) : '';
  const dateEdit = v => v ? (v.slice(0, 4) !== TODAY.slice(0, 4) ? v : (+v.slice(5, 7)) + '/' + (+v.slice(8, 10))) : '';
  function dateIn(value, onSet, o) {
    o = o || {};
    if (o.typed) return typedDate(value, onSet, o);
    const i = el('input', { type: 'date', id: o.id, cls: o.cls || 'pinput', 'aria-label': o.label }); i.value = value || ''; i.disabled = !online;
    i.addEventListener('click', stop);
    i.addEventListener('change', () => onSet(i.value || null));
    return i;
  }
  // 표·상세의 날짜 칸: 눌러서 바로 타이핑(Enter·칸 밖 = 저장, Esc = 취소), 📅로 달력에서 고르기
  function typedDate(value, onSet, o) {
    const show = v => dateShow(v, o.short);
    const i = el('input', { type: 'text', id: o.id, cls: (o.cls || 'pinput') + ' date-typed' + (o.short ? ' short' : ''), 'aria-label': o.label, placeholder: o.ph || '날짜', autocomplete: 'off',
      title: (o.label ? o.label + ' · ' : '') + '입력 예: 11/24 · 1124 · 2026-11-24 · 오늘 · 내일 · +3 (3일 뒤) · +1주' });
    i.value = show(value); i.disabled = !online;
    const pick = el('input', { type: 'date', cls: 'date-pick', tabindex: '-1', 'aria-hidden': 'true' }); pick.value = value || '';
    const btn = el('button', { type: 'button', cls: 'date-btn', tabindex: '-1', 'aria-label': (o.label || '날짜') + ' 달력에서 고르기', title: '달력에서 고르기', text: '📅', disabled: !online,
      onclick: e => { e.stopPropagation(); try { pick.showPicker(); } catch (x) { pick.focus(); } } });
    pick.addEventListener('click', stop);
    pick.addEventListener('change', () => { if (pick.value && pick.value !== value) onSet(pick.value); });
    let cancel = false;
    i.addEventListener('click', stop);
    i.addEventListener('focus', () => { cancel = false; i.classList.remove('bad'); i.value = dateEdit(value); i.select(); });
    i.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); i.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel = true; i.blur(); }
    });
    i.addEventListener('blur', () => {
      if (!i.isConnected) return;
      const v = cancel ? (value || '') : parseDateText(i.value, value);
      if (v === null) { i.classList.add('bad'); i.value = show(value); setSave('날짜를 읽지 못했습니다: 예) 11/24, 1124, 내일, +3'); return; }
      i.value = show(v || null);
      if ((v || null) !== (value || null)) onSet(v || null);
    });
    return el('span', { cls: 'date-wrap' }, [i, btn, pick]);
  }
  function numIn(value, onSet, o) {
    o = o || {};
    const i = el('input', { type: 'number', id: o.id, cls: o.cls || 'pinput', min: o.min, max: o.max, step: o.step, 'aria-label': o.label, placeholder: o.ph || '' }); if (value != null) i.value = value; i.disabled = !online;
    i.addEventListener('click', stop);
    i.addEventListener('change', () => onSet(num(i.value)));
    return i;
  }
  function checkIn(value, onSet, o) {
    o = o || {};
    const i = el('input', { type: 'checkbox', id: o.id, 'aria-label': o.label }); i.checked = !!value; i.disabled = !online;
    i.addEventListener('click', stop);
    i.addEventListener('change', () => onSet(i.checked));
    return i;
  }
  const won = n => n == null ? '' : Math.round(n).toLocaleString('ko-KR');
  const man = n => n == null ? '—' : Math.abs(n) >= 10000 ? (n / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '만 원' : won(n) + '원';
  const parseWon = s => { const d = String(s || '').replace(/[^\d]/g, ''); return d ? Number(d) : null; };
  function moneyIn(value, onSet, o) {
    o = o || {};
    const i = el('input', { type: 'text', inputmode: 'numeric', id: o.id, cls: (o.cls || 'cell-in') + ' money', 'aria-label': o.label, placeholder: o.ph || '' });
    i.value = won(value); i.disabled = !online;
    i.addEventListener('click', stop);
    i.addEventListener('focus', () => { i.value = i.value.replace(/[^\d]/g, ''); });
    i.addEventListener('blur', () => { i.value = won(parseWon(i.value)); });
    i.addEventListener('keydown', e => { if (e.key === 'Enter') i.blur(); });
    i.addEventListener('change', () => onSet(parseWon(i.value)));
    return i;
  }

  /* ---------- load / save ---------- */
  // 파일 버전: 저장할 때 서버에 보내 대시보드 밖(Claude Code 등)에서 바뀐 파일을 덮어쓰지 않게 한다
  const versions = {};
  const fetchData = n => fetch('/api/data/' + n, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(n); versions[n] = r.headers.get('X-Version'); return r.json(); });
  async function load(notice, force) {
    if (busy() && !force) return; // 저장 대기 중에 다시 읽으면 화면에서 바꾼 내용이 사라진다
    try {
      const names = ['config', 'posts', 'tasks', 'metrics'];
      const res = await Promise.all(names.map(fetchData));
      names.forEach((n, i) => { S[n] = res[i]; });
      // budget.json은 4단계에서 추가된 선택 파일: 없으면 빈 예산으로 시작
      try { S.budget = normBudget(await fetchData('budget')); } catch (e) { S.budget = normBudget(null); delete versions.budget; }
      // meetings.json도 선택 파일 (v0.13): 없으면 빈 회의 목록으로 시작
      try { S.meetings = normMeetings(await fetchData('meetings')); } catch (e) { S.meetings = normMeetings(null); delete versions.meetings; }
      online = true;
      $('banner').hidden = !notice;
      if (notice) $('banner').textContent = notice;
      setSave('불러옴 ' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }));
    } catch (e) {
      online = false;
      $('banner').hidden = false;
      $('banner').textContent = '데이터를 불러오지 못했습니다. 프로젝트 폴더의 start.bat을 실행한 뒤 http://localhost:5173 으로 열어 주세요. (파일을 더블클릭해서 열면 저장할 수 없습니다.)';
      setSave('연결 안 됨');
    }
    renderAll();
  }
  const timers = {}, inflight = {};
  const busy = () => Object.values(timers).some(Boolean) || Object.values(inflight).some(Boolean);
  function save(name) {
    if (!online) return;
    clearTimeout(timers[name]);
    setSave('저장 중…');
    timers[name] = setTimeout(async () => {
      timers[name] = null;
      await inflight[name]; // 같은 파일 저장은 차례대로 (직전 저장의 새 버전을 받아서 보냄)
      inflight[name] = (async () => {
        try {
          const headers = { 'Content-Type': 'application/json' };
          if (versions[name]) headers['X-Base-Version'] = versions[name];
          const r = await fetch('/api/data/' + name, { method: 'PUT', headers, body: JSON.stringify(S[name]) });
          const out = await r.json().catch(() => ({}));
          if (r.status === 409) { inflight[name] = null; return conflict(name); }
          if (!r.ok) throw new Error(out.error || r.status);
          versions[name] = out.version;
          setSave('저장됨 ' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }));
        } catch (e) { setSave('저장 실패: ' + e.message); }
        finally { inflight[name] = null; }
      })();
    }, 350);
  }
  function conflict(name) {
    Object.keys(timers).forEach(k => { clearTimeout(timers[k]); timers[k] = null; });
    setSave('저장 안 됨');
    load(name + '.json이 대시보드 밖(Claude Code 등)에서 바뀌어 최신 파일을 다시 불러왔습니다. 방금 바꾼 내용은 저장되지 않았으니 한 번 더 입력해 주세요.', true);
  }
  function setSave(t) { $('savestate').textContent = t; }

  // 데이터를 고친 뒤: 저장하고, 화면을 다시 그린다. 포커스와 커서 위치는 유지한다
  function commit(files, peekToo, focusId) { [].concat(files).forEach(save); refresh(peekToo, focusId); }
  let rq = null, rqPeek = false, rqFocus = null;
  function refresh(peekToo, focusId) {
    rqPeek = rqPeek || !!peekToo; if (focusId) rqFocus = focusId;
    if (rq) return;
    rq = setTimeout(() => {
      rq = null;
      const a = document.activeElement, id = rqFocus || (a && a.id);
      let sel = null; try { if (!rqFocus && a && a.selectionStart != null) sel = [a.selectionStart, a.selectionEnd]; } catch (e) { }
      const ps = $('peek').scrollTop, y = window.scrollY;
      renderPage(); if (rqPeek) renderPeek();
      $('peek').scrollTop = ps; window.scrollTo(0, y);
      rqPeek = false; rqFocus = null;
      const n = id && $(id);
      if (n) { n.focus({ preventScroll: true }); if (sel) try { n.setSelectionRange(sel[0], sel[1]); } catch (e) { } }
    }, 0);
  }

  /* ---------- shell: sidebar · pages ---------- */
  const PAGES = [
    { id: 'week', icon: '🏠', label: '이번 주', render: renderHome, badge: () => agenda().filter(i => i.date < TODAY && !i.done).length || null },
    { id: 'tasks', icon: '📋', label: '업무', render: renderTasksPage },
    { id: 'meetings', icon: '🗓', label: '회의', render: renderMeetingsPage, badge: () => MT().filter(m => needsMinutes(m) && m.date < TODAY).length || null, badgeTitle: '회의록 미작성' },
    { id: 'report', icon: '📊', label: '보고서', render: renderReportPage },
    { id: 'metrics', icon: '📈', label: '지표', render: renderMetricsPage },
    { id: 'budget', icon: '💰', label: '예산', render: renderBudgetPage },
    { id: 'settings', icon: '⚙️', label: '설정', render: renderSettingsPage }
  ];
  const ALIAS = { sns: 'tasks', calendar: 'tasks', export: 'week' }; // #export: v0.9부터 페이지 대신 각 페이지의 내보내기 창 // 예전 주소(#sns, #calendar) 즐겨찾기도 열리게 (v0.7에서 캘린더를 업무 페이지로 합침)
  const pageOf = h => { h = ALIAS[h] || h; return PAGES.some(p => p.id === h) ? h : null; };
  // 주소: #tasks/행사 처럼 영역 탭까지 담는다
  const parseHash = s => { s = String(s || ''); const i = s.indexOf('/'); let a = i < 0 ? '' : s.slice(i + 1); try { a = decodeURIComponent(a); } catch (e) { } return { page: pageOf(i < 0 ? s : s.slice(0, i)), area: a || '전체' }; };
  const curHash = () => ui.page + (ui.page === 'tasks' && ui.area !== '전체' ? '/' + encodeURIComponent(ui.area) : '');
  // area: 업무 페이지를 열 때 영역 탭 (없으면 전체)
  function go(page, area) {
    ui.page = page; ui.keep.clear();
    if (page === 'tasks') ui.area = area || '전체';
    $('app').classList.remove('side-open');
    if (ui.peek) closePeek(true);
    renderPage(); window.scrollTo(0, 0);
  }
  function renderNav() {
    const n = $('nav'); n.textContent = '';
    PAGES.forEach(pg => {
      const b = S.config && pg.badge ? pg.badge() : null;
      const cur = ui.page === pg.id && !(pg.id === 'tasks' && ui.area !== '전체');
      n.appendChild(el('button', { type: 'button', cls: 'nav-item', 'aria-current': cur ? 'page' : null, onclick: () => go(pg.id) },
        [el('span', { cls: 'nav-ic', 'aria-hidden': 'true', text: pg.icon }), pg.label, b ? el('span', { cls: 'nav-n', title: pg.badgeTitle || '늦어진 일', text: String(b) }) : null]));
      // 업무 아래에 영역(대분류) 탭: 남은 일 수, 늦은 일은 붉은 배지
      if (pg.id === 'tasks' && S.config) {
        const sub = el('div', { cls: 'nav-sub', role: 'group', 'aria-label': '업무 영역' });
        cfg('areas').forEach(a => {
          const open = S.tasks.filter(t => t.area === a && !isTaskDone(t) && !isTaskOff(t));
          const lt = open.filter(t => t.due && t.due < TODAY).length;
          sub.appendChild(el('button', { type: 'button', cls: 'nav-item nav-area', title: a + ' · 남은 일 ' + open.length + '건' + (lt ? ' · 늦음 ' + lt + '건' : ''), 'aria-current': ui.page === 'tasks' && ui.area === a ? 'page' : null, onclick: () => go('tasks', a) },
            [el('span', { cls: 'sw', 'aria-hidden': 'true', style: 'background:var(--' + tagc('area', a) + ')' }), el('span', { cls: 'nav-l', text: a }),
              lt ? el('span', { cls: 'nav-n', title: '늦어진 일', text: String(lt) }) : el('span', { cls: 'nav-c', text: open.length ? String(open.length) : '' })]));
        });
        n.appendChild(sub);
      }
    });
    const se = $('side-events'); se.textContent = '';
    cfg('events').forEach(e => {
      const d = diff(TODAY, e.start);
      const t = d > 0 ? 'D-' + d : diff(TODAY, e.end) >= 0 ? '진행 중' : '종료';
      se.appendChild(el('button', { type: 'button', cls: 'side-ev', title: e.note || '', onclick: () => { ui.calMonth = e.start.slice(0, 7); ui.calHidden = false; go('tasks'); } },
        [el('b', {}, [e.label, el('span', { text: t })]), el('small', { text: md(e.start) + (e.end !== e.start ? ' ~ ' + md(e.end) : '') })]));
    });
    const next = S.posts.filter(p => p.date >= TODAY && !isPostDone(p) && !isPostDrop(p)).sort((a, b) => a.date.localeCompare(b.date))[0];
    const nm = MT().filter(m => !isMeetOff(m) && m.date >= TODAY && !(m.date === TODAY && m.status === '완료')).sort(meetSort)[0];
    se.appendChild(el('button', { type: 'button', cls: 'side-ev', onclick: () => nm ? openPeek('meeting', nm.id) : go('meetings') }, [el('b', {}, ['다음 회의', el('span', { text: nm ? md(nm.date) : '—' })]), el('small', { text: nm ? (nm.time ? nm.time + ' ' : '') + meetName(nm) : '예정 없음' })]));
    se.appendChild(el('button', { type: 'button', cls: 'side-ev', onclick: () => next && openPeek('post', next.id) }, [el('b', {}, ['다음 게시', el('span', { text: next ? md(next.date) : '—' })]), el('small', { text: next ? next.topic.slice(0, 22) + (next.topic.length > 22 ? '…' : '') : '예정 없음' })]));
  }
  function renderPage() {
    const pg = PAGES.find(p => p.id === ui.page) || PAGES[0];
    const root = $('page'); root.textContent = '';
    root.classList.toggle('wide', pg.id === 'tasks'); // 업무 표는 제목을 한 줄로 길게 보이도록 화면 폭을 다 쓴다
    const areaTab = pg.id === 'tasks' && ui.area !== '전체';
    $('crumb').textContent = pg.icon + '  ' + pg.label + (areaTab ? '  /  ' + ui.area : '');
    // 주소·마지막 탭 기억 (영역 필터를 바꿔도 주소가 따라간다)
    const h = curHash();
    if (location.hash.slice(1) !== h) try { history.replaceState(null, '', '#' + h); } catch (e) { }
    try { localStorage.setItem('nets.tab', h); } catch (e) { }
    // 오른쪽 위: 이 페이지 자료 내보내기 · 이 화면 그대로 PDF(인쇄)
    const ta = $('top-acts'); ta.textContent = '';
    // 탭별 보고서: 탭마다 구성을 정해 두고 바로 발행 (보고서 페이지는 자체 「발행 ▾」이 있음)
    if (RP_PAGES.includes(pg.id)) { const rb = el('button', { type: 'button', cls: 'btn sm primary', text: '📄 보고서 ▾', title: '이 탭의 보고서를 PDF·Excel로 바로 발행 (구성은 탭마다 기억)' }); rb.addEventListener('click', () => rpMenu(rb)); ta.appendChild(rb); }
    if (pg.id !== 'settings') ta.appendChild(el('button', { type: 'button', cls: 'btn sm', text: '⤓ 내보내기', title: '이 페이지 자료를 Excel·CSV·PDF로 (필터·열 선택)', onclick: () => openExport(pg.id) }));
    ta.appendChild(el('button', { type: 'button', cls: 'btn ghost sm', text: '🖨 이 화면 PDF', title: '지금 보이는 화면을 인쇄 창으로 (대상: PDF로 저장)', onclick: () => { closeMenu(); window.print(); } }));
    renderNav();
    if (!S.config) return;
    const after = [];
    pg.render(root, after);
    after.forEach(f => f());
  }
  function renderAll() {
    renderPage();
    if (ui.peek) renderPeek();
  }
  function pageHead(icon, title, desc) {
    return el('header', { cls: 'phead' }, [el('div', { cls: 'picon', 'aria-hidden': 'true', text: icon }), el('h1', { text: title }), desc ? el('p', { cls: 'pdesc', text: desc }) : null]);
  }
  function secHead(title, right) { return el('div', { cls: 'sec-head' }, [el('h2', { text: title })].concat(right ? [].concat(right) : [])); }

  /* ---------- menu (popover) ---------- */
  let menuEl = null;
  function openMenu(anchor, items) {
    closeMenu();
    const m = el('div', { cls: 'menu', role: 'menu' });
    items.forEach(it => m.appendChild(it.sep ? el('div', { cls: 'menu-sep' }) : it.head ? el('div', { cls: 'menu-head', text: it.head })
      : el('button', { type: 'button', role: 'menuitem', text: it.label, title: it.label, onclick: () => { closeMenu(); it.run(); } })));
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect(), mr = m.getBoundingClientRect();
    let x = r.left, y = r.bottom + 4;
    if (x + mr.width > innerWidth - 8) x = Math.max(8, r.right - mr.width);
    if (y + mr.height > innerHeight - 8) y = Math.max(8, r.top - mr.height - 4);
    m.style.left = x + 'px'; m.style.top = y + 'px';
    menuEl = m;
    const f = m.querySelector('button'); if (f) f.focus();
  }
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }

  /* ---------- agenda (tasks + posts merged) ---------- */
  function agenda() {
    const items = [];
    S.tasks.forEach(t => {
      if (!t.due || isTaskOff(t)) return;
      items.push({ date: t.due, title: t.title || '제목 없음', sub: (t.parent ? t.parent + ' · ' : t.id + ' · ') + (t.owner || ''), kind: t.kind === '업무' ? (t.priority || '업무') : t.kind, ck: t.kind === '업무' ? 'priority' : 'kind', done: isTaskDone(t), ref: { type: 'task', id: t.id } });
    });
    S.posts.forEach(p => {
      if (isPostDrop(p)) return;
      items.push({ date: p.date, title: p.topic || '제목 없음', sub: '게시 · ' + p.pillar + ' · ' + p.status, kind: 'SNS 게시', ck: 'x-post', done: isPostDone(p), ref: { type: 'post', id: p.id } });
      items.push({ date: prodDeadline(p), title: '제작·승인 요청: ' + (p.topic || p.id), sub: '게시 ' + md(p.date) + (p.approval ? ' · 공개 동의 필요' : ''), kind: 'SNS 제작', ck: 'x-prod', done: prodDone(p), ref: { type: 'post', id: p.id } });
    });
    return items.sort((a, b) => a.date.localeCompare(b.date));
  }
  TAGS['x-post'] = { 'SNS 게시': 'blue' }; TAGS['x-prod'] = { 'SNS 제작': 'gray' };
  function itemRow(it, late) {
    const open = () => openPeek(it.ref.type, it.ref.id);
    return el('div', { cls: 'item' + (late ? ' late' : '') + (it.done ? ' done' : ''), role: 'button', tabindex: 0, onclick: open, onkeydown: e => { if (e.key === 'Enter') open(); } }, [
      el('div', { cls: 'd', text: md(it.date) }),
      el('div', { cls: 't' }, [it.title, el('small', { text: it.sub })]),
      tagEl(it.kind, it.ck)
    ]);
  }

  /* ---------- 이번 주 ---------- */
  function kpi(label, value, sub, tone) {
    return el('div', { cls: 'kpi' + (tone ? ' ' + tone : '') }, [el('div', { cls: 'label', text: label }), el('div', { cls: 'v', text: value }), el('div', { cls: 's', text: sub })]);
  }
  function renderHome(root, after) {
    root.appendChild(pageHead('🏠', '이번 주', md(TODAY) + ' 기준 · 업무 마감, SNS 게시·제작 마감, 회의, 행사 일정을 한곳에서 봅니다. 항목을 누르면 오른쪽에서 바로 고칠 수 있습니다.'));
    const k = el('div', { cls: 'kpis' });
    const top = S.tasks.filter(t => !t.parent && t.kind === '업무' && !isTaskOff(t));
    k.appendChild(kpi('Q4 업무 완료', top.filter(isTaskDone).length + ' / ' + top.length, 'P0 남은 ' + top.filter(t => t.priority === 'P0' && !isTaskDone(t)).length + '건'));
    const ws = weekStart(TODAY), we = addDays(ws, 6), all = agenda();
    const thisWeek = all.filter(i => i.date >= ws && i.date <= we);
    k.appendChild(kpi('이번 주 할 일', String(thisWeek.filter(i => !i.done).length), thisWeek.filter(i => i.done).length + '건 완료 · ' + mdShort(ws) + '~' + mdShort(we)));
    const late = all.filter(i => i.date < TODAY && !i.done);
    k.appendChild(kpi('늦어진 일', String(late.length), late.length ? '가장 오래된 것 ' + md(late[0].date) : '없음', late.length ? 'bad' : 'ok'));
    const active = S.posts.filter(p => !isPostDrop(p)), due = active.filter(p => p.date <= TODAY);
    const r = due.length ? due.filter(isPostDone).length / due.length : null;
    const first = active.map(p => p.date).sort()[0];
    k.appendChild(kpi('SNS 게시 이행률', r == null ? '—' : Math.round(r * 100) + '%', due.length ? '예정일 지난 ' + due.length + '건 기준' : first ? '첫 게시 ' + md(first) : '게시 계획 없음', r == null ? '' : r >= .9 ? 'ok' : r >= .7 ? 'warn' : 'bad'));
    const checks = S.tasks.filter(t => t.kind === '확인' && !isTaskDone(t) && !isTaskOff(t));
    k.appendChild(kpi('확인·결정 남음', String(checks.length), checks.length ? '다음 마감 ' + md(checks.map(c => c.due).filter(Boolean).sort()[0]) : '모두 처리', checks.some(c => c.due && c.due < TODAY) ? 'warn' : ''));
    const appr = active.filter(p => p.approval && !isPostDone(p));
    const nextAppr = appr.map(p => addDays(p.date, -consentDays())).sort()[0];
    k.appendChild(kpi('고객 공개 동의', appr.length + '건 대기', nextAppr ? '다음 요청 마감 ' + md(nextAppr) : '모두 처리', nextAppr && nextAppr <= TODAY ? 'warn' : ''));
    root.appendChild(k);

    const lg = el('div', { cls: 'legend' });
    const box = el('div', { cls: 'timeline hscroll' });
    root.appendChild(el('section', { cls: 'sec' }, [secHead('Q4 타임라인', lg), box,
      el('p', { cls: 'note', text: '◆ 행사 준비 마일스톤 · ■ 업무·확인 마감 · ● SNS 게시(필러 색) · 같은 날 몰린 항목은 아래로 쌓입니다 · 항목을 누르면 상세, 행사 막대를 누르면 업무 페이지에서 그 달 달력이 열립니다' })]));
    after.push(() => drawTimeline(box, lg));

    const end = addDays(TODAY, 13);
    // 회의·회의 할 일·회의록 정리는 목록에만 넣는다 (KPI '이번 주 할 일'·늦어진 일 배지는 업무·SNS 기준 그대로)
    const mtg = meetingAgenda(), byDate = (a, b) => a.date.localeCompare(b.date);
    const soon = all.concat(mtg).filter(i => i.date >= TODAY && i.date <= end).sort(byDate);
    late.push(...mtg.filter(i => i.date < TODAY && !i.done)); late.sort(byDate);
    const s = el('div', { cls: 'list' }), l = el('div', { cls: 'list' });
    if (!soon.length) s.appendChild(el('div', { cls: 'empty', text: '2주 안에 마감되는 항목이 없습니다.' }));
    soon.forEach(i => s.appendChild(itemRow(i, false)));
    if (!late.length) l.appendChild(el('div', { cls: 'empty', text: '늦어진 일이 없습니다.' }));
    late.forEach(i => l.appendChild(itemRow(i, true)));
    root.appendChild(el('div', { cls: 'grid2' }, [
      el('section', { cls: 'sec' }, [secHead('2주 안에 할 일', el('span', { cls: 'note', text: md(TODAY) + ' ~ ' + md(end) })), s]),
      el('section', { cls: 'sec' }, [secHead('늦어진 일', el('span', { cls: 'note', text: '마감이 지났는데 끝나지 않은 항목' })), l])
    ]));
  }

  /* ---------- timeline ---------- */
  const tip = $('tip');
  function showTip(ev, text) { tip.textContent = text; tip.hidden = false; const r = tip.getBoundingClientRect(); let x = ev.clientX + 12, y = ev.clientY + 12; if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 12; if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 12; tip.style.left = x + 'px'; tip.style.top = y + 'px'; }
  const hideTip = () => { tip.hidden = true; };
  // 줄(레인)별 간트형: 행사 / 행사별 준비 마일스톤 / 업무 마감 / 확인·결정 / SNS 게시
  // 같은 줄에서 날짜가 겹치는 항목은 아래로 쌓아 몰린 날이 보이게 한다. 채움 = 완료, 빈 칸 = 예정, 붉은 테두리 = 늦음
  const TL = { label: 116, right: 24, head: 46, row: 18, pad: 11, gap: 14 };
  function tlMarker(mk, shape, cx, cy, a) {
    if (shape === 'diamond') { const r = 6.2; return mk('path', Object.assign({ d: `M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z` }, a)); }
    if (shape === 'square') return mk('rect', Object.assign({ x: cx - 5, y: cy - 5, width: 10, height: 10, rx: 2.5 }, a));
    return mk('circle', Object.assign({ cx, cy, r: 5.5 }, a));
  }
  function tlLegend(lg) {
    lg.textContent = '';
    const NS = 'http://www.w3.org/2000/svg';
    const icon = (shape, fill, stroke) => {
      const s = document.createElementNS(NS, 'svg'); s.setAttribute('width', 14); s.setAttribute('height', 14); s.setAttribute('viewBox', '0 0 14 14'); s.setAttribute('aria-hidden', 'true');
      const mk = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); s.appendChild(e); return e; };
      tlMarker(mk, shape, 7, 7, { fill, stroke, 'stroke-width': 1.75 });
      return s;
    };
    const item = (ic, text) => el('span', {}, [ic, text]);
    lg.appendChild(item(icon('circle', 'var(--muted)', 'var(--muted)'), '완료'));
    lg.appendChild(item(icon('circle', 'var(--bg)', 'var(--muted)'), '예정'));
    lg.appendChild(item(icon('circle', 'var(--red-bg)', 'var(--bad)'), '늦음'));
    lg.appendChild(el('span', { cls: 'lg-sep', 'aria-hidden': 'true' }));
    cfg('pillars').forEach(k => lg.appendChild(el('span', {}, [el('span', { cls: 'dot', style: 'background:' + pillarColor(k) }), k])));
  }
  function drawTimeline(box, lg) {
    box.textContent = '';
    tlLegend(lg);
    const start = S.config.range.start, end = S.config.range.end;
    const W = Math.max(760, box.clientWidth || 900), x0 = TL.label, x1 = W - TL.right;
    const total = diff(start, end) + 1, dayW = (x1 - x0) / total;
    const xe = s => x0 + dayW * diff(start, s);          // 날짜 칸 왼쪽 끝
    const xc = s => xe(s) + dayW / 2;                     // 날짜 칸 가운데
    const inRange = s => s && s >= start && s <= end;
    const lateOf = (date, done) => date < TODAY && !done;

    // ---- 줄 만들기 ----
    const lanes = [{ id: 'ev', name: '행사', events: true }];
    const taskItem = (t, shape, color) => ({ date: t.due, shape, color, done: isTaskDone(t), late: lateOf(t.due, isTaskDone(t)), ref: ['task', t.id],
      tip: md(t.due) + ' · ' + t.id + (t.priority ? ' · ' + t.priority : '') + ' · ' + t.status + '\n' + (t.title || '제목 없음') });
    const live = S.tasks.filter(t => !isTaskOff(t) && inRange(t.due));
    const evIds = cfg('events').map(e => e.id);
    cfg('events').forEach(e => {
      const ms = live.filter(t => t.kind === '마일스톤' && (t.event === e.id || (taskById(t.parent) || {}).event === e.id));
      if (ms.length) lanes.push({ id: 'm-' + e.id, name: e.label.replace(/\s*\d{4}$/, '') + ' 준비', items: ms.map(t => taskItem(t, 'diamond', 'var(--purple)')) });
    });
    const otherMs = live.filter(t => t.kind === '마일스톤' && !evIds.includes(t.event) && !evIds.includes((taskById(t.parent) || {}).event));
    if (otherMs.length) lanes.push({ id: 'm-etc', name: '기타 마일스톤', items: otherMs.map(t => taskItem(t, 'diamond', 'var(--purple)')) });
    lanes.push({ id: 'task', name: '업무 마감', items: live.filter(t => t.kind === '업무').map(t => taskItem(t, 'square', 'var(--blue)')) });
    lanes.push({ id: 'check', name: '확인·결정', items: live.filter(t => t.kind === '확인').map(t => taskItem(t, 'square', 'var(--yellow)')) });
    lanes.push({ id: 'sns', name: 'SNS 게시', items: S.posts.filter(p => inRange(p.date)).map(p => ({ date: p.date, shape: 'circle', color: pillarColor(p.pillar),
      done: isPostDone(p), late: lateOf(p.date, isPostDone(p) || isPostDrop(p)), faded: isPostDrop(p), ref: ['post', p.id],
      tip: md(p.date) + ' · SNS ' + p.pillar + ' · ' + p.status + '\n' + (p.topic || '제목 없음') })) });

    // 같은 줄에서 겹치면 아래 칸으로 (몰린 날 = 높이 쌓임)
    let y = TL.head;
    lanes.forEach(L => {
      L.y = y;
      if (L.events) { L.h = 40; y += L.h; return; }
      const rows = [];
      L.items.sort((a, b) => a.date.localeCompare(b.date) || (a.done - b.done)).forEach(it => {
        const px = xc(it.date); let r = rows.findIndex(last => px - last >= TL.gap);
        if (r < 0) { r = rows.length; rows.push(px); } else rows[r] = px;
        it.x = px; it.row = r;
      });
      L.h = TL.pad * 2 + Math.max(1, rows.length) * TL.row;
      y += L.h;
    });
    const H = y + 1;

    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H);
    svg.setAttribute('role', 'group'); svg.setAttribute('aria-label', 'Q4 일정 타임라인 — 줄별 행사·마일스톤·업무·확인·SNS 게시');
    svg.setAttribute('class', 'tl');
    box.appendChild(svg); // 글자 폭을 재려면 먼저 붙여야 한다
    const mk =(t, a, parent) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); (parent || svg).appendChild(e); return e; };
    const txt = (s, a) => { const e = mk('text', a); e.textContent = s; return e; };

    // ---- 바탕: 지난 기간, 행사 띠, 주·월 눈금 ----
    if (TODAY > start) mk('rect', { x: x0, y: TL.head, width: Math.min(xe(TODAY > end ? addDays(end, 1) : TODAY), x1) - x0, height: H - TL.head, fill: 'var(--hover)' });
    cfg('events').forEach(e => {
      if (e.end < start || e.start > end) return;
      const a = xe(e.start < start ? start : e.start), b = xe(addDays(e.end > end ? end : e.end, 1));
      mk('rect', { x: a, y: TL.head, width: Math.max(3, b - a), height: H - TL.head, fill: 'var(--orange)', opacity: .09 });
    });
    const weekEvery = dayW * 7 < 44 ? 2 : 1; let wk = 0;
    for (let d = P(start); ymd(d) <= end; d.setDate(d.getDate() + 1)) {
      const s = ymd(d), first = d.getDate() === 1 || s === start;
      if (first) {
        if (s !== start) mk('line', { x1: xe(s), x2: xe(s), y1: 4, y2: H, stroke: 'var(--line-strong)' });
        txt((d.getMonth() + 1) + '월', { x: xe(s) + 6, y: 17, fill: 'var(--ink)', 'font-size': 12.5, 'font-weight': 600 });
      }
      if (d.getDay() === 1) {
        if (!first) mk('line', { x1: xe(s), x2: xe(s), y1: 26, y2: H, stroke: 'var(--line)' });
        const nearToday = TODAY >= start && TODAY <= end && Math.abs(xe(s) + 16 - xc(TODAY)) < 40;
        if (wk++ % weekEvery === 0 && xe(s) + 30 < x1 && !nearToday) txt(mdShort(s), { x: xe(s) + 4, y: 38, fill: 'var(--faint)', 'font-size': 11 });
      }
    }
    mk('line', { x1: 0, x2: W, y1: TL.head, y2: TL.head, stroke: 'var(--line-strong)' });

    // ---- 줄 이름 + 구분선 ----
    lanes.forEach((L, i) => {
      if (i) mk('line', { x1: 0, x2: W, y1: L.y, y2: L.y, stroke: 'var(--line)' });
      const ty = L.events ? L.y + L.h / 2 + 4 : L.y + TL.pad + TL.row / 2 - 1;
      txt(L.name, { x: 2, y: ty, fill: 'var(--ink)', 'font-size': 12.5, 'font-weight': 500 });
      if (!L.events) {
        const done = L.items.filter(it => it.done).length, late = L.items.filter(it => it.late).length;
        const sub = txt(done + ' / ' + L.items.length + ' 완료', { x: 2, y: ty + 15, fill: 'var(--muted)', 'font-size': 11 });
        if (late) { const ts = mk('tspan', { fill: 'var(--bad)' }, sub); ts.textContent = ' · 늦음 ' + late; }
      }
    });
    mk('line', { x1: x0, x2: x0, y1: TL.head, y2: H, stroke: 'var(--line)' });

    // ---- 행사 막대 (누르면 그 달 캘린더) ----
    // 글자는 막대 오른쪽에 두되, 다음 행사 막대나 끝에 닿으면 왼쪽으로 (앞 글자와도 겹치지 않게)
    const evLane = lanes[0];
    const evs = cfg('events').filter(e => !(e.end < start || e.start > end)).sort((p, q) => p.start.localeCompare(q.start));
    const bars = evs.map(e => [xe(e.start < start ? start : e.start), xe(addDays(e.end > end ? end : e.end, 1))]);
    let usedTo = x0;
    evs.forEach((e, i) => {
      const [a, b] = bars[i], cy = evLane.y + evLane.h / 2;
      const dd = diff(TODAY, e.start), de = diff(TODAY, e.end);
      const when = dd > 0 ? 'D-' + dd : de >= 0 ? '진행 중' : '종료';
      const g = mk('g', { class: 'tl-m', tabindex: 0, role: 'button', 'aria-label': e.label + ' ' + md(e.start) + (e.end !== e.start ? '~' + md(e.end) : '') + ' ' + when });
      mk('rect', { x: a, y: cy - 8, width: Math.max(8, b - a), height: 16, rx: 4, fill: 'var(--orange)' }, g);
      const t = mk('text', { y: cy + 4, fill: 'var(--ink)', 'font-size': 12, 'font-weight': 500 }, g);
      t.textContent = e.label; const ts = mk('tspan', { fill: 'var(--orange-fg)', 'font-weight': 600, dx: 6 }, t); ts.textContent = when;
      const tw = t.getComputedTextLength() + 6, limit = i + 1 < bars.length ? bars[i + 1][0] - 6 : x1;
      const right = b + 7 + tw <= limit || a - 7 - tw < usedTo;
      t.setAttribute('x', right ? b + 7 : a - 7); t.setAttribute('text-anchor', right ? 'start' : 'end');
      usedTo = right ? b + 7 + tw : b;
      const openCal = () => { hideTip(); ui.calMonth = e.start.slice(0, 7); ui.calHidden = false; go('tasks'); };
      g.addEventListener('click', openCal); g.addEventListener('keydown', ev => { if (ev.key === 'Enter') openCal(); });
      g.addEventListener('mousemove', ev => showTip(ev, e.label + '\n' + md(e.start) + (e.end !== e.start ? ' ~ ' + md(e.end) : '') + ' · ' + when + '\n누르면 그 달 달력')); g.addEventListener('mouseleave', hideTip);
    });

    // ---- 오늘 ----
    if (TODAY >= start && TODAY <= end) {
      const tx = xc(TODAY), px = Math.max(x0 + 19, tx);
      mk('line', { x1: tx, x2: tx, y1: 26, y2: H, stroke: 'var(--today)', 'stroke-width': 1.5 });
      mk('rect', { x: px - 19, y: 26, width: 38, height: 17, rx: 8.5, fill: 'var(--today)' });
      txt('오늘', { x: px, y: 38.5, 'text-anchor': 'middle', fill: '#fff', 'font-size': 11, 'font-weight': 600 });
    }

    // ---- 항목 ----
    lanes.forEach(L => (L.items || []).forEach(it => {
      const cy = L.y + TL.pad + TL.row * it.row + TL.row / 2;
      const a = { class: 'tl-m', tabindex: 0, role: 'button', 'aria-label': it.tip.replace('\n', ' — '),
        fill: it.late ? 'var(--red-bg)' : it.done ? it.color : 'var(--bg)', stroke: it.late ? 'var(--bad)' : it.color, 'stroke-width': it.late ? 2 : 1.75 };
      if (it.faded) a.opacity = .3;
      const m = tlMarker(mk, it.shape, it.x, cy, a);
      const open = () => { hideTip(); openPeek(it.ref[0], it.ref[1]); };
      m.addEventListener('mousemove', ev => showTip(ev, it.tip)); m.addEventListener('mouseleave', hideTip);
      m.addEventListener('click', open); m.addEventListener('keydown', ev => { if (ev.key === 'Enter') open(); });
    }));

    // ---- 마우스 위치 날짜 안내선 ----
    const guide = mk('g', { class: 'tl-guide', visibility: 'hidden', 'pointer-events': 'none' });
    const gl = mk('line', { y1: TL.head, y2: H, stroke: 'var(--muted)', 'stroke-dasharray': '2 3' }, guide);
    const gb = mk('rect', { y: TL.head - 17, height: 16, rx: 4, fill: 'var(--ink)' }, guide);
    const gt = mk('text', { y: TL.head - 5, 'text-anchor': 'middle', fill: 'var(--bg)', 'font-size': 11, 'font-weight': 500 }, guide);
    svg.addEventListener('mousemove', ev => {
      const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * W / r.width;
      if (px < x0 || px > x1) { guide.setAttribute('visibility', 'hidden'); return; }
      const s = addDays(start, Math.min(total - 1, Math.floor((px - x0) / dayW))), gx = xc(s), label = md(s);
      gl.setAttribute('x1', gx); gl.setAttribute('x2', gx); gt.setAttribute('x', gx); gt.textContent = label;
      const w = label.length * 6.6 + 12; gb.setAttribute('x', gx - w / 2); gb.setAttribute('width', w);
      guide.setAttribute('visibility', 'visible');
    });
    svg.addEventListener('mouseleave', () => guide.setAttribute('visibility', 'hidden'));
  }

  /* ---------- 업무 ---------- */
  function taskMatches(t) {
    if (ui.area !== '전체' && t.area !== ui.area) return false;
    if (ui.kind !== '전체' && t.kind !== ui.kind) return false;
    if (ui.owner !== '전체' && t.owner !== ui.owner) return false;
    if (ui.q && !lc(t.title + ' ' + t.id + ' ' + (t.note || '')).includes(lc(ui.q))) return false;
    return true;
  }
  // 방금 상태를 바꾼 항목(ui.keep)은 필터에 안 맞아도 그 자리에 남겨 둔다 (체크하자마자 사라지지 않게). 필터를 바꾸거나 페이지를 옮기면 정리
  const statusMatches = t => ui.keep.has(t.id) || (ui.status === '전체' ? true : ui.status === '미완료' ? !(isTaskDone(t) || isTaskOff(t)) : t.status === ui.status);
  function setTaskStatus(t, status) {
    ui.keep.add(t.id);
    t.status = status;
    if (status === '완료') { if (!t.doneAt) t.doneAt = TODAY; } else delete t.doneAt;
    commit('tasks', true);
  }
  function newTaskId(kind, parent) {
    const prefix = parent ? parent + '-' : kind === '확인' ? 'D-' : 'T-';
    const n = S.tasks.filter(t => t.id.startsWith(prefix) && /^\d+$/.test(t.id.slice(prefix.length))).map(t => Number(t.id.slice(prefix.length))).reduce((a, b) => Math.max(a, b), 0) + 1;
    return prefix + pad2(n);
  }
  // 새 항목은 목록 맨 아래에 생기고, 그 칸에서 바로 이름을 입력한다 (상세 패널은 열지 않음)
  // 필터 때문에 표에 안 보이는 경우에만 상세 패널로 연다. o.peek이면 처음부터 상세 패널
  function createTask(o) {
    if (!online) return;
    if (ui.peek) closePeek(true);
    const parent = o.parent ? taskById(o.parent) : null;
    const kind = o.kind || '업무';
    // 하위 항목은 마감순으로 놓이므로 기본 마감을 마지막 하위와 같게 → 맨 아래
    let due = o.due;
    if (!due && parent) { const sib = childrenOf(parent.id).filter(c => c.due); due = sib.length ? sib[sib.length - 1].due : parent.due; }
    const t = { id: newTaskId(kind, parent && parent.id), kind, title: '', area: o.area || (parent && parent.area) || (ui.area !== '전체' ? ui.area : cfg('areas')[0]), priority: o.priority || (parent && parent.priority) || 'P1', owner: o.owner || 'Marketing', start: null, due: due || addDays(TODAY, 7), status: o.status || cfg('taskStatuses')[0] || '대기' };
    if (parent) {
      t.parent = parent.id; if (parent.event) t.event = parent.event; ui.expanded.add(parent.id);
      // 하위 항목도 맨 아래 순서로 (order가 없던 하위들은 지금 보이는 순서대로 매긴 뒤)
      const sib = childrenOf(parent.id); sib.forEach((x, k) => { x.order = (k + 1) * 10; }); t.order = (sib.length + 1) * 10;
    } else {
      // 상위 업무는 그 영역 맨 아래 순서로 (order가 없던 영역은 지금 보이는 순서대로 매긴 뒤)
      const roots = S.tasks.filter(x => isRoot(x) && x.area === t.area).sort(rootSort);
      roots.forEach((x, k) => { x.order = (k + 1) * 10; });
      t.order = (roots.length + 1) * 10;
    }
    t.note = '';
    S.tasks.push(t);
    ui.fresh = t.id; ui.keep.add(t.id); ui.collapsed.delete(t.area);
    save('tasks');
    if (o.peek) return openPeek('task', t.id, { focusTitle: true });
    startInline('task', t.id);
  }
  // 표(또는 보드 카드)의 이름 칸을 입력 상태로. 그 칸이 화면에 없으면 상세 패널로
  function startInline(type, id) {
    if (ui.peek) { const f = ui.fresh; closePeek(true); ui.fresh = f; }
    closeMenu();
    ui.editing = { type, id };
    const fid = (type === 'task' ? 'tt-title-' : 'pt-topic-') + id;
    refresh(false, fid);
    setTimeout(() => {
      const n = $(fid);
      if (!n) { ui.editing = null; openPeek(type, id, { focusTitle: true }); return; }
      n.scrollIntoView({ block: 'nearest' });
      n.focus({ preventScroll: true });
    }, 0);
  }
  // Enter·칸 밖 누르기 = 저장, Esc = 취소. 이름 없이 끝낸 새 항목은 만들지 않은 것으로 지운다
  function inlineTitle(type, item, field, ph) {
    const i = el('input', { type: 'text', id: (type === 'task' ? 'tt-title-' : 'pt-topic-') + item.id, cls: 'cell-in inline-title', placeholder: ph, 'aria-label': item.id + ' ' + ph, autocomplete: 'off' });
    i.value = item[field] || '';
    let done = false;
    const finish = cancel => { if (done) return; done = true; finishInline(type, item, field, cancel ? null : i.value.trim()); };
    i.addEventListener('click', stop); i.addEventListener('dblclick', stop); i.addEventListener('mousedown', stop);
    i.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); finish(false); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(true); }
    });
    i.addEventListener('blur', () => { if (i.isConnected) finish(false); });
    return i;
  }
  const isEditing = (type, id) => !!ui.editing && ui.editing.type === type && ui.editing.id === id;
  // 이름 글자: 두 번 누르면 그 자리에서 이름 바꾸기
  const nameSpan = (type, item, field) => el('span', { cls: 'name' + (item[field] ? '' : ' untitled'), text: item[field] || '제목 없음', title: (item[field] ? item[field] + '\n' : '') + '두 번 눌러 이름 바꾸기',
    ondblclick: e => { e.stopPropagation(); if (online) startInline(type, item.id); } });
  function finishInline(type, item, field, v) {
    const isTask = type === 'task', file = isTask ? 'tasks' : 'posts';
    const fresh = isTask ? ui.fresh === item.id : ui.freshPost === item.id;
    ui.editing = null;
    if (isTask) ui.fresh = null; else ui.freshPost = null;
    if (v != null && v !== (item[field] || '')) item[field] = v;
    else if (!fresh) return refresh();
    if (fresh && !item[field]) {
      if (isTask) S.tasks = S.tasks.filter(x => x !== item); else S.posts = S.posts.filter(x => x !== item);
    }
    commit(file);
  }
  // 방금 만든 항목은 종류·상위 업무를 바꾸면 ID 규칙에 맞게 새 ID를 준다 (기존 항목의 ID는 바꾸지 않는다)
  function maybeReId(t) {
    if (ui.fresh !== t.id) return;
    const old = t.id; t.id = '\u0000';
    t.id = newTaskId(t.kind, t.parent);
    ui.fresh = t.id; if (ui.peek && ui.peek.id === old) ui.peek.id = t.id;
  }
  function deleteTask(t) {
    const kids = childrenOf(t.id);
    if (!confirm(`${t.id} · ${t.title || '제목 없음'}\n이 항목을 지울까요?` + (kids.length ? `\n하위 마일스톤 ${kids.length}개도 함께 지워집니다.` : ''))) return;
    const gone = new Set([t.id, ...kids.map(k => k.id)]);
    S.tasks = S.tasks.filter(x => !gone.has(x.id));
    S.tasks.forEach(x => { if (x.deps) x.deps = x.deps.filter(d => !gone.has(d)); });
    // 회의 할 일에서 이 업무로 등록한 연결을 푼다 (할 일은 남아 다시 등록할 수 있다)
    let mt = false; MT().forEach(m => m.actions.forEach(a => { if (a.task && gone.has(a.task)) { delete a.task; mt = true; } }));
    closePeek(true);
    commit(mt ? ['tasks', 'meetings'] : 'tasks');
  }
  function newTaskMenu(anchor) {
    const roots = S.tasks.filter(t => !t.parent && t.kind === '업무' && (t.event || childrenOf(t.id).length));
    openMenu(anchor, [
      { label: '업무', run: () => createTask({ kind: '업무' }) },
      { label: '확인·결정', run: () => createTask({ kind: '확인' }) },
      { label: 'SNS 게시물', run: () => createPost(TODAY) },
      { sep: true }, { head: '마일스톤 — 상위 업무 선택' },
      ...roots.map(r => ({ label: r.id + ' ' + r.title, run: () => createTask({ kind: '마일스톤', parent: r.id }) }))
    ]);
  }
  function filterPill(label, values, key) {
    const s = plainSelect(['전체', ...values], ui[key], v => { ui[key] = v; ui.keep.clear(); refresh(); }, { id: 'f-' + key, label, cls: '' });
    s.disabled = false;
    return el('label', { cls: 'fpill' + (ui[key] !== '전체' ? ' on' : ''), for: 'f-' + key }, [label, s]);
  }
  // 업무 페이지 (v0.7: 캘린더를 합침) — 위: 월간 달력, 아래: 영역별 업무 표/보드, 맨 아래: SNS 게시물
  // 영역·종류·담당·검색 필터는 달력과 표에 함께 적용된다. 상태 필터는 표에만.
  function renderTasksPage(root) {
    // 사이드바 영역 탭(#tasks/행사)은 이 페이지를 그 영역으로 거른 것. 없어진 영역이면 전체로
    if (ui.area !== '전체' && !cfg('areas').includes(ui.area) && !S.tasks.some(t => t.area === ui.area)) ui.area = '전체';
    const A = ui.area !== '전체' ? ui.area : null;
    if (A) {
      const mine = S.tasks.filter(t => t.area === A), open = mine.filter(t => !isTaskDone(t) && !isTaskOff(t));
      const lt = open.filter(t => t.due && t.due < TODAY).length, next = open.filter(t => t.due && t.due >= TODAY).sort((a, b) => a.due.localeCompare(b.due))[0];
      const head = pageHead('📋', A, '업무 › ' + A + ' 영역만 모아 봅니다. 남은 일 ' + open.length + '건' + (lt ? ' · 늦음 ' + lt + '건' : '') + (next ? ' · 다음 마감 ' + md(next.due) + ' ' + (next.title || '') : '') + '. 「＋」로 만드는 업무는 이 영역에 들어갑니다.');
      root.appendChild(el('div', { cls: 'back-row' }, [el('button', { type: 'button', cls: 'btn ghost sm back-all', text: '← 업무 전체', onclick: () => go('tasks') })]));
      root.appendChild(head);
    } else root.appendChild(pageHead('📋', '업무', '해야 할 일을 한곳에서 관리합니다. 위 달력은 업무 마감일과 SNS 게시일·제작 마감을, 아래 표는 영역별 업무를 보여 줍니다. 필터는 둘 다에 적용되고, 항목을 누르면 오른쪽에서 고치거나 지울 수 있습니다. 왼쪽 「업무」 아래 영역 탭으로 영역별로 볼 수도 있습니다.'));
    const q = el('input', { type: 'search', id: 'f-q', cls: 'search', placeholder: '검색 (제목·ID·메모)', 'aria-label': '업무 검색' }); q.value = ui.q;
    q.addEventListener('input', () => { ui.q = q.value; refresh(); });
    const nb = el('button', { type: 'button', cls: 'btn primary', text: '새로 만들기 ▾', disabled: !online });
    nb.addEventListener('click', () => newTaskMenu(nb));
    const filters = [filterPill('영역', cfg('areas'), 'area'), filterPill('종류', KINDS, 'kind')];
    if (ui.taskView === 'table') filters.push(filterPill('상태', ['미완료', ...cfg('taskStatuses')], 'status'));
    filters.push(filterPill('담당', cfg('owners'), 'owner'), q);
    root.appendChild(el('div', { cls: 'toolbar' },[el('div', { cls: 'filters' }, filters), nb]));

    root.appendChild(calendar());

    const tabs = el('div', { cls: 'viewtabs', role: 'tablist' }, [['table', '▦ 표'], ['board', '▥ 보드']].map(([v, l]) =>
      el('button', { type: 'button', role: 'tab', 'aria-selected': String(ui.taskView === v), text: l, onclick: () => { ui.taskView = v; refresh(); } })));
    root.appendChild(el('section', { cls: 'sec' }, [secHead('업무 목록', tabs), ui.taskView === 'table' ? taskTable() : taskBoard()]));

    // SNS 게시물은 전체 보기와 SNS 영역 탭에서만
    if (!A || A === 'SNS') { root.appendChild(el('h2', { cls: 'part', text: 'SNS 게시 운영' })); snsSection(root); }
  }
  function progressEl(t, kids) {
    const steps = t.steps || [];
    if (steps.length) { const d = steps.filter(s => s.done).length; return el('span', {}, [el('span', { cls: 'progress' }, [el('i', { style: 'width:' + (d / steps.length * 100) + '%' })]), d + '/' + steps.length]); }
    if (kids && kids.length) { const d = kids.filter(isTaskDone).length; return el('span', { title: '하위 ' + kids.length + '개 중 ' + d + '개 완료' }, [el('span', { cls: 'progress' }, [el('i', { style: 'width:' + (d / kids.length * 100) + '%' })]), d + '/' + kids.length]); }
    return el('span', { text: '' });
  }
  function taskRow(t, o) {
    const done = isTaskDone(t), late = t.due && t.due < TODAY && !done && !isTaskOff(t);
    const cb = checkIn(done, v => setTaskStatus(t, v ? '완료' : (cfg('taskStatuses')[0] || '대기')), { id: 'tt-c-' + t.id, label: (t.title || '제목 없음') + ' 완료' });
    const name = el('div', { cls: 'name-wrap' }, [
      o.kids ? el('button', { type: 'button', cls: 'tog', 'aria-label': o.open ? '하위 접기' : '하위 펼치기', 'aria-expanded': String(o.open), text: o.open ? '▾' : '▸', onclick: e => { e.stopPropagation(); ui.expanded.has(t.id) ? ui.expanded.delete(t.id) : ui.expanded.add(t.id); refresh(); } }) : o.child ? null : el('span', { cls: 'tog-sp' }),
      cb,
      isEditing('task', t.id) ? inlineTitle('task', t, 'title', o.child ? '하위 항목 이름 입력 후 Enter' : '이름 입력 후 Enter') : nameSpan('task', t, 'title'),
      t.kind === '확인' ? el('span', { cls: 'tag t-' + tagc('kind', '확인') + ' kind-mini', text: '확인' }) : null, // 종류 열 대신 확인·결정만 표시
      el('span', { cls: 'idt', text: t.id }),
      o.kids ? el('span', { cls: 'cnt', text: o.kidsDone + '/' + o.kids }) : null,
      rowActs(t, o)
    ]);
    if (o.drag) name.insertBefore(el('span', { cls: 'drag', draggable: online ? 'true' : null, title: '끌어서 순서·영역 옮기기', 'aria-hidden': 'true', text: '⋮⋮' }), name.firstChild);
    const sel = ui.peek && ui.peek.type === 'task' && ui.peek.id === t.id;
    // 하위가 있는 상위 업무와 그 하위는 한 덩어리(blk): 같은 색 왼쪽 띠, 상위 행은 굵게
    const tr = el('tr', { cls: 'r' + (o.child ? ' r-child' : '') + (o.kids ? ' r-parent' : '') + (o.blk ? ' blk' : '') + (done ? ' done' : '') + (sel ? ' sel' : ''), style: o.blk ? '--blk:var(--' + o.blk + ')' : null, tabindex: 0, 'data-id': t.id, onclick: () => openPeek('task', t.id), onkeydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) openPeek('task', t.id); } }, [
      el('td', { cls: 'c-name' + (o.child ? ' child' : '') + (o.last ? ' last' : '') + (o.treeOpen ? ' tree-open' : '') }, [name]),
      el('td', {}, [tagSelect(cfg('taskStatuses'), t.status, 'taskStatus', v => setTaskStatus(t, v), { id: 'tt-s-' + t.id, label: '상태' })]),
      // 우선·종류 열은 2026-10-13 표에서 뺐다 (상세 패널에서 고친다)
      el('td', {}, [tagSelect(cfg('owners'), t.owner, 'owner', v => { t.owner = v; commit('tasks', true); }, { id: 'tt-o-' + t.id, label: '담당' })]),
      el('td', { cls: 'c-range' }, [el('div', { cls: 'range' }, [
        // 시작이 종료보다 늦어지면 다른 쪽도 같은 날로 맞춘다
        dateIn(t.start, v => { t.start = v; if (v && t.due && t.due < v) t.due = v; commit('tasks', true); }, { typed: true, short: true, id: 'tt-s0-' + t.id, label: '시작', ph: '시작', cls: 'cell-in' }),
        el('span', { cls: 'range-sep', text: '~' }),
        dateIn(t.due, v => { t.due = v; if (v && t.start && t.start > v) t.start = v; commit('tasks', true); }, { typed: true, short: true, id: 'tt-d-' + t.id, label: '종료(마감)', ph: '종료', cls: 'cell-in' + (late ? ' late-in' : '') })])]),
      el('td', { cls: 'c-prog' }, [el('div', { cls: 'prog-wrap' }, [progressEl(t, o.allKids), o.kids ? blockSortControl(t) : null])])
    ]);
    if (o.drag) {
      const h = name.firstChild;
      h.addEventListener('click', stop);
      h.addEventListener('dragstart', e => { dragTask = t.id; e.dataTransfer.setData('text/plain', 'task:' + t.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setDragImage(tr, 16, 16); } catch (x) { } tr.classList.add('dragging'); });
      h.addEventListener('dragend', endTaskDrag);
      // 행 위쪽 절반에 놓으면 앞에, 아래쪽 절반이면 뒤에
      // 상위 업무는 상위 업무끼리, 하위 항목은 같은 상위 안에서만 옮긴다
      const fits = () => { const d = dragTask && dragTask !== t.id && taskById(dragTask); return !!d && (o.child ? d.parent === t.parent : isRoot(d)); };
      tr.addEventListener('dragover', e => {
        if (!fits()) return;
        e.preventDefault();
        const r = tr.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
        tr.classList.toggle('drop-after', after); tr.classList.toggle('drop-before', !after);
      });
      tr.addEventListener('dragleave', () => tr.classList.remove('drop-after', 'drop-before'));
      tr.addEventListener('drop', e => {
        if (!fits()) return;
        e.preventDefault();
        const after = tr.classList.contains('drop-after');
        if (o.child) moveChild(dragTask, t.id, after); else moveTask(dragTask, t.area, t.id, after);
      });
    }
    return tr;
  }
  // 행 오른쪽 작업 버튼: 마우스를 올리거나 행을 누르면 보인다. 상위 업무는 ＋하위 추가도
  function rowActs(t, o) {
    const b = (text, title, run, cls) => el('button', { type: 'button', cls: 'ra' + (cls ? ' ' + cls : ''), text, title, 'aria-label': (t.title || t.id) + ' ' + title, disabled: !online && title !== '편집', onclick: e => { e.stopPropagation(); run(); } });
    return el('span', { cls: 'row-acts' }, [
      !o.child && t.kind === '업무' ? b('＋ 하위', '하위 항목(마일스톤) 추가', () => createTask({ kind: '마일스톤', parent: t.id })) : null,
      o.child && !o.first ? b('↑', '한 칸 위로', () => moveChild(t.id, null, false, -1)) : null,
      o.child && !o.lastAll ? b('↓', '한 칸 아래로', () => moveChild(t.id, null, false, 1)) : null,
      b('편집', '편집', () => openPeek('task', t.id, { focusTitle: true })),
      b('삭제', '삭제', () => deleteTask(t), 'danger')
    ]);
  }
  // 영역(대분류) 이름 바꾸기·삭제. 영역 값은 config.json의 areas에 있고, 업무의 area도 함께 바뀐다
  function renameArea(area, nv) {
    ui.renamingArea = null;
    const arr = cfg('areas'), i = arr.indexOf(area);
    if (!nv || nv === area) return refresh();
    if (arr.includes(nv)) { alert('이미 있는 영역입니다.'); return refresh(); }
    if (i < 0) { S.tasks.forEach(t => { if (t.area === area) t.area = nv; }); S.config.areas.push(nv); commit(['config', 'tasks']); return; }
    if (ui.collapsed.has(area)) { ui.collapsed.delete(area); ui.collapsed.add(nv); }
    renameValue(LISTS.find(L => L.key === 'areas'), i, nv);
  }
  function deleteArea(area, anchor) {
    const used = S.tasks.filter(t => t.area === area);
    const drop = to => {
      if (to) used.forEach(t => { t.area = to; });
      S.config.areas = cfg('areas').filter(a => a !== area);
      if (ui.area === area) ui.area = '전체';
      commit(used.length ? ['config', 'tasks'] : 'config');
    };
    if (!used.length) { if (confirm(`「${area}」 영역을 지울까요?`)) drop(null); return; }
    const others = cfg('areas').filter(a => a !== area);
    if (!others.length) return alert('옮길 다른 영역이 없습니다. 먼저 영역을 하나 더 만들어 주세요.');
    openMenu(anchor, [{ head: `「${area}」의 업무·마일스톤 ${used.length}개를 옮기고 삭제` }, ...others.map(a => ({ label: a + '(으)로 옮기기', run: () => drop(a) }))]);
  }
  function addArea() {
    if (!online) return;
    let nv = '새 영역', n = 2; while (cfg('areas').includes(nv)) nv = '새 영역 ' + n++;
    (S.config.areas = S.config.areas || []).push(nv);
    ui.renamingArea = nv; ui.area = '전체';
    commit('config', false, 'area-rn');
  }
  function endTaskDrag() {
    dragTask = null;
    document.querySelectorAll('.dragging, .drop-after, .drop-before, .drop-into').forEach(x => x.classList.remove('dragging', 'drop-after', 'drop-before', 'drop-into'));
  }
  // 상위 업무 순서: 끌어서 정한 order가 있으면 그 순서, 없으면 확인은 뒤로 · 우선순위 · 마감순
  function rootSort(a, b) {
    const oa = num(a.order), ob = num(b.order);
    if (oa != null || ob != null) return (oa == null ? 1e9 : oa) - (ob == null ? 1e9 : ob);
    return (a.kind === '확인') - (b.kind === '확인') || (a.priority || 'P9').localeCompare(b.priority || 'P9') || (a.due || '').localeCompare(b.due || '');
  }
  const isRoot = t => !t.parent || !taskById(t.parent);
  // 업무를 다른 영역·위치로 옮긴다. 그 영역 상위 업무 전체에 order(10, 20, …)를 다시 매긴다
  function moveTask(id, area, refId, after) {
    const t = taskById(id); endTaskDrag();
    if (!t || !online) return;
    const oldArea = t.area;
    if (area !== oldArea) { t.area = area; childrenOf(t.id).forEach(c => { if (c.area === oldArea) c.area = area; }); }
    const roots = S.tasks.filter(x => isRoot(x) && x.area === area && x !== t).sort(rootSort);
    let i = refId ? roots.findIndex(x => x.id === refId) : -1;
    i = i < 0 ? roots.length : i + (after ? 1 : 0);
    roots.splice(i, 0, t);
    roots.forEach((x, k) => { x.order = (k + 1) * 10; });
    if (area !== oldArea) ui.collapsed.delete(area);
    commit('tasks', true);
  }
  // 하위 항목을 같은 상위 안에서 옮긴다 (refId 앞/뒤로, 또는 step으로 한 칸 위·아래). 형제 전체에 order(10, 20, …)를 다시 매긴다
  function moveChild(id, refId, after, step) {
    const t = taskById(id); endTaskDrag();
    if (!t || !online || !t.parent) return;
    const sib = childrenOf(t.parent);
    let i = sib.indexOf(t);
    if (step) { const j = i + step; if (j < 0 || j >= sib.length) return; sib.splice(i, 1); sib.splice(j, 0, t); }
    else { sib.splice(i, 1); let k = sib.findIndex(x => x.id === refId); if (k < 0) return; sib.splice(k + (after ? 1 : 0), 0, t); }
    sib.forEach((x, k) => { x.order = (k + 1) * 10; });
    commit('tasks', true);
  }
  function groupDropTarget(row, area) {
    row.addEventListener('dragover', e => { if (!dragTask || !isRoot(taskById(dragTask) || {})) return; e.preventDefault(); row.classList.add('drop-into'); });
    row.addEventListener('dragleave', () => row.classList.remove('drop-into'));
    row.addEventListener('drop', e => { if (!dragTask || !isRoot(taskById(dragTask) || {})) return; e.preventDefault(); moveTask(dragTask, area, null); });
  }
  // 표 열 너비 조절: 머리글 오른쪽 끝을 끌기, 두 번 누르면 기본 너비. 표마다 브라우저에 기억
  // cols: [{ id, w: 기본 px } | { id, flex: true, min }] — flex 열은 따로 정하기 전까지 남는 폭을 다 쓴다
  const COLWK = 'nets.colWidths';
  const colW = (() => { try { return JSON.parse(localStorage.getItem(COLWK) || '{}') || {}; } catch (e) { return {}; } })();
  const saveColW = () => { try { localStorage.setItem(COLWK, JSON.stringify(colW)); } catch (e) { } };
  function resizable(table, key, cols) {
    const W = colW[key] = colW[key] || {};
    const cg = el('colgroup', {}, cols.map(c => el('col')));
    table.insertBefore(cg, table.firstChild);
    table.classList.add('rz');
    const apply = () => {
      let sum = 0, flexFree = false;
      cols.forEach((c, i) => {
        const w = W[c.id] != null ? W[c.id] : c.w;
        if (w == null) { cg.children[i].style.width = ''; flexFree = true; sum += c.min || 240; }
        else { cg.children[i].style.width = w + 'px'; sum += w; }
      });
      // 모든 열 너비가 정해지면 표 폭 = 합계(넘치면 가로 스크롤), 아니면 화면 폭을 채움
      table.style.width = flexFree ? '100%' : sum + 'px';
      table.style.minWidth = sum + 'px';
    };
    apply();
    const ths = table.querySelectorAll('thead th');
    cols.forEach((c, i) => {
      const th = ths[i]; if (!th) return;
      const h = el('span', { cls: 'col-rz', title: '끌어서 너비 조절 · 두 번 누르면 기본 너비', 'aria-hidden': 'true' });
      h.addEventListener('dblclick', e => { e.stopPropagation(); delete W[c.id]; saveColW(); apply(); });
      h.addEventListener('mousedown', e => {
        e.preventDefault(); e.stopPropagation();
        const x0 = e.clientX, w0 = th.getBoundingClientRect().width, min = c.min || 48;
        h.classList.add('on'); document.body.classList.add('col-resizing');
        const move = ev => { W[c.id] = Math.max(min, Math.round(w0 + ev.clientX - x0)); apply(); };
        const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); h.classList.remove('on'); document.body.classList.remove('col-resizing'); saveColW(); };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      });
      th.appendChild(h);
    });
  }
  // 상위 업무 덩어리 색 (영역 안에서 차례로). 태그 팔레트의 진한 색
  const BLOCK_COLORS = ['blue', 'orange', 'purple', 'green', 'pink', 'brown'];
  // 영역(카테고리)별 정렬: 상위 업무는 하위를 데리고 통째로, 하위는 각자 상위 안에서 같은 기준으로. 화면에서만 바뀌고 「이 순서로 고정」하면 order로 저장
  const SORTS = [['', '직접 정한 순서'], ['start', '시작일'], ['due', '종료일'], ['status', '상태'], ['priority', '우선순위'], ['owner', '담당'], ['kind', '종류'], ['title', '이름'], ['progress', '진행률']];
  const SORTK = 'nets.taskSorts';
  ui.sorts = (() => { try { return JSON.parse(localStorage.getItem(SORTK) || '{}') || {}; } catch (e) { return {}; } })();
  const saveSorts = () => { try { localStorage.setItem(SORTK, JSON.stringify(ui.sorts)); } catch (e) { } };
  function taskProgress(t) {
    const k = childrenOf(t.id).filter(c => !isTaskOff(c));
    if (k.length) return k.filter(isTaskDone).length / k.length;
    const s = t.steps || []; if (s.length) return s.filter(x => x.done).length / s.length;
    return isTaskDone(t) ? 1 : 0;
  }
  // 비어 있는 값은 오름·내림차순 모두 맨 뒤
  function taskCmp(key, dir) {
    const idx = list => v => { const i = list.indexOf(v); return i < 0 ? null : i; };
    const val = {
      start: t => t.start || null, due: t => t.due || null, title: t => t.title || null, progress: taskProgress,
      status: t => idx(cfg('taskStatuses'))(t.status), priority: t => idx(cfg('priorities'))(t.priority), owner: t => idx(cfg('owners'))(t.owner), kind: t => idx(KINDS)(t.kind)
    }[key];
    const m = dir === 'desc' ? -1 : 1;
    return (a, b) => {
      const x = val(a), y = val(b);
      if (x == null || y == null) return (x == null) - (y == null);
      return m * (typeof x === 'string' ? x.localeCompare(y, 'ko') : x - y);
    };
  }
  function fixSortedOrder(area) {
    const so = ui.sorts[area]; if (!so || !so.key || !online) return;
    if (!confirm(`「${area}」 영역을 지금 보이는 정렬(${(SORTS.find(s => s[0] === so.key) || [])[1]} ${so.dir === 'desc' ? '내림차순' : '오름차순'}) 순서로 고정할까요?\n상위 업무와 하위 항목의 「직접 정한 순서」가 이 순서로 바뀝니다.`)) return;
    const cmp = taskCmp(so.key, so.dir);
    S.tasks.filter(t => isRoot(t) && t.area === area).sort((a, b) => cmp(a, b) || rootSort(a, b)).forEach((r, i) => {
      r.order = (i + 1) * 10;
      childrenOf(r.id).sort(cmp).forEach((c, j) => { c.order = (j + 1) * 10; });
    });
    delete ui.sorts[area]; saveSorts();
    commit('tasks', true);
  }
  // 대항목(상위 업무)별 하위 정렬: 영역 정렬보다 우선. 그 상위 업무의 하위만 따로 정렬
  const BSORTK = 'nets.blockSorts';
  ui.blockSorts = (() => { try { return JSON.parse(localStorage.getItem(BSORTK) || '{}') || {}; } catch (e) { return {}; } })();
  const saveBlockSorts = () => { try { localStorage.setItem(BSORTK, JSON.stringify(ui.blockSorts)); } catch (e) { } };
  function fixBlockOrder(t) {
    const so = ui.blockSorts[t.id]; if (!so || !so.key || !online) return;
    if (!confirm(`「${t.title || t.id}」의 하위 항목을 지금 보이는 정렬 순서로 고정할까요?`)) return;
    childrenOf(t.id).sort(taskCmp(so.key, so.dir)).forEach((c, j) => { c.order = (j + 1) * 10; });
    delete ui.blockSorts[t.id]; saveBlockSorts();
    commit('tasks', true);
  }
  function blockSortControl(t) {
    const so = ui.blockSorts[t.id] || {}, id = 'bsort-' + t.id;
    const set = (k, d) => { if (k) ui.blockSorts[t.id] = { key: k, dir: d || 'asc' }; else delete ui.blockSorts[t.id]; saveBlockSorts(); ui.expanded.add(t.id); refresh(); };
    const sel = plainSelect(SORTS.map(([v, l]) => ({ value: v, label: v ? l : '영역 정렬 따름' })), so.key || '', v => set(v, so.dir), { id, cls: '', label: (t.title || t.id) + ' 하위 정렬' });
    sel.disabled = false;
    return el('span', { cls: 'b-sort' + (so.key ? ' on' : ''), onclick: stop, onkeydown: stop }, [
      el('label', { cls: 'fpill' + (so.key ? ' on' : ''), for: id }, ['하위 정렬', sel]),
      so.key ? el('button', { type: 'button', cls: 'ra', text: so.dir === 'desc' ? '↓' : '↑', title: so.dir === 'desc' ? '내림차순 (누르면 오름차순)' : '오름차순 (누르면 내림차순)', onclick: () => set(so.key, so.dir === 'desc' ? 'asc' : 'desc') }) : null,
      so.key ? el('button', { type: 'button', cls: 'ra', text: '고정', title: '이 순서를 직접 정한 순서로 저장', disabled: !online, onclick: () => fixBlockOrder(t) }) : null
    ]);
  }
  function sortControl(area) {
    const so = ui.sorts[area] || {};
    const set = (k, d) => { if (k) ui.sorts[area] = { key: k, dir: d || 'asc' }; else delete ui.sorts[area]; saveSorts(); refresh(); };
    const sel = plainSelect(SORTS.map(([v, l]) => ({ value: v, label: l })), so.key || '', v => set(v, so.dir), { id: 'sort-' + area, cls: '', label: area + ' 정렬 기준' });
    sel.disabled = false;
    return el('span', { cls: 'g-sort' + (so.key ? ' on' : ''), onclick: stop }, [
      el('label', { cls: 'fpill' + (so.key ? ' on' : ''), for: 'sort-' + area }, ['정렬', sel]),
      so.key ? el('button', { type: 'button', cls: 'ra', text: so.dir === 'desc' ? '↓ 내림차순' : '↑ 오름차순', title: '정렬 방향 바꾸기', onclick: () => set(so.key, so.dir === 'desc' ? 'asc' : 'desc') }) : null,
      so.key ? el('button', { type: 'button', cls: 'ra', text: '이 순서로 고정', title: '지금 정렬을 직접 정한 순서(order)로 저장', disabled: !online, onclick: () => fixSortedOrder(area) }) : null
    ]);
  }
  function taskTable() {
    const wrap = el('div', { cls: 'hscroll' });
    const roots = S.tasks.filter(isRoot);
    const rows = roots.map(t => {
      const all = childrenOf(t.id);
      const kids = all.filter(c => taskMatches(c) && statusMatches(c));
      const self = taskMatches(t) && statusMatches(t);
      return (self || kids.length) ? { t, all, kids } : null;
    }).filter(Boolean);
    const areas = cfg('areas').concat([...new Set(rows.map(r => r.t.area))].filter(a => !cfg('areas').includes(a)));
    const table = el('table', { cls: 'db tasks' });
    table.appendChild(el('thead', {}, [el('tr', {}, ['이름', '상태', '담당', '기간 (시작 ~ 종료)', '진행'].map(h => el('th', { text: h })))]));
    const tb = el('tbody');
    let any = false;
    // 필터와 상관없이 모든 영역을 보여 준다: 빈 영역에도 업무를 끌어다 놓을 수 있게
    const filtering = ui.area !== '전체' || ui.kind !== '전체' || ui.owner !== '전체' || !!ui.q;
    areas.forEach(area => {
      if (ui.area !== '전체' && area !== ui.area) return;
      const so = ui.sorts[area], cmp = so && so.key ? taskCmp(so.key, so.dir) : null;
      const list = rows.filter(r => r.t.area === area).sort((a, b) => (cmp && cmp(a.t, b.t)) || rootSort(a.t, b.t));
      if (!list.length && filtering) return;
      any = true;
      const closed = ui.collapsed.has(area);
      const toggle = () => { closed ? ui.collapsed.delete(area) : ui.collapsed.add(area); refresh(); };
      // 영역(대분류) 머리: 왼쪽은 접기·이름·개수, 오른쪽은 ＋업무 추가 · 이름 수정 · 삭제
      let label = tagEl(area, 'area');
      if (ui.renamingArea === area) {
        label = el('input', { type: 'text', id: 'area-rn', cls: 'area-rn', value: area, 'aria-label': '영역 이름' });
        label.addEventListener('click', stop);
        label.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); renameArea(area, label.value.trim()); } if (e.key === 'Escape') { ui.renamingArea = null; refresh(); } });
        label.addEventListener('blur', () => { if (ui.renamingArea === area) renameArea(area, label.value.trim()); });
        requestAnimationFrame(() => { if (document.activeElement === label) label.select(); });
      }
      const parents = list.filter(r => r.all.length).map(r => r.t.id), allOpen = parents.length > 0 && parents.every(id => ui.expanded.has(id));
      const ga = (text, title, run, cls) => el('button', { type: 'button', cls: 'ra' + (cls ? ' ' + cls : ''), text, title, 'aria-label': area + ' ' + title, disabled: !online && !title.includes('하위 모두'), onclick: e => { e.stopPropagation(); run(e.currentTarget); } });
      const gh = el('tr', { cls: 'r-group' }, [el('td', { colspan: 5 }, [el('div', { cls: 'group-head', role: 'button', tabindex: 0, 'aria-expanded': String(!closed), onclick: toggle, onkeydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) toggle(); } },
        [el('span', { cls: 'tog', text: closed ? '▸' : '▾' }), label, el('span', { cls: 'cnt', text: String(list.length) }),
          sortControl(area),
          el('span', { cls: 'row-acts g-row-acts' }, [
            parents.length ? ga(allOpen ? '모두 접기' : '모두 펼치기', allOpen ? '하위 모두 접기' : '하위 모두 펼치기', () => { parents.forEach(id => allOpen ? ui.expanded.delete(id) : ui.expanded.add(id)); refresh(); }) : null,
            ga('＋ 업무 추가', '이 영역에 업무 추가', () => createTask({ kind: '업무', area })),
            ga('이름 수정', '영역 이름 수정', () => { ui.renamingArea = area; refresh(false, 'area-rn'); }),
            ga('삭제', '영역 삭제', b => deleteArea(area, b), 'danger')
          ])])])]);
      groupDropTarget(gh, area);
      tb.appendChild(gh);
      if (closed) return;
      let nb = 0;
      list.forEach(({ t, all, kids }, li) => {
        // 큰 항목(상위 업무) 사이 여백
        if (li) tb.appendChild(el('tr', { cls: 'r-spacer', 'aria-hidden': 'true' }, [el('td', { colspan: 5 })]));
        const open = ui.expanded.has(t.id) || ui.kind === '마일스톤' || !!ui.q;
        const blk = all.length ? BLOCK_COLORS[nb++ % BLOCK_COLORS.length] : null;
        // 정렬 중에는 끌기·↑↓를 끈다 (보이는 순서와 저장된 순서가 달라서)
        tb.appendChild(taskRow(t, { kids: all.length, kidsDone: all.filter(isTaskDone).length, allKids: all, open, drag: !cmp, treeOpen: open && kids.length > 0, blk }));
        if (!open) return;
        // 하위도 끌어서 순서 바꾸기 (필터로 일부만 보일 때는 순서가 헷갈리므로 끄고 ↑↓만)
        const whole = kids.length === all.length;
        const bso = ui.blockSorts[t.id], kcmp = bso && bso.key ? taskCmp(bso.key, bso.dir) : cmp; // 대항목 정렬 > 영역 정렬
        const shown = kcmp ? [...kids].sort(kcmp) : kids;
        shown.forEach((c, i) => tb.appendChild(taskRow(c, { child: true, last: i === shown.length - 1, blk, drag: whole && !kcmp, first: !!kcmp || all[0] === c, lastAll: !!kcmp || all[all.length - 1] === c })));
        // 덩어리 끝: 이 상위 업무에 하위 추가 (다음 상위 업무와 띄우는 역할도)
        const addKid = () => createTask({ kind: '마일스톤', parent: t.id });
        tb.appendChild(el('tr', { cls: 'r-add r-blk-end', style: '--blk:var(--' + blk + ')' }, [el('td', { colspan: 5, role: 'button', tabindex: 0, onclick: addKid, onkeydown: e => { if (e.key === 'Enter') addKid(); } }, [
          el('span', { text: '＋ 하위 추가' }), el('span', { cls: 'blk-of', text: ' · ' + (t.title || t.id) })])]));
      });
      const add = el('tr', { cls: 'r-add' }, [el('td', { colspan: 5, role: 'button', tabindex: 0, onclick: () => createTask({ kind: '업무', area }), onkeydown: e => { if (e.key === 'Enter') createTask({ kind: '업무', area }); }, text: list.length ? '＋ 새로 만들기' : '＋ 새로 만들기 · 업무를 여기로 끌어 놓을 수도 있습니다' })]);
      groupDropTarget(add, area);
      tb.appendChild(add);
    });
    if (!any) tb.appendChild(el('tr', {}, [el('td', { colspan: 5, cls: 'empty', text: '조건에 맞는 업무가 없습니다.' })]));
    if (!filtering) tb.appendChild(el('tr', { cls: 'r-add g-add' }, [el('td', { colspan: 5, role: 'button', tabindex: 0, onclick: addArea, onkeydown: e => { if (e.key === 'Enter') addArea(); }, text: '＋ 새 영역 (대분류)' })]));
    table.appendChild(tb); wrap.appendChild(table);
    resizable(table, 'tasks', [{ id: 'name', flex: true, min: 200 }, { id: 'status', w: 84 }, { id: 'owner', w: 130 }, { id: 'range', w: 232 }, { id: 'prog', w: 230 }]);
    return wrap;
  }
  function taskBoard() {
    const board = el('div', { cls: 'board' });
    const items = S.tasks.filter(taskMatches);
    cfg('taskStatuses').forEach(st => {
      // 이름을 입력 중인 새 카드는 열 맨 아래에
      const list = items.filter(t => t.status === st).sort((a, b) => isEditing('task', a.id) - isEditing('task', b.id) || (a.due || '9').localeCompare(b.due || '9'));
      const col = el('div', { cls: 'bcol' }, [el('div', { cls: 'bcol-head' }, [tagEl(st, 'taskStatus'), el('span', { text: String(list.length) })])]);
      col.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/plain')) { e.preventDefault(); col.classList.add('over'); } });
      col.addEventListener('dragleave', () => col.classList.remove('over'));
      col.addEventListener('drop', e => { e.preventDefault(); col.classList.remove('over'); const v = e.dataTransfer.getData('text/plain'); if (!v.startsWith('task:')) return; const t = taskById(v.slice(5)); if (t && t.status !== st) setTaskStatus(t, st); });
      list.forEach(t => {
        const late = t.due && t.due < TODAY && !isTaskDone(t) && !isTaskOff(t);
        const card = el('div', { cls: 'bcard' + (late ? ' late' : ''), draggable: online ? 'true' : null, tabindex: 0, role: 'button', onclick: () => openPeek('task', t.id), onkeydown: e => { if (e.key === 'Enter') openPeek('task', t.id); } }, [
          isEditing('task', t.id) ? inlineTitle('task', t, 'title', '이름 입력 후 Enter') : el('div', { cls: 'name' + (t.title ? '' : ' untitled'), text: t.title || '제목 없음' }),
          el('div', { cls: 'meta' }, [t.kind !== '업무' ? tagEl(t.kind, 'kind') : null, t.priority ? tagEl(t.priority, 'priority') : null, el('span', { cls: 'due', text: md(t.due) }), el('span', { text: '· ' + (t.parent || t.id) + ' · ' + (t.owner || '') })])
        ]);
        card.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', 'task:' + t.id); card.classList.add('dragging'); });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
        col.appendChild(card);
      });
      col.appendChild(el('button', { type: 'button', cls: 'badd', text: '＋ 새로 만들기', disabled: !online, onclick: () => createTask({ kind: '업무', status: st }) }));
      board.appendChild(col);
    });
    return board;
  }

  /* ---------- side peek ---------- */
  function openPeek(type, id, opts) { closeMenu(); ui.peek = { type, id }; renderPeek(opts); refresh(); }
  function closePeek(silent) {
    const a = document.activeElement;
    if (a && $('peek').contains(a)) a.blur(); // 입력 중이던 칸의 change를 먼저 반영
    ui.peek = null; ui.fresh = null;
    $('peek').hidden = true; $('peek').textContent = '';
    if (!silent) refresh();
  }
  function renderPeek(opts) {
    const box = $('peek');
    if (!ui.peek || !S.config) { box.hidden = true; return; }
    const { type, id } = ui.peek;
    const item = type === 'task' ? taskById(id) : type === 'post' ? postById(id) : type === 'meeting' ? meetingById(id) : budgetItemById(id);
    if (!item) { closePeek(true); return; }
    const top = el('div', { cls: 'peek-top' }, [el('div', { cls: 'peek-crumb', id: 'pk-crumb' }), el('span', { cls: 'spacer' }),
      el('button', { type: 'button', cls: 'btn ghost icon', 'aria-label': '닫기 (Esc)', title: '닫기 (Esc)', text: '✕', onclick: () => closePeek() })]);
    const body = el('div', { cls: 'peek-body' });
    box.textContent = ''; box.appendChild(top); box.appendChild(body); box.hidden = false;
    if (type === 'task') peekTask(item, body, top.firstChild);
    else if (type === 'post') peekPost(item, body, top.firstChild);
    else if (type === 'meeting') peekMeeting(item, body, top.firstChild);
    else peekBudget(item, body, top.firstChild);
    if (opts && opts.focusTitle) { const t = $('pk-title'); if (t) t.focus(); box.scrollTop = 0; }
  }
  const prop = (label, ...ctl) => [el('div', { cls: 'pl', text: label }), el('div', { cls: 'pv' }, ctl)];
  const ro = (text, muted) => el('span', { cls: 'ro' + (muted ? ' muted' : ''), text });
  function relation(list, options, onChange, o) {
    const wrap = el('div', { cls: 'rel' });
    list.forEach(id => {
      const opt = options.find(x => x.value === id);
      wrap.appendChild(el('span', { cls: 'rel-chip', title: opt ? opt.label : id + ' (없는 항목)' }, [
        el('button', { type: 'button', cls: 'go', text: id, onclick: () => o.open && o.open(id) }),
        el('button', { type: 'button', 'aria-label': id + ' 연결 해제', text: '×', disabled: !online, onclick: () => onChange(list.filter(x => x !== id)) })]));
    });
    const rest = options.filter(x => !list.includes(x.value));
    if (rest.length) {
      const s = plainSelect([{ value: '', label: '＋ 추가' }, ...rest], '', v => { if (v) onChange([...list, v]); }, { id: o.id, cls: 'rel-add', label: o.label + ' 추가' });
      wrap.appendChild(s);
    }
    if (!list.length && !rest.length) wrap.appendChild(ro('—', true));
    return wrap;
  }
  function crumbBtn(text, run) { return el('button', { type: 'button', text, onclick: run }); }

  function peekTask(t, body, crumb) {
    const parent = t.parent ? taskById(t.parent) : null;
    crumb.appendChild(crumbBtn('📋 업무', () => { closePeek(true); go('tasks'); }));
    if (parent) { crumb.appendChild(document.createTextNode('/')); crumb.appendChild(crumbBtn(parent.id + ' ' + parent.title, () => openPeek('task', parent.id))); }
    crumb.appendChild(document.createTextNode('/'));
    crumb.appendChild(el('span', { text: t.id }));
    const set = (k, v, peekToo) => { if (v === '' || v == null) delete t[k]; else t[k] = v; commit('tasks', peekToo); };
    const title = textIn(t.title, v => { t.title = v; commit('tasks'); }, { id: 'pk-title', cls: 'ptitle', multi: true, enterCommits: true, ph: '제목 없음', label: '제목' });
    body.appendChild(title);
    const kids = childrenOf(t.id);
    const roots = S.tasks.filter(x => !x.parent && x.kind === '업무' && x.id !== t.id);
    const props = el('div', { cls: 'props' });
    const late = t.due && t.due < TODAY && !isTaskDone(t) && !isTaskOff(t);
    [
      prop('상태', tagSelect(cfg('taskStatuses'), t.status, 'taskStatus', v => setTaskStatus(t, v), { id: 'pk-status', label: '상태' }), t.doneAt ? el('span', { cls: 'hint', text: md(t.doneAt) + ' 완료' }) : null),
      prop('종류', tagSelect(KINDS, t.kind, 'kind', v => { t.kind = v; maybeReId(t); commit('tasks', true); }, { id: 'pk-kind', label: '종류' }), ui.fresh === t.id ? el('span', { cls: 'hint', text: 'ID ' + t.id }) : null),
      prop('우선순위', tagSelect(cfg('priorities'), t.priority, 'priority', v => { t.priority = v; commit('tasks', true); }, { id: 'pk-pr', label: '우선순위' })),
      prop('영역', tagSelect(cfg('areas'), t.area, 'area', v => { t.area = v; commit('tasks', true); }, { id: 'pk-area', label: '영역' })),
      prop('담당', tagSelect(cfg('owners'), t.owner, 'owner', v => { t.owner = v; commit('tasks', true); }, { id: 'pk-owner', label: '담당' })),
      prop('시작', dateIn(t.start, v => { t.start = v; commit('tasks', true); }, { typed: true, id: 'pk-start', label: '시작' })),
      prop('마감', dateIn(t.due, v => { t.due = v; commit('tasks', true); }, { typed: true, id: 'pk-due', label: '마감' }), late ? el('span', { cls: 'hint warn', text: diff(t.due, TODAY) + '일 지남' }) : null),
      prop('상위 업무', kids.length ? ro('하위 마일스톤이 있어 상위 업무를 둘 수 없음', true)
        : plainSelect([{ value: '', label: '(없음)' }, ...roots.map(r => ({ value: r.id, label: r.id + ' ' + r.title }))], t.parent || '', v => {
          if (v) { t.parent = v; const pe = taskById(v).event; if (pe && !t.event) t.event = pe; } else delete t.parent;
          maybeReId(t); commit('tasks', true);
        }, { id: 'pk-parent', label: '상위 업무' })),
      prop('행사', plainSelect([{ value: '', label: '(없음)' }, ...cfg('events').map(e => ({ value: e.id, label: e.label }))], t.event || '', v => set('event', v, true), { id: 'pk-event', label: '행사' })),
      prop('산출물', textIn(t.deliverable, v => set('deliverable', v), { id: 'pk-deliv', ph: '비어 있음', label: '산출물' })),
      prop('완료 기준', textIn(t.doneWhen, v => set('doneWhen', v), { id: 'pk-donewhen', ph: '비어 있음', label: '완료 기준' })),
      prop('선행 업무', relation(t.deps || [], S.tasks.filter(x => x.id !== t.id && !x.parent).map(x => ({ value: x.id, label: x.id + ' ' + x.title })), v => { if (v.length) t.deps = v; else delete t.deps; commit('tasks', true); }, { id: 'pk-deps', label: '선행 업무', open: id => openPeek('task', id) })),
      t.meeting ? prop('회의', el('span', { cls: 'rel-chip' }, [el('button', { type: 'button', cls: 'go', text: t.meeting + (meetingById(t.meeting) ? ' ' + md(meetingById(t.meeting).date) + ' ' + meetName(meetingById(t.meeting)) : ' (지워진 회의)'), onclick: () => meetingById(t.meeting) && openPeek('meeting', t.meeting) })])) : null,
      prop('연결 게시물', relation(t.posts || [], [...S.posts].sort((a, b) => a.date.localeCompare(b.date)).map(p => ({ value: p.id, label: p.id + ' ' + mdShort(p.date) + ' ' + (p.topic || '') })), v => { if (v.length) t.posts = v; else delete t.posts; commit('tasks', true); }, { id: 'pk-posts', label: '연결 게시물', open: id => openPeek('post', id) }))
    ].filter(Boolean).forEach(pair => pair.forEach(x => props.appendChild(x)));
    body.appendChild(props);

    if (!t.parent) {
      const list = el('div', { cls: 'kids' });
      kids.forEach(c => {
        const cd = isTaskDone(c), cl = c.due && c.due < TODAY && !cd && !isTaskOff(c);
        list.appendChild(el('div', { cls: 'kid' + (cd ? ' done' : '') + (cl ? ' late' : ''), role: 'button', tabindex: 0, onclick: () => openPeek('task', c.id), onkeydown: e => { if (e.key === 'Enter') openPeek('task', c.id); } }, [
          checkIn(cd, v => setTaskStatus(c, v ? '완료' : (cfg('taskStatuses')[0] || '대기')), { id: 'pk-kid-' + c.id, label: c.title + ' 완료' }),
          el('span', { cls: 'd', text: md(c.due) }), el('span', { cls: 't', text: c.title || '제목 없음' }), el('span', { cls: 'note', text: c.owner || '' })]));
      });
      if (kids.length || t.kind === '업무') body.appendChild(el('div', { cls: 'psec' }, [el('h3', {}, ['하위 항목', el('span', { cls: 'note', text: kids.filter(isTaskDone).length + '/' + kids.length })]), list,
        el('button', { type: 'button', cls: 'addline', text: '＋ 하위 추가', disabled: !online, onclick: () => createTask({ kind: '마일스톤', parent: t.id }) })]));
    }

    // 상위 업무의 세부 할 일은 하위 항목으로 (표에 줄로 보인다). 체크리스트는 하위 항목 안의 작은 단계용 (예전 데이터가 남아 있으면 그대로 보여 줌)
    const steps = t.steps || [];
    if (!t.parent && !steps.length) return footTask(t, body);
    const ul = el('ul', { cls: 'steps' });
    steps.forEach((s, i) => {
      ul.appendChild(el('li', { cls: s.done ? 'done' : '' }, [
        checkIn(s.done, v => { s.done = v; commit('tasks', true); }, { id: 'pk-st-' + i, label: '단계 ' + (i + 1) + ' 완료' }),
        textIn(s.text, v => { s.text = v; commit('tasks'); }, { id: 'pk-stt-' + i, ph: '할 일', label: '단계 ' + (i + 1) }),
        el('button', { type: 'button', cls: 'btn ghost icon x', 'aria-label': '단계 ' + (i + 1) + ' 삭제', text: '×', disabled: !online, onclick: () => { steps.splice(i, 1); if (!steps.length) delete t.steps; commit('tasks', true); } })
      ]));
    });
    body.appendChild(el('div', { cls: 'psec' }, [el('h3', {}, ['체크리스트', steps.length ? el('span', { cls: 'note', text: steps.filter(s => s.done).length + '/' + steps.length }) : null]), ul,
      el('button', { type: 'button', cls: 'addline', text: '＋ 단계 추가', disabled: !online, onclick: () => { t.steps = steps; steps.push({ text: '', done: false }); commit('tasks', true, 'pk-stt-' + (steps.length - 1)); } })]));
    footTask(t, body);
  }
  function footTask(t, body) {
    body.appendChild(el('div', { cls: 'psec' }, [el('h3', { text: '메모' }), textIn(t.note, v => { t.note = v; commit('tasks'); }, { id: 'pk-note', multi: true, rows: 3, raw: true, ph: '진행 상황, 막힌 점, 결정 사항', label: '메모' })]));
    body.appendChild(el('div', { cls: 'peek-foot' }, [el('span', { cls: 'note', text: t.id + (t.doneAt ? ' · 완료 ' + t.doneAt : '') }),
      el('button', { type: 'button', cls: 'btn danger', text: '삭제', disabled: !online, onclick: () => deleteTask(t) })]));
  }

  /* ---------- SNS 캘린더 ---------- */
  function createPost(date) {
    if (!online) return;
    const n = S.posts.map(p => Number(String(p.id).replace(/^p/, '')) || 0).reduce((a, b) => Math.max(a, b), 0) + 1;
    const id = 'p' + pad2(n);
    const prev = [...S.posts].filter(p => p.date <= date).sort((a, b) => a.date.localeCompare(b.date)).pop();
    const p = {
      id, no: S.posts.map(x => num(x.no) || 0).reduce((a, b) => Math.max(a, b), 0) + 1, date, time: (S.config.rules && S.config.rules.postTime) || '09:00',
      phase: prev ? prev.phase : 1, pillar: ui.pillar !== '전체' ? ui.pillar : (cfg('pillars')[1] || cfg('pillars')[0]), topic: '', format: '', cta: '', liHook: '', fbHook: '', source: '',
      approval: false, status: cfg('postStatuses')[0] || '기획', draft: 'drafts/' + id + '.md',
      li: { impr: null, eng: null, clicks: null }, fb: { reach: null, eng: null, clicks: null }, note: ''
    };
    if (ui.peek) closePeek(true);
    S.posts.push(p);
    ui.freshPost = id;
    save('posts');
    startInline('post', id);
  }
  function deletePost(p) {
    const refs = S.tasks.filter(t => (t.posts || []).includes(p.id));
    if (!confirm(`${p.id} · ${p.topic || '제목 없음'}\n이 게시물을 지울까요?` + (refs.length ? `\n업무 ${refs.map(t => t.id).join(', ')}의 연결도 함께 지웁니다.` : '') + '\n\n게시하지 않기로 한 경우에는 지우는 대신 상태를 「대체·보류」로 두면 기록이 남습니다.')) return;
    S.posts = S.posts.filter(x => x !== p);
    refs.forEach(t => { t.posts = t.posts.filter(x => x !== p.id); if (!t.posts.length) delete t.posts; });
    closePeek(true);
    commit(refs.length ? ['posts', 'tasks'] : 'posts');
  }
  function movePost(p, date) {
    if (!date || p.date === date) return;
    p.date = date; commit('posts', true);
  }
  // 업무 페이지 맨 아래: 게시물 목록 · 필러별 진행 · 톤 가이드
  function snsSection(root) {
    root.appendChild(postsTable());
    const active = S.posts.filter(p => !isPostDrop(p));
    const mix = el('div', { cls: 'mix' });
    const max = Math.max(1, ...cfg('pillars').map(k => active.filter(p => p.pillar === k).length));
    cfg('pillars').forEach(k => {
      const plan = active.filter(p => p.pillar === k).length, done = active.filter(p => p.pillar === k && isPostDone(p)).length;
      mix.appendChild(el('div', { cls: 'mix-row' }, [tagEl(k, 'pillar'), el('div', { cls: 'bar' }, [el('i', { cls: 'plan', style: `width:${plan / max * 100}%;background:${pillarColor(k)}` }), el('i', { style: `width:${done / max * 100}%;background:${pillarColor(k)}` })]), el('span', { cls: 'n', text: done + ' / ' + plan })]));
    });
    const tone = el('table', { cls: 'tone' }, [el('thead', {}, [el('tr', {}, ['', 'LinkedIn', 'Facebook'].map(h => el('th', { text: h })))]),
      el('tbody', {}, [['화자', '현업을 아는 전문가', '같은 업계의 친근한 동료'], ['첫 문장', '문제나 숫자', '장면이나 질문'], ['길이', '7~10줄 + 캐러셀(PDF)', '3~5줄 + 같은 이미지'], ['용어', 'IAM·SoD·ITGC 그대로', '풀어 쓰고 괄호에 원어'], ['링크', 'UTM 링크, 첫 댓글', 'UTM 링크, 본문 끝'], ['해시태그', '3~5개', '1~3개']]
        .map(r => el('tr', {}, r.map(c => el('td', { text: c })))))]);
    root.appendChild(el('div', { cls: 'grid2' }, [
      el('section', { cls: 'sec' }, [secHead('필러별 진행', el('span', { cls: 'note', text: '옅은 막대 = 계획 · 진한 막대 = 게시 완료' })), mix]),
      el('section', { cls: 'sec' }, [secHead('톤 가이드 · LinkedIn → Facebook'), el('div', { cls: 'hscroll' }, [tone])])
    ]));
  }
  function calendar() {
    const month = ui.calMonth || TODAY.slice(0, 7);
    const [Y, M] = month.split('-').map(Number);
    const first = new Date(Y, M - 1, 1), last = new Date(Y, M, 0);
    const start = addDays(ymd(first), -first.getDay()), end = addDays(ymd(last), 6 - last.getDay());
    const shift = n => { const d = new Date(Y, M - 1 + n, 1); ui.calMonth = ymd(d).slice(0, 7); refresh(); };
    const toggle = (key, label) => { const c = checkIn(ui[key], v => { ui[key] = v; refresh(); }, { id: 'cal-' + key, label }); c.disabled = false; return el('label', { cls: 'cal-toggle', for: 'cal-' + key }, [c, label]); };
    const foldCal = () => { ui.calHidden = !ui.calHidden; try { localStorage.setItem('nets.calHidden', ui.calHidden ? '1' : ''); } catch (e) { } refresh(); };
    const fold = el('button', { type: 'button', cls: 'btn ghost sm', 'aria-expanded': String(!ui.calHidden), text: ui.calHidden ? '▸ 달력 펼치기' : '▾ 달력 접기', onclick: foldCal });
    const bar = el('div', { cls: 'cal-bar' }, [
      el('h2', { text: Y + '년 ' + M + '월' }),
      el('button', { type: 'button', cls: 'btn ghost icon', 'aria-label': '이전 달', text: '‹', onclick: () => shift(-1) }),
      el('button', { type: 'button', cls: 'btn sm', text: '오늘', onclick: () => { ui.calMonth = null; refresh(); } }),
      el('button', { type: 'button', cls: 'btn ghost icon', 'aria-label': '다음 달', text: '›', onclick: () => shift(1) }),
      el('span', { cls: 'spacer' }), fold
    ]);
    if (ui.calHidden) return el('section', { cls: 'sec' }, [bar]);
    // 보기 설정: 업무 표시 여부(영역·종류·담당·검색은 페이지 위 필터를 따른다), 게시물·제작 마감 표시
    const postsHere = ui.area === '전체' || ui.area === 'SNS'; // SNS가 아닌 영역 탭에서는 게시물을 빼고 그 영역 업무만
    const showPosts = ui.calPosts && postsHere;
    const filters = el('div', { cls: 'filters cal-filters' }, [
      toggle('calShowTasks', '업무'), postsHere ? toggle('calPosts', 'SNS 게시물') : null, showPosts ? toggle('calProd', '제작·승인 마감') : null,
      ui.calShowTasks ? el('span', { cls: 'cal-legend' }, cfg('areas').filter(a => ui.area === '전체' || a === ui.area).map(a => el('span', {}, [el('span', { cls: 'sw', style: 'background:var(--' + tagc('area', a) + ')' }), a]))) : null
    ]);
    const byDate = {}; const add = (d, x) => { (byDate[d] = byDate[d] || []).push(x); };
    if (showPosts) [...S.posts].sort((a, b) => (num(a.no) || 0) - (num(b.no) || 0)).forEach(p => {
      add(p.date, { type: 'post', p });
      if (ui.calProd && !isPostDrop(p) && !prodDone(p)) add(prodDeadline(p), { type: 'prod', p });
    });
    if (ui.calShowTasks) S.tasks.filter(t => t.due && taskMatches(t))
      .sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || (a.priority || 'P9').localeCompare(b.priority || 'P9'))
      .forEach(t => add(t.due, { type: 'task', t }));
    const grid = el('div', { cls: 'cal', role: 'grid', 'aria-label': Y + '년 ' + M + '월 게시 달력' });
    DAYS.forEach((d, i) => grid.appendChild(el('div', { cls: 'cal-dow' + (i === 0 ? ' sun' : ''), text: d })));
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const dt = P(d), out = dt.getMonth() !== M - 1, dow = dt.getDay();
      const cell = el('div', { cls: 'cal-cell' + (out ? ' out' : '') + (d === TODAY ? ' today' : '') + (dow === 0 ? ' sun' : ''), role: 'gridcell', 'data-date': d });
      const plus = el('button', { type: 'button', cls: 'cal-add', 'aria-label': md(d) + ' 새로 만들기', title: '이 날짜에 업무·게시물 만들기', text: '+', disabled: !online });
      plus.addEventListener('click', e => { e.stopPropagation(); newOnDayMenu(plus, d); });
      cell.appendChild(plus);
      cell.appendChild(el('div', { cls: 'cal-num' }, [el('b', { text: dt.getDate() === 1 ? (dt.getMonth() + 1) + '월 1일' : String(dt.getDate()) })]));
      cfg('events').forEach(e => {
        if (d < e.start || d > e.end) return;
        const s = d === e.start, en = d === e.end;
        cell.appendChild(el('div', { cls: 'cal-ev' + (s ? ' s' : '') + (en ? ' e' : ''), title: e.label + ' ' + md(e.start) + (e.end !== e.start ? ' ~ ' + md(e.end) : ''), text: (s || dow === 0) ? e.label : ' ', onclick: () => go('settings') }));
      });
      // 노션처럼 칸이 넘치면 일부만 보이고 「＋N개 더」로 펼친다 (게시물·제작 마감은 항상 보임)
      const dayItems = byDate[d] || [], CAP = 6;
      const tasksOnly = dayItems.filter(x => x.type === 'task');
      const openDay = ui.calOpenDays.has(d);
      const hidden = !openDay && tasksOnly.length > CAP ? new Set(tasksOnly.slice(CAP - 1)) : new Set();
      dayItems.filter(x => !hidden.has(x)).forEach(x => {
        if (x.type === 'post') {
          const p = x.p, done = isPostDone(p), late = p.date < TODAY && !done && !isPostDrop(p);
          const c = el('div', { cls: 'ci ci-post' + (done ? ' done' : '') + (isPostDrop(p) ? ' drop' : '') + (late ? ' late' : ''), draggable: online ? 'true' : null, tabindex: 0, role: 'button',
            title: p.id + ' · ' + p.pillar + ' · ' + p.status + ' · ' + CHANNELS.filter(C => chOn(p, C.k)).map(C => C.label + (chDone(p, C.k) ? ' ✓' : '')).join('·') + (p.approval ? ' · 공개 동의 필요' : '') + '\n' + (p.topic || '제목 없음'),
            onclick: e => { e.stopPropagation(); openPeek('post', p.id); }, onkeydown: e => { if (e.key === 'Enter') openPeek('post', p.id); } }, [
            el('div', { cls: 'ci-t' }, [el('span', { cls: 'dot', style: 'background:' + pillarColor(p.pillar) }), el('span', { text: (done ? '✓ ' : '') + (p.topic || '제목 없음') })]),
            el('div', { cls: 'ci-meta' }, [tagEl(p.status, 'postStatus'),
              ...CHANNELS.filter(C => chOn(p, C.k)).map(C => el('span', { cls: 'ch-mini ch-' + C.k + (chDone(p, C.k) ? ' done' : ''), title: C.label + (chDone(p, C.k) ? ' 게시 완료' : ' 게시 예정'), text: C.short }))])
          ]);
          c.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', 'post:' + p.id); e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging'); });
          c.addEventListener('dragend', () => c.classList.remove('dragging'));
          cell.appendChild(c);
        } else if (x.type === 'prod') {
          const late = d < TODAY;
          cell.appendChild(el('div', { cls: 'ci ci-prod' + (late ? ' late' : ''), role: 'button', tabindex: 0, title: '제작·승인 요청 마감 → ' + md(x.p.date) + ' 게시\n' + x.p.topic, text: '✎ 제작 마감 · ' + x.p.id, onclick: e => { e.stopPropagation(); openPeek('post', x.p.id); } }));
        } else {
          const t = x.t, done = isTaskDone(t), late = t.due < TODAY && !done && !isTaskOff(t);
          const mark = { '마일스톤': '◆ ', '확인': '☐ ' }[t.kind] || '';
          const c = el('div', { cls: 'ci ci-task t-' + tagc('area', t.area) + (done ? ' done' : '') + (late ? ' late' : '') + (isTaskOff(t) ? ' drop' : ''), draggable: online ? 'true' : null, role: 'button', tabindex: 0,
            title: t.id + ' · ' + t.area + ' · ' + t.status + ' · ' + (t.owner || '') + (t.parent ? ' · ' + t.parent : '') + '\n' + (t.title || '제목 없음'),
            text: (done ? '✓ ' : mark) + (t.title || '제목 없음'), onclick: e => { e.stopPropagation(); openPeek('task', t.id); }, onkeydown: e => { if (e.key === 'Enter') openPeek('task', t.id); } });
          c.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', 'task:' + t.id); e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging'); });
          c.addEventListener('dragend', () => c.classList.remove('dragging'));
          cell.appendChild(c);
        }
      });
      if (hidden.size || (openDay && tasksOnly.length > CAP)) {
        cell.appendChild(el('button', { type: 'button', cls: 'ci-more', text: openDay ? '접기' : '＋ ' + hidden.size + '개 더', onclick: e => { e.stopPropagation(); openDay ? ui.calOpenDays.delete(d) : ui.calOpenDays.add(d); refresh(); } }));
      }
      cell.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/plain')) { e.preventDefault(); cell.classList.add('over'); } });
      cell.addEventListener('dragleave', () => cell.classList.remove('over'));
      cell.addEventListener('drop', e => {
        e.preventDefault(); cell.classList.remove('over');
        const v = e.dataTransfer.getData('text/plain');
        if (v.startsWith('post:')) { const p = postById(v.slice(5)); if (p) movePost(p, d); }
        if (v.startsWith('task:')) { const t = taskById(v.slice(5)); if (t && t.due !== d) { t.due = d; if (t.start && t.start > d) t.start = d; commit('tasks', true); } }
      });
      grid.appendChild(cell);
    }
    return el('section', { cls: 'sec' }, [bar, filters, el('div', { cls: 'cal-wrap' }, [grid]),
      el('p', { cls: 'note', text: '날짜 칸의 ＋로 업무·게시물 만들기 · 카드를 끌어 날짜 이동 · ✎ 제작 마감: 화요일 게시물은 직전 금요일, 목요일 게시물은 그 주 월요일 (게시물 상태를 승인대기로 바꾸면 사라짐)' })]);
  }
  function newOnDayMenu(anchor, d) {
    const area = ui.area !== '전체' ? ui.area : undefined;
    openMenu(anchor, [
      { head: md(d) + '에 만들기' },
      { label: '업무', run: () => createTask({ kind: '업무', due: d, area }) },
      { label: '확인·결정', run: () => createTask({ kind: '확인', due: d, area }) },
      { label: 'SNS 게시물', run: () => createPost(d) },
      { sep: true }, { head: '마일스톤 — 상위 업무 선택' },
      ...S.tasks.filter(t => isRoot(t) && t.kind === '업무' && (t.event || childrenOf(t.id).length)).map(r => ({ label: r.id + ' ' + r.title, run: () => createTask({ kind: '마일스톤', parent: r.id, due: d }) }))
    ]);
  }
  function postsTable() {
    const segBtn = (group, val) => el('button', { type: 'button', 'aria-pressed': String(ui[group] === val), text: val, onclick: () => { ui[group] = val; refresh(); } });
    const filters = el('div', { cls: 'filters' }, [el('div', { cls: 'seg' }, ['전체', ...cfg('pillars')].map(v => segBtn('pillar', v))), el('div', { cls: 'seg' }, ['전체', '미게시', '게시완료'].map(v => segBtn('pstatus', v))),
      el('div', { cls: 'seg' }, ['전체 채널', ...CHANNELS.map(c => c.label)].map(v => segBtn('pchannel', v)))]);
    let list = [...S.posts].sort((a, b) => a.date.localeCompare(b.date) || (num(a.no) || 0) - (num(b.no) || 0));
    // 채널 필터: 그 채널에 올리는 게시물만. 미게시·게시완료도 그 채널 기준
    const PC = chOf(ui.pchannel);
    if (PC) list = list.filter(p => chOn(p, PC.k));
    if (ui.pillar !== '전체') list = list.filter(p => p.pillar === ui.pillar);
    const pDone = p => PC ? chDone(p, PC.k) : isPostDone(p);
    if (ui.pstatus === '미게시') list = list.filter(p => !pDone(p) && !isPostDrop(p));
    if (ui.pstatus === '게시완료') list = list.filter(pDone);
    // 주제를 입력 중인 새 게시물은 맨 아래에 (입력을 마치면 게시일 순서 자리로)
    const ed = list.find(p => isEditing('post', p.id)); if (ed) list = list.filter(p => p !== ed).concat(ed);
    const tb = el('tbody');
    if (!list.length) tb.appendChild(el('tr', {}, [el('td', { colspan: 10, cls: 'empty', text: '조건에 맞는 게시물이 없습니다.' })]));
    list.forEach(p => {
      const late = p.date < TODAY && !isPostDone(p) && !isPostDrop(p);
      const sel = ui.peek && ui.peek.type === 'post' && ui.peek.id === p.id;
      tb.appendChild(el('tr', { cls: 'r' + (sel ? ' sel' : '') + (isPostDone(p) ? ' done' : ''), tabindex: 0, onclick: () => openPeek('post', p.id), onkeydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) openPeek('post', p.id); } }, [
        el('td', { cls: 'num note', text: String(p.no) }),
        el('td', { cls: late ? 'late' : '' }, [dateIn(p.date, v => { if (v) movePost(p, v); }, { typed: true, id: 'pt-d-' + p.id, cls: 'cell-in', label: p.id + ' 게시일' })]),
        el('td', {}, [tagSelect(cfg('pillars'), p.pillar, 'pillar', v => { p.pillar = v; commit('posts', true); }, { id: 'pt-pl-' + p.id, label: '필러' })]),
        el('td', {}, [chChips(p, 'pt')]),
        el('td', { cls: 'c-name' }, [el('div', { cls: 'name-wrap' }, [isEditing('post', p.id) ? inlineTitle('post', p, 'topic', '주제 입력 후 Enter') : nameSpan('post', p, 'topic'), p.approval ? el('span', { cls: 'tag t-yellow', text: '동의 필요' }) : null, el('span', { cls: 'open-btn', text: '열기' })])]),
        el('td', { cls: 'note', text: p.format || '', title: p.format || null }), el('td', { cls: 'note', text: p.cta || '', title: p.cta || null }),
        el('td', {}, [tagSelect(cfg('postStatuses'), p.status, 'postStatus', v => setPostStatus(p, v), { id: 'pt-s-' + p.id, label: '상태' })]),
        el('td', { cls: 'num', text: pct(rate(p.li && p.li.eng, p.li && p.li.impr)) }), el('td', { cls: 'num', text: pct(rate(p.fb && p.fb.eng, p.fb && p.fb.reach)) })
      ]));
    });
    tb.appendChild(el('tr', { cls: 'r-add' }, [el('td', { colspan: 10, role: 'button', tabindex: 0, onclick: () => createPost(TODAY), onkeydown: e => { if (e.key === 'Enter') createPost(TODAY); }, text: '＋ 새 게시물' })]));
    const table = el('table', { cls: 'db posts' }, [el('thead', {}, [el('tr', {}, ['#', '게시일', '필러', '채널', '주제', '포맷', 'CTA', '상태', 'LI 참여율', 'FB 참여율'].map(h => el('th', { text: h })))]), tb]);
    resizable(table, 'posts', [{ id: 'no', w: 44, min: 32 }, { id: 'date', w: 132 }, { id: 'pillar', w: 96 }, { id: 'ch', w: 100 }, { id: 'topic', flex: true, min: 200 }, { id: 'format', w: 140 }, { id: 'cta', w: 140 }, { id: 'status', w: 104 }, { id: 'li', w: 86 }, { id: 'fb', w: 86 }]);
    return el('section', { cls: 'sec' }, [secHead('게시물 목록', el('span', { cls: 'note', text: S.posts.length + '건 · 참여율 = (반응+댓글+공유) ÷ 노출(Facebook은 도달)' })), filters, el('div', { cls: 'hscroll' }, [table])]);
  }
  function peekPost(p, body, crumb) {
    crumb.appendChild(crumbBtn('📋 업무', () => { closePeek(true); go('tasks'); }));
    crumb.appendChild(document.createTextNode('/'));
    crumb.appendChild(el('span', { text: p.id + ' · #' + p.no }));
    p.li = p.li || {}; p.fb = p.fb || {};
    const set = (k, v, peekToo) => { p[k] = v; commit('posts', peekToo); };
    body.appendChild(textIn(p.topic, v => set('topic', v), { id: 'pk-title', cls: 'ptitle', multi: true, enterCommits: true, ph: '주제 없음', label: '주제' }));
    const dow = P(p.date).getDay();
    const offDay = !(String((S.config.rules && S.config.rules.postDays) || '화·목').includes(DAYS[dow]));
    const props = el('div', { cls: 'props' });
    const pairs = [
      prop('게시일', dateIn(p.date, v => { if (v) movePost(p, v); }, { typed: true, id: 'pk-date', label: '게시일' }), el('span', { cls: 'hint' + (offDay ? ' warn' : ''), text: DAYS[dow] + '요일' + (offDay ? ' · 화·목이 아님' : '') }),
        el('input', { type: 'time', id: 'pk-time', cls: 'pinput', style: 'width:auto', value: p.time || '', 'aria-label': '게시 시간', disabled: !online, onchange: e => set('time', e.target.value || null) })),
      prop('상태', tagSelect(cfg('postStatuses'), p.status, 'postStatus', v => setPostStatus(p, v), { id: 'pk-status', label: '상태' })),
      prop('채널', chChips(p, 'pk')),
      prop('필러', tagSelect(cfg('pillars'), p.pillar, 'pillar', v => set('pillar', v, true), { id: 'pk-pillar', label: '필러' })),
      prop('단계', plainSelect(['1', '2', '3', '4'].map(v => ({ value: v, label: v + '단계' })), String(p.phase || 1), v => set('phase', Number(v)), { id: 'pk-phase', label: '단계' })),
      prop('포맷', textIn(p.format, v => set('format', v), { id: 'pk-format', ph: '예: 카드뉴스 4장', label: '포맷' })),
      prop('CTA', textIn(p.cta, v => set('cta', v), { id: 'pk-cta', ph: '세미나 참가 문의 · 부스 상담 예약 · 사전진단 문의', label: 'CTA' })),
      prop('원천 자료', textIn(p.source, v => set('source', v), { id: 'pk-source', ph: 'sources/ 자료 이름', label: '원천 자료' })),
      prop('초안 파일', textIn(p.draft, v => set('draft', v), { id: 'pk-draft', ph: 'drafts/' + p.id + '.md', label: '초안 파일' })),
      prop('공개 동의 필요', checkIn(p.approval, v => { p.approval = v; if (v && !p.fallback) p.fallback = '공개 동의가 게시 ' + consentDays() + '일 전까지 없으면 같은 날 인사이트 게시물로 대체'; commit('posts', true); }, { id: 'pk-appr', label: '공개 동의 필요' }),
        p.approval ? el('span', { cls: 'hint' + (addDays(p.date, -consentDays()) <= TODAY && !isPostDone(p) ? ' warn' : ''), text: '동의 요청 마감 ' + md(addDays(p.date, -consentDays())) }) : null),
      (p.approval || p.fallback) ? prop('대체 방안', textIn(p.fallback, v => { if (v) p.fallback = v; else delete p.fallback; commit('posts'); }, { id: 'pk-fallback', ph: '동의가 없을 때', label: '대체 방안' })) : null,
      prop('제작 마감', ro(md(prodDeadline(p)) + (prodDone(p) ? ' · 요청 완료' : prodDeadline(p) < TODAY && !isPostDrop(p) ? ' · 지남' : ''), prodDone(p)))
    ];
    pairs.filter(Boolean).forEach(pair => pair.forEach(x => props.appendChild(x)));
    body.appendChild(props);
    const utm = src => `utm_source=${src}&utm_medium=${(S.config.utm && S.config.utm.medium) || 'social'}&utm_campaign=${(S.config.utm && S.config.utm.campaign) || '2026q4'}&utm_content=${p.id}`;
    // 채널별: 이 채널에 올리는지 · 게시 완료 · 게시 링크 · 첫 문장 · 성과 · UTM
    const channel = (C, hookKey, fields) => {
      const obj = p[C.k], on = chOn(p, C.k), name = C.label;
      const onBox = checkIn(on, v => setChannel(p, C.k, 'on', v), { id: 'pk-' + C.k + '-on', label: name + '에 게시' });
      const doneBox = checkIn(chDone(p, C.k), v => setChannel(p, C.k, 'done', v), { id: 'pk-' + C.k + '-done', label: name + ' 게시 완료' }); doneBox.disabled = !online || !on;
      return el('div', { cls: 'psec ch-sec' + (on ? '' : ' off') }, [
        el('h3', {}, [el('span', { cls: 'dot', style: 'background:' + C.color }), name, on ? el('span', { cls: 'note' }, ['참여율 ', el('b', { text: pct(rate(obj.eng, obj[fields[0][0]])) })]) : el('span', { cls: 'note', text: '이 채널에는 올리지 않음' })]),
        el('div', { cls: 'ch-flags' }, [el('label', { cls: 'cal-toggle', for: 'pk-' + C.k + '-on' }, [onBox, '이 채널에 게시']), el('label', { cls: 'cal-toggle', for: 'pk-' + C.k + '-done' }, [doneBox, '게시 완료'])]),
        on ? textIn(obj.url, v => setChannel(p, C.k, 'url', v), { id: 'pk-' + C.k + '-url', ph: '게시물 링크 (게시 후)', label: name + ' 게시 링크' }) : null,
        on ? textIn(p[hookKey], v => set(hookKey, v), { id: 'pk-' + hookKey, multi: true, raw: true, ph: '첫 문장', label: name + ' 첫 문장' }) : null,
        on ? el('div', { cls: 'mrow' }, fields.map(([k, l]) => el('label', { for: 'pk-' + name + '-' + k }, [l, numIn(obj[k], v => { obj[k] = v; commit('posts', true); }, { id: 'pk-' + name + '-' + k, min: 0, label: name + ' ' + l })]))) : null,
        on ? el('code', { text: utm(C.src) }) : null
      ]);
    };
    body.appendChild(channel(CHANNELS[0], 'liHook', [['impr', '노출'], ['eng', '반응+댓글+공유'], ['clicks', '링크 클릭']]));
    body.appendChild(channel(CHANNELS[1], 'fbHook', [['reach', '도달'], ['eng', '반응+댓글+공유'], ['clicks', '링크 클릭']]));
    const refs = S.tasks.filter(t => (t.posts || []).includes(p.id));
    if (refs.length) body.appendChild(el('div', { cls: 'psec' }, [el('h3', { text: '연결된 업무' }), el('div', { cls: 'rel' }, refs.map(t => el('span', { cls: 'rel-chip' }, [el('button', { type: 'button', cls: 'go', text: t.id + ' ' + t.title, onclick: () => openPeek('task', t.id) })])))]));
    body.appendChild(el('div', { cls: 'psec' }, [el('h3', { text: '메모' }), textIn(p.note, v => set('note', v), { id: 'pk-note', multi: true, rows: 3, raw: true, ph: '대체 소재, 승인 현황, 반응 등', label: '메모' })]));
    body.appendChild(el('div', { cls: 'peek-foot' }, [el('span', { cls: 'note', text: p.id + ' · #' + p.no }),
      el('button', { type: 'button', cls: 'btn danger', text: '삭제', disabled: !online, onclick: () => deletePost(p) })]));
  }

  /* ---------- 보고서: 업무 데이터로 기간·구분별 활동 정리 ---------- */
  const PERIODS = [['thisWeek', '이번 주'], ['lastWeek', '지난 주'], ['thisMonth', '이번 달'], ['lastMonth', '지난 달'], ['quarter', 'Q4 전체'], ['custom', '직접 선택']];
  const RGROUPS = [
    ['area', '영역', t => t.area, () => cfg('areas')],
    ['owner', '담당', t => t.owner, () => cfg('owners')],
    ['kind', '종류', t => t.kind, () => KINDS],
    ['priority', '우선순위', t => t.priority, () => cfg('priorities')],
    ['event', '행사', t => t.event ? eventLabel(t.event) : '행사 외', () => [...cfg('events').map(e => e.label), '행사 외']]
  ];
  function periodRange(rp) {
    rp = rp || ui.rp;
    const p = rp.period, ws = weekStart(TODAY), d = P(TODAY);
    if (p === 'thisWeek') return [ws, addDays(ws, 6)];
    if (p === 'lastWeek') return [addDays(ws, -7), addDays(ws, -1)];
    if (p === 'thisMonth') return [ymd(new Date(d.getFullYear(), d.getMonth(), 1)), ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
    if (p === 'lastMonth') return [ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)), ymd(new Date(d.getFullYear(), d.getMonth(), 0))];
    if (p === 'quarter') return [(S.config.range && S.config.range.start) || TODAY, (S.config.range && S.config.range.end) || TODAY];
    let f = rp.from || ws, t = rp.to || addDays(ws, 6);
    if (t < f) [f, t] = [t, f];
    return [f, t];
  }
  // 완료일: 대시보드에서 완료하면 doneAt이 남는다. 없으면 마감일로 본다
  const doneDate = t => isTaskDone(t) ? (t.doneAt || t.due || null) : null;
  // area: 영역 하나만 볼 때 (없거나 '전체'면 모두). SNS 게시물은 전체·SNS 영역에서만 센다
  const areaOk = (area, t) => !area || area === '전체' || t.area === area;
  const postsIn = area => !area || area === '전체' || area === 'SNS';
  function reportData(from, to, area) {
    const inR = d => !!d && d >= from && d <= to;
    const tasks = S.tasks.filter(t => areaOk(area, t));
    const due = tasks.filter(t => inR(t.due) && !isTaskOff(t));
    const done = tasks.filter(t => inR(doneDate(t)));
    const late = due.filter(t => !isTaskDone(t) && t.due < TODAY);
    const posts = postsIn(area) ? S.posts.filter(p => inR(p.date) && !isPostDrop(p)) : [];
    // 이행률은 오늘까지 마감이 온 업무로만 계산 (미래 마감은 아직 평가하지 않는다)
    return { inR, area: area && area !== '전체' ? area : null, due, duePast: due.filter(t => t.due <= TODAY), done, late, posts, postsDone: posts.filter(isPostDone), postsPast: posts.filter(p => p.date <= TODAY) };
  }
  // 다음 기간 예정도 영역에 맞춰 거른다
  const agendaFor = area => agenda().filter(i => !area || (i.ref.type === 'task' ? (taskById(i.ref.id) || {}).area === area : area === 'SNS'));
  function renderReportPage(root, after) {
    if (ui.rp.area !== '전체' && !cfg('areas').includes(ui.rp.area)) ui.rp.area = '전체';
    const [from, to] = periodRange(), R = reportData(from, to, ui.rp.area), len = diff(from, to) + 1;
    const G = RGROUPS.find(g => g[0] === ui.rp.group) || RGROUPS[0];
    root.appendChild(pageHead('📊', '보고서' + (R.area ? ' · ' + R.area : ''), '업무 탭에 쌓인 데이터로 영역·기간·구분별 활동을 자동으로 정리합니다. 영역 하나만 골라 그 영역 보고서로 낼 수도 있습니다. 오른쪽 위 버튼으로 Excel·PDF로 발행하거나 보고 문구를 복사합니다.'));

    const seg = el('div', { cls: 'seg' }, PERIODS.map(([v, l]) => el('button', { type: 'button', 'aria-pressed': String(ui.rp.period === v), text: l, onclick: () => { ui.rp.period = v; if (v === 'custom' && !ui.rp.from) { ui.rp.from = from; ui.rp.to = to; } ui.rpOpen.clear(); refresh(); } })));
    const custom = ui.rp.period === 'custom' ? el('span', { cls: 'filters' }, [
      dateIn(from, v => { ui.rp.from = v; refresh(); }, { id: 'rp-from', cls: 'search', label: '시작일' }), '~',
      dateIn(to, v => { ui.rp.to = v; refresh(); }, { id: 'rp-to', cls: 'search', label: '종료일' })]) : null;
    if (custom) custom.querySelectorAll('input').forEach(i => { i.disabled = false; });
    const gsel = plainSelect(RGROUPS.map(g => ({ value: g[0], label: g[1] + '별' })), ui.rp.group, v => { ui.rp.group = v; ui.rpOpen.clear(); refresh(); }, { id: 'rp-group', cls: '', label: '묶음 기준' });
    gsel.disabled = false;
    const asel = plainSelect(['전체', ...cfg('areas')], ui.rp.area, v => { ui.rp.area = v; ui.rpOpen.clear(); refresh(); }, { id: 'rp-area', cls: '', label: '영역' });
    asel.disabled = false;
    const copy = el('button', { type: 'button', cls: 'btn', text: '보고 문구 복사' });
    copy.addEventListener('click', () => copyText(reportText(from, to, R, G), copy));
    // 발행: 지금 고른 영역·기간·묶음 그대로 (보고서 요약 + 보고 문구, 원하면 해당 업무 목록까지)
    const pub = el('button', { type: 'button', cls: 'btn primary', text: '발행 ▾' });
    pub.addEventListener('click', () => openMenu(pub, [{ head: (R.area || '전체') + ' · ' + mdShort(from) + '~' + mdShort(to) },
      { label: '⤓ Excel — 요약 + 보고 문구 + 업무 목록', run: () => publishReport('xlsx') },
      { label: '🖨 PDF — 요약 + 보고 문구 + 업무 목록', run: () => publishReport('pdf') },
      { label: '🖨 PDF — 요약 + 보고 문구만', run: () => publishReport('pdf', true) },
      { sep: true }, { label: '열·필터를 직접 골라 내보내기…', run: () => openExport('report') }]));
    root.appendChild(el('div', { cls: 'toolbar' }, [el('div', { cls: 'filters' }, [seg, custom,
      el('label', { cls: 'fpill' + (ui.rp.area !== '전체' ? ' on' : ''), for: 'rp-area' }, ['영역', asel]),
      el('label', { cls: 'fpill on', for: 'rp-group' }, ['묶음', gsel])]), el('div', { cls: 'filters' }, [copy, pub])]));
    root.appendChild(el('p', { cls: 'note rp-range', text: md(from) + ' ~ ' + md(to) + ' · ' + len + '일' + (to >= TODAY && from <= TODAY ? ' · 오늘까지 진행 중' : '') }));

    const pastDone = R.duePast.filter(isTaskDone);
    const r = R.duePast.length ? pastDone.length / R.duePast.length : null;
    const checks = R.done.filter(t => t.kind === '확인').length, miles = R.done.filter(t => t.kind === '마일스톤').length;
    root.appendChild(el('div', { cls: 'kpis' }, [
      kpi('완료한 일', String(R.done.length), '업무 ' + (R.done.length - checks - miles) + ' · 마일스톤 ' + miles + ' · 확인 ' + checks),
      kpi('마감 이행률', r == null ? '—' : Math.round(r * 100) + '%', R.duePast.length ? '오늘까지 마감 ' + R.duePast.length + '건 중 ' + pastDone.length + '건 완료' : '아직 마감이 온 업무 없음 · 기간 내 마감 ' + R.due.length + '건', r == null ? '' : r >= .9 ? 'ok' : r >= .7 ? 'warn' : 'bad'),
      kpi('늦어진 일', String(R.late.length), R.late.length ? '가장 오래된 것 ' + md(R.late.map(t => t.due).sort()[0]) : '없음', R.late.length ? 'bad' : 'ok'),
      kpi('SNS 게시', R.postsDone.length + ' / ' + R.posts.length, R.postsPast.length ? '예정일 지난 ' + R.postsPast.length + '건 중 ' + R.postsPast.filter(isPostDone).length + '건 게시' : '기간 내 예정일 지난 게시물 없음')
    ]));

    // 구분별 표
    const keys = G[3]().concat([...new Set([...R.due, ...R.done].map(G[2]))].filter(k => k != null && !G[3]().includes(k)));
    const tb = el('tbody');
    let anyRow = false;
    keys.forEach(k => {
      const due = R.due.filter(t => G[2](t) === k), done = R.done.filter(t => G[2](t) === k);
      if (!due.length && !done.length) return;
      anyRow = true;
      const past = due.filter(t => t.due <= TODAY);
      const dd = due.filter(isTaskDone).length, late = due.filter(t => !isTaskDone(t) && t.due < TODAY).length, rr = past.length ? past.filter(isTaskDone).length / past.length : null;
      const open = ui.rpOpen.has(k), toggle = () => { open ? ui.rpOpen.delete(k) : ui.rpOpen.add(k); refresh(); };
      tb.appendChild(el('tr', { cls: 'r', tabindex: 0, 'aria-expanded': String(open), onclick: toggle, onkeydown: e => { if (e.key === 'Enter') toggle(); } }, [
        el('td', { cls: 'c-name' }, [el('div', { cls: 'name-wrap' }, [el('span', { cls: 'tog', text: open ? '▾' : '▸' }), G[0] === 'event' || G[0] === 'kind' ? el('span', { cls: 'name', text: k }) : tagEl(k, G[0] === 'area' ? 'area' : G[0])])]),
        el('td', { cls: 'num r', text: String(due.length) }), el('td', { cls: 'num r', text: String(dd) }),
        el('td', { cls: 'num r' + (late ? ' hot' : ''), text: String(late) }),
        el('td', {}, [rr == null ? el('span', { cls: 'note', text: '—' }) : el('span', { cls: 'rp-rate' }, [el('span', { cls: 'bar' }, [el('i', { style: 'width:' + rr * 100 + '%;background:var(--chart-done)' })]), Math.round(rr * 100) + '%'])]),
        el('td', { cls: 'num r', text: String(done.length) })
      ]));
      if (open) {
        const items = [...new Set([...due, ...done])].sort((a, b) => (a.due || '').localeCompare(b.due || ''));
        items.forEach(t => {
          const tl = t.due && t.due < TODAY && !isTaskDone(t) && !isTaskOff(t);
          tb.appendChild(el('tr', { cls: 'r sub' + (isTaskDone(t) ? ' done' : ''), tabindex: 0, onclick: () => openPeek('task', t.id), onkeydown: e => { if (e.key === 'Enter') openPeek('task', t.id); } }, [
            el('td', { cls: 'c-name child' }, [el('div', { cls: 'name-wrap' }, [el('span', { cls: 'name', text: t.title || '제목 없음' }), el('span', { cls: 'idt', text: t.id })])]),
            el('td', { cls: 'note num' + (tl ? ' hot' : ''), colspan: 2, text: '마감 ' + md(t.due) }),
            el('td', { colspan: 2 }, [tagEl(t.status, 'taskStatus'), isTaskDone(t) ? el('span', { cls: 'note', text: ' ' + md(doneDate(t)) + (t.doneAt ? ' 완료' : ' (완료일 기록 없음)') }) : null]),
            el('td', { cls: 'note', text: t.owner || '' })
          ]));
        });
      }
    });
    if (!anyRow) tb.appendChild(el('tr', {}, [el('td', { colspan: 6, cls: 'empty', text: '이 기간에 마감되거나 완료된 업무가 없습니다.' })]));
    root.appendChild(el('section', { cls: 'sec' }, [secHead(G[1] + '별 정리', el('span', { cls: 'note', text: '행을 누르면 해당 업무가 펼쳐집니다' })),
      el('div', { cls: 'hscroll' }, [el('table', { cls: 'db rp' }, [el('thead', {}, [el('tr', {}, [['구분'], ['기간 내 마감', 'r'], ['마감 중 완료', 'r'], ['늦음', 'r'], ['이행률 (오늘까지 마감 기준)'], ['기간 중 완료', 'r']].map(([h, c]) => el('th', { cls: c, text: h })))]), tb])])]));

    // 주별 추이 (2주 이상일 때)
    if (len >= 14) {
      const box = el('div', { cls: 'rp-chart' });
      const weeks = [];
      for (let w = weekStart(from); w <= to; w = addDays(w, 7)) {
        const we = addDays(w, 6), inW = d => !!d && d >= w && d <= we && d >= from && d <= to;
        const due = S.tasks.filter(t => inW(t.due) && !isTaskOff(t));
        const ps = S.posts.filter(p => inW(p.date) && !isPostDrop(p));
        weeks.push({ w, done: due.filter(isTaskDone).length, open: due.filter(t => !isTaskDone(t)).length, posts: ps.length, postsDone: ps.filter(isPostDone).length, current: TODAY >= w && TODAY <= we });
      }
      const table = el('table', { cls: 'tone' }, [el('thead', {}, [el('tr', {}, ['주 (월요일)', '마감', '완료', '남음', 'SNS 게시'].map(h => el('th', { text: h })))]),
        el('tbody', {}, weeks.map(x => el('tr', {}, [mdShort(x.w) + (x.current ? ' (이번 주)' : ''), x.done + x.open, x.done, x.open, x.postsDone + ' / ' + x.posts].map(v => el('td', { cls: 'num', text: String(v) })))))]);
      root.appendChild(el('section', { cls: 'sec' }, [secHead('주별 추이', el('span', { cls: 'legend' }, [el('span', {}, [el('span', { cls: 'sw', style: 'background:var(--chart-done)' }), '완료']), el('span', {}, [el('span', { cls: 'sw', style: 'background:var(--chart-open)' }), '남음'])])),
        box, el('details', { cls: 'rp-table' }, [el('summary', { text: '표로 보기' }), el('div', { cls: 'hscroll' }, [table])])]));
      after.push(() => drawWeekChart(box, weeks));
    }

    // 활동 내역 + 다음 기간
    const log = el('div', { cls: 'list' });
    const acts = [...R.done.map(t => ({ date: doneDate(t), t })), ...R.postsDone.map(p => ({ date: p.date, p }))].sort((a, b) => b.date.localeCompare(a.date));
    let last = null;
    acts.forEach(a => {
      if (a.date !== last) { log.appendChild(el('div', { cls: 'log-day', text: md(a.date) })); last = a.date; }
      if (a.t) log.appendChild(el('div', { cls: 'item', role: 'button', tabindex: 0, onclick: () => openPeek('task', a.t.id), onkeydown: e => { if (e.key === 'Enter') openPeek('task', a.t.id); } },
        [el('div', { cls: 'd', text: a.t.id }), el('div', { cls: 't' }, [a.t.title || '제목 없음', el('small', { text: a.t.kind + ' · ' + (a.t.owner || '') + (a.t.doneAt ? '' : ' · 완료일 기록 없음(마감일 기준)') })]), tagEl(a.t.area, 'area')]));
      else log.appendChild(el('div', { cls: 'item', role: 'button', tabindex: 0, onclick: () => openPeek('post', a.p.id), onkeydown: e => { if (e.key === 'Enter') openPeek('post', a.p.id); } },
        [el('div', { cls: 'd', text: a.p.id }), el('div', { cls: 't' }, [a.p.topic, el('small', { text: 'SNS 게시 · ' + a.p.pillar })]), tagEl('SNS 게시', 'x-post')]));
    });
    if (!acts.length) log.appendChild(el('div', { cls: 'empty', text: '이 기간에 완료한 일이 아직 없습니다.' }));
    const nf = addDays(to, 1), nt = addDays(to, len);
    const next = agendaFor(R.area).filter(i => i.date >= nf && i.date <= nt && !i.done);
    const nl = el('div', { cls: 'list' });
    next.slice(0, 20).forEach(i => nl.appendChild(itemRow(i, false)));
    if (next.length > 20) nl.appendChild(el('div', { cls: 'note', text: '외 ' + (next.length - 20) + '건' }));
    if (!next.length) nl.appendChild(el('div', { cls: 'empty', text: '다음 기간에 마감되는 항목이 없습니다.' }));
    root.appendChild(el('div', { cls: 'grid2' }, [
      el('section', { cls: 'sec' }, [secHead('활동 내역', el('span', { cls: 'note', text: '완료한 업무 · 게시한 SNS, 최근 순' })), log]),
      el('section', { cls: 'sec' }, [secHead('다음 기간 예정', el('span', { cls: 'note', text: md(nf) + ' ~ ' + md(nt) })), nl])
    ]));
  }
  // 주별 누적 막대: 아래 완료, 위 남음. 위쪽 끝만 둥글게, 조각 사이 2px 틈
  function drawWeekChart(box, weeks) {
    box.textContent = '';
    const W = Math.max(320, box.clientWidth || 700), H = 200, L = 32, R = 8, T = 12, B = 26, NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', '주별 마감 업무: 완료와 남음');
    const mk = (t, a, parent) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); (parent || svg).appendChild(e); return e; };
    const max = Math.max(4, ...weeks.map(w => w.done + w.open));
    const step = max <= 8 ? 2 : max <= 20 ? 5 : 10, top = Math.ceil(max / step) * step;
    const y = v => T + (H - T - B) * (1 - v / top), base = y(0);
    for (let v = 0; v <= top; v += step) { mk('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: 'var(--line)', 'stroke-width': 1 }); const t = mk('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 10.5, fill: 'var(--muted)' }); t.textContent = v; }
    const slot = (W - L - R) / weeks.length, bw = Math.min(36, slot * .56);
    const topPath = (x, y0, w, h) => { const r = Math.min(4, h, w / 2); return `M${x} ${y0 + h} V${y0 + r} Q${x} ${y0} ${x + r} ${y0} H${x + w - r} Q${x + w} ${y0} ${x + w} ${y0 + r} V${y0 + h} Z`; };
    weeks.forEach((wk, i) => {
      const cx = L + slot * i + slot / 2, x = cx - bw / 2;
      const hd = base - y(wk.done), ho = base - y(wk.open);
      if (wk.done) { if (wk.open) mk('rect', { x, y: base - hd, width: bw, height: hd, fill: 'var(--chart-done)' }); else mk('path', { d: topPath(x, base - hd, bw, hd), fill: 'var(--chart-done)' }); }
      if (wk.open) { const gap = wk.done ? 2 : 0; mk('path', { d: topPath(x, base - hd - gap - ho, bw, ho), fill: 'var(--chart-open)' }); }
      if (weeks.length <= 16 || i % 2 === 0) { const t = mk('text', { x: cx, y: H - 8, 'text-anchor': 'middle', 'font-size': 10.5, fill: wk.current ? 'var(--ink)' : 'var(--muted)', 'font-weight': wk.current ? 600 : 400 }); t.textContent = mdShort(wk.w); }
      const hit = mk('rect', { x: L + slot * i, y: T, width: slot, height: H - T - B, fill: 'transparent' });
      const label = mdShort(wk.w) + ' 주' + (wk.current ? ' (이번 주)' : '') + '\n마감 ' + (wk.done + wk.open) + ' · 완료 ' + wk.done + ' · 남음 ' + wk.open + '\nSNS 게시 ' + wk.postsDone + ' / ' + wk.posts;
      hit.addEventListener('mousemove', ev => showTip(ev, label)); hit.addEventListener('mouseleave', hideTip);
    });
    mk('line', { x1: L, x2: W - R, y1: base, y2: base, stroke: 'var(--line-strong)' });
    box.appendChild(svg);
  }
  function reportText(from, to, R, G) {
    const pd = R.duePast.filter(isTaskDone).length;
    const L = [`## 마케팅 활동 보고${R.area ? ' · ' + R.area : ''} (${md(from)} ~ ${md(to)})`, '',
      `- 완료한 일 ${R.done.length}건 · 마감 이행률 ${R.duePast.length ? Math.round(pd / R.duePast.length * 100) + '%' : '—'} (오늘까지 마감 ${pd}/${R.duePast.length}) · 늦어진 일 ${R.late.length}건 · SNS 게시 ${R.postsDone.length}/${R.posts.length}`, '', `### ${G[1]}별`];
    const keys = [...new Set([...R.due, ...R.done].map(G[2]))];
    G[3]().filter(k => keys.includes(k)).concat(keys.filter(k => !G[3]().includes(k))).forEach(k => {
      const due = R.due.filter(t => G[2](t) === k), done = R.done.filter(t => G[2](t) === k);
      L.push(`- ${k}: 마감 ${due.length}건 중 ${due.filter(isTaskDone).length}건 완료` + (due.filter(t => !isTaskDone(t) && t.due < TODAY).length ? `, 늦음 ${due.filter(t => !isTaskDone(t) && t.due < TODAY).length}건` : '') + ` · 기간 중 완료 ${done.length}건`);
    });
    L.push('', '### 완료한 일');
    const acts = [...R.done.map(t => [doneDate(t), `${t.id} ${t.title}`]), ...R.postsDone.map(p => [p.date, `SNS ${p.id} ${p.topic}`])].sort((a, b) => a[0].localeCompare(b[0]));
    if (!acts.length) L.push('- 없음'); acts.forEach(([d, s]) => L.push(`- ${mdShort(d)} ${s}`));
    if (R.late.length) { L.push('', '### 늦어진 일'); R.late.sort((a, b) => a.due.localeCompare(b.due)).forEach(t => L.push(`- ${mdShort(t.due)} ${t.id} ${t.title} (${t.owner || ''})`)); }
    const len = diff(from, to) + 1, nf = addDays(to, 1), nt = addDays(to, len);
    const next = agendaFor(R.area).filter(i => i.date >= nf && i.date <= nt && !i.done);
    L.push('', `### 다음 기간 (${md(nf)} ~ ${md(nt)})`);
    if (!next.length) L.push('- 없음'); next.forEach(i => L.push(`- ${mdShort(i.date)} ${i.title}`));
    return L.join('\n');
  }
  async function copyText(text, btn) {
    let okc = false;
    try { await navigator.clipboard.writeText(text); okc = true; } catch (e) {
      const ta = el('textarea', { style: 'position:fixed;left:-9999px' }); ta.value = text; document.body.appendChild(ta); ta.select();
      try { okc = document.execCommand('copy'); } catch (x) { } ta.remove();
    }
    const t = btn.textContent; btn.textContent = okc ? '복사됨 ✓' : '복사 실패'; setTimeout(() => { btn.textContent = t; }, 1600);
  }

  /* ---------- 지표 ---------- */
  const MFIELDS = [['li', 'LinkedIn 팔로워'], ['fb', 'Facebook 팔로워'], ['sem', '세미나 문의(SNS)'], ['booth', '부스 예약(SNS)'], ['lead', '사전진단·도입 문의']];
  function addMetric() {
    if (!online) return;
    let d = TODAY;
    if (S.metrics.some(m => m.date === d)) { alert(md(d) + ' 기록이 이미 있습니다. 표에서 그 줄을 고치거나 기준일을 바꿔 주세요.'); return; }
    S.metrics.push({ date: d, li: null, fb: null, sem: null, booth: null, lead: null });
    S.metrics.sort((a, b) => a.date.localeCompare(b.date));
    commit('metrics', false, 'mt-li-' + d);
  }
  /* ---------- 회의 (data/meetings.json) ---------- */
  // 형식: { updated, series: [{ id, type, title, weekday, time, everyWeeks, from, until, note }],
  //        meetings: [{ id, series?, type, title, date, time, place, attendees, status, agenda, notes, decisions, actions[{ text, owner, due, done, task? }] }] }
  // 정기 회의(series)는 규칙만 두고, 실제 회의는 날짜마다 한 건씩 meetings에 둔다 (회의록을 회의마다 쓰므로)
  // 할 일(actions)은 회의 안에 두고, 고른 것만 「업무로」 등록한다 → tasks.json에 meeting: 회의 ID로 연결
  function normMeetings(m) {
    m = (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
    if (!Array.isArray(m.series)) m.series = [];
    if (!Array.isArray(m.meetings)) m.meetings = [];
    m.meetings.forEach(x => { if (!Array.isArray(x.actions)) x.actions = []; });
    return m;
  }
  const MT = () => S.meetings.meetings;
  const meetingById = id => MT().find(m => m.id === id);
  const seriesById = id => S.meetings.series.find(s => s.id === id);
  const isMeetOff = m => m.status === '취소';
  const hasMinutes = m => !!String(m.notes || '').trim() || !!String(m.decisions || '').trim();
  // 회의록을 써야 하는 회의: 오늘까지 열렸고(취소 아님) 주요 내용·결정 사항이 비어 있음
  const needsMinutes = m => !isMeetOff(m) && m.date <= TODAY && !hasMinutes(m);
  const actTask = a => a.task ? taskById(a.task) : null; // 업무를 지웠으면 null → 다시 등록할 수 있다
  const actDone = a => { const t = actTask(a); return t ? isTaskDone(t) : !!a.done; };
  const meetSort = (a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '');
  const meetName = m => m.title || m.type || '제목 없음';
  const meetWhen = m => md(m.date) + (m.time ? ' ' + m.time : '');
  const saveMeetings = (peekToo, focusId) => { S.meetings.updated = TODAY; commit('meetings', peekToo, focusId); };
  const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0].map(d => ({ value: String(d), label: DAYS[d] + '요일' }));
  const EVERY = [{ value: '1', label: '매주' }, { value: '2', label: '격주' }, { value: '4', label: '4주마다' }];
  TAGS.meetingStatus = { '예정': 'gray', '완료': 'green', '취소': 'brown' };
  TAGS.meetingType = { '주간회의': 'blue', '영업회의': 'green', '마케팅 회의': 'purple', '기타': 'gray' };
  TAGS['x-meet'] = { '회의': 'purple', '회의 할 일': 'pink', '회의록': 'red' };
  function newMeetingId() {
    const n = MT().map(m => Number(String(m.id).replace(/^M-/, '')) || 0).reduce((a, b) => Math.max(a, b), 0) + 1;
    return 'M-' + String(n).padStart(3, '0');
  }
  // 시간 입력: 9:30 · 0930 · 930 · 9 · 14시 30분 · 오후 2시
  function parseTime(s) {
    s = String(s || '').trim(); if (!s) return '';
    const pm = /오후/.test(s); s = s.replace(/오전|오후|\s|분/g, '');
    let h, mi = 0, m;
    if ((m = s.match(/^(\d{1,2})[:.시](\d{1,2})?$/))) { h = +m[1]; mi = +(m[2] || 0); }
    else if ((m = s.match(/^(\d{1,2})(\d{2})$/))) { h = +m[1]; mi = +m[2]; }
    else if ((m = s.match(/^(\d{1,2})$/))) h = +m[1];
    else return null;
    if (pm && h < 12) h += 12;
    return h < 24 && mi < 60 ? pad2(h) + ':' + pad2(mi) : null;
  }
  function timeIn(value, onSet, o) {
    return textIn(value, raw => {
      const v = parseTime(raw);
      if (v === null) { setSave('시간을 읽지 못했습니다: 예) 9:30, 1400, 오후 2시'); return refresh(true); }
      if (v !== (value || '')) onSet(v); else refresh(true);
    }, Object.assign({ ph: '09:00' }, o));
  }

  // 정기 회의 날짜: 시작일 이후 첫 그 요일부터 N주마다, 끝 날짜까지
  function seriesDates(s) {
    const out = []; if (!s.from || !s.until) return out;
    const d = P(s.from); while (d.getDay() !== Number(s.weekday)) d.setDate(d.getDate() + 1);
    const step = 7 * (num(s.everyWeeks) || 1);
    for (let i = 0; ymd(d) <= s.until && i < 400; i++, d.setDate(d.getDate() + step)) out.push(ymd(d));
    return out;
  }
  const seriesMeeting = (s, date) => ({ id: newMeetingId(), series: s.id, type: s.type, title: s.title, date, time: s.time || '', place: '', attendees: '', status: '예정', agenda: '', notes: '', decisions: '', actions: [] });
  // 비어 있는 회의 = 예정이고 안건·회의록·할 일이 없는 회의. 정기 규칙을 바꾸면 오늘 이후의 빈 회의만 고치거나 지운다
  const blankMeeting = m => m.status === '예정' && !hasMinutes(m) && !String(m.agenda || '').trim() && !m.actions.length;
  // 지난 회의, 내용이 있는 회의, 취소한 회의는 건드리지 않는다
  function applySeries(s) {
    const dates = new Set(seriesDates(s).filter(d => d >= TODAY)), have = new Set();
    S.meetings.meetings = MT().filter(m => {
      if (m.series !== s.id) return true;
      if (m.date < TODAY || !blankMeeting(m)) { have.add(m.date); return true; }
      if (!dates.has(m.date)) return false;
      m.type = s.type; m.title = s.title; m.time = s.time || '';
      have.add(m.date); return true;
    });
    dates.forEach(d => { if (!have.has(d)) MT().push(seriesMeeting(s, d)); });
    MT().sort(meetSort);
  }
  function addSeries() {
    if (!online) return;
    const n = S.meetings.series.map(s => Number(String(s.id).replace(/^S-/, '')) || 0).reduce((a, b) => Math.max(a, b), 0) + 1;
    const s = { id: 'S-' + n, type: cfg('meetingTypes').includes('마케팅 회의') ? '마케팅 회의' : cfg('meetingTypes')[0], title: '새 정기 회의', weekday: P(TODAY).getDay(), time: '09:00', everyWeeks: 1, from: TODAY, until: (S.config.range && S.config.range.end) || addDays(TODAY, 77), note: '' };
    S.meetings.series.push(s); applySeries(s);
    saveMeetings(false, 'ms-title-' + s.id);
  }
  function deleteSeries(s) {
    const mine = MT().filter(m => m.series === s.id), drop = mine.filter(m => m.date >= TODAY && blankMeeting(m));
    if (!confirm(`정기 회의 「${s.title}」를 지울까요?\n앞으로 열릴 빈 회의 ${drop.length}건을 지웁니다.` + (mine.length - drop.length ? `\n지난 회의·내용이 있는 회의 ${mine.length - drop.length}건은 남기고 정기 연결만 풉니다.` : ''))) return;
    S.meetings.meetings = MT().filter(m => !drop.includes(m));
    MT().forEach(m => { if (m.series === s.id) delete m.series; });
    S.meetings.series.splice(S.meetings.series.indexOf(s), 1);
    if (ui.peek && ui.peek.type === 'meeting' && !meetingById(ui.peek.id)) closePeek(true);
    saveMeetings();
  }
  function createMeeting(type) {
    if (!online) return;
    type = type || cfg('meetingTypes')[0] || '기타';
    const m = { id: newMeetingId(), type, title: type, date: TODAY, time: '', place: '', attendees: '', status: '예정', agenda: '', notes: '', decisions: '', actions: [] };
    MT().push(m); MT().sort(meetSort);
    S.meetings.updated = TODAY; save('meetings');
    openPeek('meeting', m.id, { focusTitle: true });
  }
  function deleteMeeting(m) {
    const linked = m.actions.map(actTask).filter(Boolean);
    if (!confirm(`${m.id} · ${meetWhen(m)} ${meetName(m)}\n이 회의를 지울까요?` + (linked.length ? `\n업무로 등록한 ${linked.map(t => t.id).join(', ')}는 남고 회의 연결만 풀립니다.` : '') + (m.series ? '\n\n열리지 않은 정기 회의는 지우는 대신 상태를 「취소」로 두면 기록이 남습니다.' : ''))) return;
    MT().splice(MT().indexOf(m), 1);
    linked.forEach(t => { delete t.meeting; });
    closePeek(true);
    S.meetings.updated = TODAY;
    commit(linked.length ? ['meetings', 'tasks'] : 'meetings');
  }
  // 회의 할 일 → 업무 (고른 영역 맨 아래). 기존 업무의 order는 바꾸지 않는다
  function actionToTask(m, a, area) {
    if (!online) return;
    const t = { id: newTaskId('업무'), kind: '업무', title: a.text || '회의 후속 업무', area, priority: 'P1', owner: a.owner || 'Marketing', start: null, due: a.due || addDays(TODAY, 7), status: cfg('taskStatuses')[0] || '대기' };
    const orders = S.tasks.filter(x => isRoot(x) && x.area === area).map(x => num(x.order)).filter(v => v != null);
    if (orders.length) t.order = Math.max(...orders) + 10;
    t.meeting = m.id;
    t.note = md(m.date) + ' ' + meetName(m) + '(' + m.id + ')에서 나온 할 일';
    S.tasks.push(t);
    a.task = t.id; delete a.done;
    S.meetings.updated = TODAY;
    commit(['tasks', 'meetings'], true);
  }
  function actionAreaMenu(anchor, m, a) {
    openMenu(anchor, [{ head: '어느 영역의 업무로 등록할까요?' }, ...cfg('areas').map(ar => ({ label: ar, run: () => actionToTask(m, a, ar) }))]);
  }
  // 이번 주 페이지에 넣을 항목: 회의 · 업무로 등록하지 않은 할 일(마감 있는 것) · 회의록 미작성(지난 회의)
  function meetingAgenda() {
    const items = [];
    MT().forEach(m => {
      if (isMeetOff(m)) return;
      const ref = { type: 'meeting', id: m.id };
      items.push({ date: m.date, title: (m.time ? m.time + ' ' : '') + meetName(m), sub: '회의 · ' + m.type + (m.place ? ' · ' + m.place : ''), kind: '회의', ck: 'x-meet', done: m.date < TODAY, ref });
      if (needsMinutes(m) && m.date < TODAY) items.push({ date: m.date, title: '회의록 정리: ' + meetName(m), sub: '주요 내용·결정 사항이 비어 있음', kind: '회의록', ck: 'x-meet', done: false, ref });
      m.actions.forEach(a => {
        if (actTask(a) || !a.due) return;
        items.push({ date: a.due, title: a.text || '할 일', sub: '회의 할 일 · ' + mdShort(m.date) + ' ' + meetName(m) + (a.owner ? ' · ' + a.owner : ''), kind: '회의 할 일', ck: 'x-meet', done: !!a.done, ref });
      });
    });
    return items;
  }
  function actionRows(m, idp) {
    return m.actions.map((a, i) => {
      const t = actTask(a), done = actDone(a), late = !done && (t ? t.due : a.due) && (t ? t.due : a.due) < TODAY;
      return el('div', { cls: 'act' + (done ? ' done' : '') + (late ? ' late' : '') }, [
        checkIn(done, v => { if (t) setTaskStatus(t, v ? '완료' : (cfg('taskStatuses')[0] || '대기')); else { a.done = v; saveMeetings(true); } }, { id: idp + '-d-' + i, label: '할 일 ' + (i + 1) + ' 완료' }),
        textIn(a.text, v => { a.text = v; saveMeetings(true); }, { id: idp + '-t-' + i, ph: '할 일', label: '할 일 ' + (i + 1) }),
        t ? el('span', { cls: 'rel-chip act-task', title: t.id + ' ' + (t.title || '') + ' · ' + t.status + ' · 마감 ' + md(t.due) }, [el('button', { type: 'button', cls: 'go', text: t.id + ' · ' + t.status + ' · ' + mdShort(t.due), onclick: () => openPeek('task', t.id) })])
          : el('span', { cls: 'act-meta' }, [
            plainSelect([{ value: '', label: '담당' }, ...cfg('owners')], a.owner || '', v => { if (v) a.owner = v; else delete a.owner; saveMeetings(true); }, { id: idp + '-o-' + i, label: '할 일 ' + (i + 1) + ' 담당' }),
            dateIn(a.due, v => { if (v) a.due = v; else delete a.due; saveMeetings(true); }, { typed: true, short: true, id: idp + '-due-' + i, label: '할 일 ' + (i + 1) + ' 마감', ph: '마감' }),
            el('button', { type: 'button', cls: 'btn sm', text: '업무로 ▾', title: '업무 탭에 등록 (영역 선택). 담당·마감이 함께 넘어갑니다', disabled: !online || !String(a.text || '').trim(), onclick: e => { e.stopPropagation(); actionAreaMenu(e.currentTarget, m, a); } })]),
        el('button', { type: 'button', cls: 'btn ghost icon x', 'aria-label': '할 일 ' + (i + 1) + ' 삭제', text: '×', disabled: !online, onclick: () => {
          if (t && !confirm(`업무 ${t.id}는 그대로 남습니다. 회의록에서 이 할 일만 지울까요?`)) return;
          if (t) delete t.meeting;
          m.actions.splice(i, 1); S.meetings.updated = TODAY; commit(t ? ['meetings', 'tasks'] : 'meetings', true);
        } })
      ]);
    });
  }

  function peekMeeting(m, body, crumb) {
    const s = m.series ? seriesById(m.series) : null;
    crumb.appendChild(crumbBtn('🗓 회의', () => { closePeek(true); go('meetings'); }));
    crumb.appendChild(document.createTextNode('/'));
    crumb.appendChild(el('span', { text: m.id }));
    body.appendChild(textIn(m.title, v => { m.title = v; saveMeetings(); }, { id: 'pk-title', cls: 'ptitle', multi: true, enterCommits: true, ph: '회의 이름', label: '회의 이름' }));
    const props = el('div', { cls: 'props' });
    [
      prop('상태', tagSelect(cfg('meetingStatuses'), m.status, 'meetingStatus', v => { m.status = v; saveMeetings(true); }, { id: 'pk-mstatus', label: '상태' }),
        needsMinutes(m) ? el('span', { cls: 'hint warn', text: '회의록 미작성' }) : null),
      prop('종류', tagSelect(cfg('meetingTypes'), m.type, 'meetingType', v => { m.type = v; saveMeetings(true); }, { id: 'pk-mtype', label: '종류' })),
      prop('날짜', dateIn(m.date, v => { if (!v) return refresh(true); m.date = v; MT().sort(meetSort); saveMeetings(true); }, { typed: true, id: 'pk-mdate', label: '날짜' })),
      prop('시간', timeIn(m.time, v => { m.time = v; MT().sort(meetSort); saveMeetings(true); }, { id: 'pk-mtime', label: '시간' })),
      prop('장소', textIn(m.place, v => { m.place = v; saveMeetings(); }, { id: 'pk-mplace', ph: '비어 있음', label: '장소' })),
      prop('참석자', textIn(m.attendees, v => { m.attendees = v; saveMeetings(); }, { id: 'pk-matt', ph: '예) 대표, 영업 3명, Megan', label: '참석자' })),
      s ? prop('정기 회의', ro(s.title + ' · ' + (EVERY.find(e => e.value === String(s.everyWeeks)) || { label: s.everyWeeks + '주마다' }).label + ' ' + DAYS[s.weekday] + ' ' + (s.time || ''), true)) : null
    ].filter(Boolean).forEach(pair => pair.forEach(x => props.appendChild(x)));
    body.appendChild(props);
    const area = (key, label, ph, rows) => el('div', { cls: 'psec' }, [el('h3', { text: label }), textIn(m[key], v => { m[key] = v; saveMeetings(true); }, { id: 'pk-m' + key, multi: true, rows, raw: true, ph, label })]);
    body.appendChild(area('agenda', '안건', '회의 전에 다룰 내용', 2));
    body.appendChild(area('notes', '주요 내용', '논의한 내용, 공유 받은 숫자·일정', 6));
    body.appendChild(area('decisions', '결정 사항', '한 줄에 하나씩', 2));
    const open = m.actions.filter(a => !actDone(a)).length;
    body.appendChild(el('div', { cls: 'psec' }, [el('h3', {}, ['할 일', m.actions.length ? el('span', { cls: 'note', text: '남음 ' + open + ' / ' + m.actions.length }) : null]),
      el('div', { cls: 'acts' }, actionRows(m, 'pk-ma')),
      el('button', { type: 'button', cls: 'addline', text: '＋ 할 일 추가', disabled: !online, onclick: () => { m.actions.push({ text: '', owner: 'Marketing' }); saveMeetings(true, 'pk-ma-t-' + (m.actions.length - 1)); } }),
      el('p', { cls: 'note', text: '「업무로 ▾」를 누르면 업무 탭에 등록되고, 완료 여부는 그 업무 상태를 따릅니다. 등록하지 않은 할 일도 마감이 있으면 「이번 주」에 보입니다.' })]));
    body.appendChild(el('div', { cls: 'peek-foot' }, [el('span', { cls: 'note', text: m.id + (s ? ' · 정기 ' + s.id : '') }),
      el('button', { type: 'button', cls: 'btn danger', text: '삭제', disabled: !online, onclick: () => deleteMeeting(m) })]));
  }

  function renderMeetingsPage(root) {
    root.appendChild(pageHead('🗓', '회의', '회의 일정과 회의록을 관리합니다. 회의를 누르면 오른쪽에서 안건·주요 내용·결정 사항·할 일을 적습니다. 할 일은 골라서 「업무로」 등록하면 업무 탭에 들어갑니다. 정기 회의는 맨 아래에서 요일·시간·주기를 바꿀 수 있습니다.'));
    const all = [...MT()].sort(meetSort), live = all.filter(m => !isMeetOff(m));
    const next = live.find(m => m.date >= TODAY && !(m.date === TODAY && m.status === '완료'));
    const ws = weekStart(TODAY), we = addDays(ws, 6), week = live.filter(m => m.date >= ws && m.date <= we);
    const need = all.filter(needsMinutes);
    const acts = all.flatMap(m => m.actions.map((a, i) => ({ m, a, i }))), openActs = acts.filter(x => !actDone(x.a));
    const k = el('div', { cls: 'kpis' });
    k.appendChild(kpi('다음 회의', next ? meetWhen(next) : '—', next ? meetName(next) : '예정 없음'));
    k.appendChild(kpi('이번 주 회의', String(week.length), mdShort(ws) + '~' + mdShort(we) + (week.length ? ' · ' + [...new Set(week.map(m => m.type))].join(', ') : '')));
    k.appendChild(kpi('회의록 미작성', String(need.length), need.length ? '가장 오래된 것 ' + md(need[0].date) : '모두 작성', need.some(m => m.date < TODAY) ? 'bad' : need.length ? 'warn' : 'ok'));
    k.appendChild(kpi('남은 할 일', String(openActs.length), acts.filter(x => actTask(x.a)).length + '건 업무로 등록 · 완료 ' + (acts.length - openActs.length) + '건'));
    root.appendChild(k);

    const q = el('input', { type: 'search', id: 'f-mq', cls: 'search', placeholder: '검색 (이름·참석자·회의록)', 'aria-label': '회의 검색' }); q.value = ui.mq;
    q.addEventListener('input', () => { ui.mq = q.value; refresh(); });
    const seg = el('div', { cls: 'seg' }, ['다가오는 회의', '지난 회의', '전체'].map(v => el('button', { type: 'button', 'aria-pressed': String(ui.mperiod === v), text: v, onclick: () => { ui.mperiod = v; refresh(); } })));
    const nb = el('button', { type: 'button', cls: 'btn primary', text: '새 회의 ▾', disabled: !online });
    nb.addEventListener('click', () => openMenu(nb, [{ head: '종류 (날짜는 오늘, 상세에서 바꿈)' }, ...cfg('meetingTypes').map(t => ({ label: t, run: () => createMeeting(t) }))]));
    root.appendChild(el('div', { cls: 'toolbar' }, [el('div', { cls: 'filters' }, [seg, filterPill('종류', cfg('meetingTypes'), 'mtype'), q]), nb]));

    // 회의록을 아직 안 쓴 회의 (오늘까지 열린 것)
    if (need.length) {
      const l = el('div', { cls: 'list' });
      need.forEach(m => l.appendChild(itemRow({ date: m.date, title: meetName(m) + (m.time ? ' · ' + m.time : ''), sub: m.type + (m.attendees ? ' · ' + m.attendees : ''), kind: '회의록', ck: 'x-meet', done: false, ref: { type: 'meeting', id: m.id } }, m.date < TODAY)));
      root.appendChild(el('section', { cls: 'sec' }, [secHead('회의록 정리할 회의', el('span', { cls: 'note', text: '주요 내용이나 결정 사항을 적으면 목록에서 빠집니다' })), l]));
    }

    // 회의 목록 (월별)
    const ql = lc(ui.mq);
    let rows = all.filter(m => (ui.mtype === '전체' || m.type === ui.mtype)
      && (!ql || lc([m.id, m.title, m.type, m.attendees, m.place, m.agenda, m.notes, m.decisions, ...m.actions.map(a => a.text)].join(' ')).includes(ql)));
    if (ui.mperiod === '다가오는 회의') rows = rows.filter(m => m.date >= TODAY);
    else if (ui.mperiod === '지난 회의') rows = rows.filter(m => m.date < TODAY).reverse();
    const tb = el('tbody');
    let month = null;
    rows.forEach(m => {
      const mo = m.date.slice(0, 7);
      if (mo !== month) { month = mo; tb.appendChild(el('tr', { cls: 'r-month' }, [el('td', { colspan: 6, text: (mo.slice(0, 4) !== TODAY.slice(0, 4) ? mo.slice(0, 4) + '년 ' : '') + Number(mo.slice(5)) + '월' })])); }
      const sel = ui.peek && ui.peek.type === 'meeting' && ui.peek.id === m.id;
      const nA = m.actions.length, oA = m.actions.filter(a => !actDone(a)).length;
      const mm = isMeetOff(m) ? '' : hasMinutes(m) ? el('span', { cls: 'mm ok', text: '✓ 작성' }) : needsMinutes(m) ? el('span', { cls: 'mm need', text: '미작성' }) : '';
      tb.appendChild(el('tr', { cls: 'r' + (m.date < TODAY ? ' past' : '') + (m.date === TODAY ? ' today' : '') + (isMeetOff(m) ? ' done' : '') + (sel ? ' sel' : ''), tabindex: 0, 'data-id': m.id,
        onclick: () => openPeek('meeting', m.id), onkeydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) openPeek('meeting', m.id); } }, [
        el('td', { cls: 'c-when' }, [el('span', { text: md(m.date) }), m.time ? el('span', { cls: 'tm', text: m.time }) : null]),
        el('td', { cls: 'c-name' }, [el('div', { cls: 'name-cell' }, [el('span', { cls: 'name', text: meetName(m), title: meetName(m) }), m.series ? el('span', { cls: 'rep', title: '정기 회의', text: '↻' }) : null,
          m.attendees ? el('span', { cls: 'idt', text: m.attendees }) : null])]),
        el('td', {}, [tagEl(m.type, 'meetingType')]),
        el('td', {}, [tagSelect(cfg('meetingStatuses'), m.status, 'meetingStatus', v => { m.status = v; saveMeetings(true); }, { id: 'mt-s-' + m.id, label: '상태' })]),
        el('td', {}, [mm]),
        el('td', { cls: 'note' + (oA ? '' : ' ok'), text: nA ? (oA ? '남음 ' + oA + ' / ' + nA : '완료 ' + nA) : '' })
      ]));
    });
    if (!rows.length) tb.appendChild(el('tr', {}, [el('td', { colspan: 6, cls: 'empty', text: '조건에 맞는 회의가 없습니다.' })]));
    tb.appendChild(el('tr', { cls: 'r-add' }, [el('td', { colspan: 6, role: 'button', tabindex: 0, onclick: () => createMeeting(ui.mtype !== '전체' ? ui.mtype : '기타'), onkeydown: e => { if (e.key === 'Enter') createMeeting(ui.mtype !== '전체' ? ui.mtype : '기타'); }, text: '＋ 새 회의 (' + (ui.mtype !== '전체' ? ui.mtype : '기타') + ', 오늘)' })]));
    root.appendChild(el('section', { cls: 'sec' }, [secHead('회의 일정', el('span', { cls: 'note', text: rows.length + '건' })),
      el('div', { cls: 'hscroll' }, [el('table', { cls: 'db meetings' }, [el('thead', {}, [el('tr', {}, ['일시', '이름', '종류', '상태', '회의록', '할 일'].map(h => el('th', { text: h })))]), tb])])]));

    // 회의 할 일 모아 보기 (남은 것)
    const at = el('tbody');
    openActs.sort((x, y) => ((actTask(x.a) || {}).due || x.a.due || '9').localeCompare((actTask(y.a) || {}).due || y.a.due || '9')).forEach(({ m, a, i }) => {
      const t = actTask(a), due = t ? t.due : a.due, late = due && due < TODAY;
      at.appendChild(el('tr', { cls: 'r', tabindex: 0, onclick: () => openPeek('meeting', m.id), onkeydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) openPeek('meeting', m.id); } }, [
        el('td', {}, [checkIn(false, v => { if (t) setTaskStatus(t, v ? '완료' : (cfg('taskStatuses')[0] || '대기')); else { a.done = v; saveMeetings(true); } }, { id: 'ma-d-' + m.id + '-' + i, label: (a.text || '할 일') + ' 완료' })]),
        el('td', { cls: 'c-name' }, [el('span', { cls: 'name' + (a.text ? '' : ' untitled'), text: a.text || '내용 없음' })]),
        el('td', { cls: 'note', text: mdShort(m.date) + ' ' + meetName(m) }),
        el('td', { cls: 'note', text: (t ? t.owner : a.owner) || '' }),
        el('td', { cls: late ? 'late' : '', text: due ? md(due) : '' }),
        el('td', {}, [t ? el('span', { cls: 'rel-chip' }, [el('button', { type: 'button', cls: 'go', text: t.id + ' · ' + t.status, onclick: e => { e.stopPropagation(); openPeek('task', t.id); } })])
          : el('button', { type: 'button', cls: 'btn sm', text: '업무로 ▾', disabled: !online || !String(a.text || '').trim(), onclick: e => { e.stopPropagation(); actionAreaMenu(e.currentTarget, m, a); } })])
      ]));
    });
    if (!openActs.length) at.appendChild(el('tr', {}, [el('td', { colspan: 6, cls: 'empty', text: '남은 할 일이 없습니다. 회의를 열어 「＋ 할 일 추가」로 적습니다.' })]));
    root.appendChild(el('section', { cls: 'sec' }, [secHead('회의 할 일', el('span', { cls: 'note', text: '모든 회의의 남은 할 일 · 업무로 등록한 것은 업무 상태를 따름' })),
      el('div', { cls: 'hscroll' }, [el('table', { cls: 'db mt-acts' }, [el('thead', {}, [el('tr', {}, ['', '할 일', '회의', '담당', '마감', '업무'].map(h => el('th', { text: h })))]), at])])]));

    // 정기 회의 규칙: 바꾸면 오늘 이후의 빈 회의에 바로 반영
    const st = el('tbody');
    S.meetings.series.forEach(s => {
      const upd = (k, v) => { s[k] = v; applySeries(s); saveMeetings(true); };
      const cnt = MT().filter(m => m.series === s.id && !isMeetOff(m)).length;
      st.appendChild(el('tr', { title: s.note || '' }, [
        el('td', { cls: 'c-name' }, [textIn(s.title, v => { if (v) upd('title', v); else refresh(); }, { id: 'ms-title-' + s.id, cls: 'cell-in', label: '정기 회의 이름' })]),
        el('td', {}, [tagSelect(cfg('meetingTypes'), s.type, 'meetingType', v => upd('type', v), { id: 'ms-type-' + s.id, label: '종류' })]),
        el('td', {}, [plainSelect(WEEKDAYS, String(s.weekday), v => upd('weekday', Number(v)), { id: 'ms-wd-' + s.id, label: '요일' })]),
        el('td', {}, [timeIn(s.time, v => upd('time', v), { id: 'ms-time-' + s.id, cls: 'cell-in', label: '시간' })]),
        el('td', {}, [plainSelect(EVERY, String(s.everyWeeks), v => upd('everyWeeks', Number(v)), { id: 'ms-ev-' + s.id, label: '주기' })]),
        el('td', {}, [dateIn(s.from, v => { if (v) upd('from', v); else refresh(); }, { typed: true, short: true, id: 'ms-from-' + s.id, cls: 'cell-in', label: '시작' })]),
        el('td', {}, [dateIn(s.until, v => { if (v) upd('until', v); else refresh(); }, { typed: true, short: true, id: 'ms-until-' + s.id, cls: 'cell-in', label: '끝' })]),
        el('td', { cls: 'note', text: cnt + '회' }),
        el('td', {}, [el('button', { type: 'button', cls: 'btn ghost icon', 'aria-label': s.title + ' 정기 회의 삭제', text: '×', disabled: !online, onclick: () => deleteSeries(s) })])
      ]));
    });
    st.appendChild(el('tr', { cls: 'r-add' }, [el('td', { colspan: 9, role: 'button', tabindex: 0, onclick: addSeries, onkeydown: e => { if (e.key === 'Enter') addSeries(); }, text: '＋ 새 정기 회의' })]));
    root.appendChild(el('section', { cls: 'sec' }, [secHead('정기 회의'),
      el('p', { cls: 'note', text: '요일·시간·주기·기간을 바꾸면 오늘 이후의 빈 회의(안건·회의록·할 일이 없는 예정 회의)만 새 규칙으로 바뀝니다. 지난 회의, 내용을 적은 회의, 취소한 회의는 그대로 둡니다. 격주는 시작일이 있는 주부터 셉니다.' }),
      el('div', { cls: 'hscroll' }, [el('table', { cls: 'db series' }, [el('thead', {}, [el('tr', {}, ['이름', '종류', '요일', '시간', '주기', '시작', '끝', '회의', ''].map(h => el('th', { text: h })))]), st])])]));
  }

  function renderMetricsPage(root, after) {
    root.appendChild(pageHead('📈', '지표', '매주 금요일 팔로워와 행사 경유 수를 기록합니다. 첫 기준값은 10/23. 수치 목표는 W4 이후에 정합니다.'));
    const ch = el('div', { id: 'mchart' });
    root.appendChild(el('section', { cls: 'sec' }, [secHead('팔로워 추이', el('span', { cls: 'note', text: '2회 이상 기록하면 선이 그려집니다' })), ch]));
    after.push(() => drawMetricsChart(ch));
    const list = [...S.metrics].sort((a, b) => b.date.localeCompare(a.date));
    const tb = el('tbody');
    if (!list.length) tb.appendChild(el('tr', {}, [el('td', { colspan: 7, cls: 'empty', text: '아직 기록이 없습니다. 첫 게시 주 금요일(10/23)에 팔로워 수부터 적어 두면 기준값이 됩니다.' })]));
    list.forEach(m => {
      tb.appendChild(el('tr', {}, [
        el('td', {}, [dateIn(m.date, v => {
          if (!v || v === m.date) return refresh();
          if (S.metrics.some(x => x !== m && x.date === v)) { alert(md(v) + ' 기록이 이미 있습니다.'); return refresh(); }
          m.date = v; S.metrics.sort((a, b) => a.date.localeCompare(b.date)); commit('metrics');
        }, { typed: true, id: 'mt-d-' + m.date, cls: 'cell-in', label: '기준일' })]),
        ...MFIELDS.map(([k, l]) => el('td', {}, [numIn(m[k], v => { m[k] = v; commit('metrics'); }, { id: 'mt-' + k + '-' + m.date, cls: 'cell-in', min: 0, label: md(m.date) + ' ' + l })])),
        el('td', {}, [el('button', { type: 'button', cls: 'btn ghost icon', 'aria-label': md(m.date) + ' 기록 삭제', text: '×', disabled: !online, onclick: () => { if (!confirm(md(m.date) + ' 기록을 지울까요?')) return; S.metrics.splice(S.metrics.indexOf(m), 1); commit('metrics'); } })])
      ]));
    });
    tb.appendChild(el('tr', { cls: 'r-add' }, [el('td', { colspan: 7, role: 'button', tabindex: 0, onclick: addMetric, onkeydown: e => { if (e.key === 'Enter') addMetric(); }, text: '＋ 새 기록 (오늘 날짜)' })]));
    root.appendChild(el('section', { cls: 'sec' }, [secHead('주간 기록', el('span', { cls: 'note', text: '칸을 고치면 바로 저장' })),
      el('div', { cls: 'hscroll' }, [el('table', { cls: 'db mt' }, [el('thead', {}, [el('tr', {}, ['기준일', ...MFIELDS.map(f => f[1]), ''].map(h => el('th', { text: h })))]), tb])])]));
  }
  function drawMetricsChart(ch) {
    ch.textContent = '';
    const pts = [...S.metrics].sort((a, b) => a.date.localeCompare(b.date)).filter(m => num(m.li) != null || num(m.fb) != null);
    if (pts.length < 2) { ch.appendChild(el('div', { cls: 'empty', text: pts.length ? '기록 1건 · 다음 주 기록부터 추이가 보입니다.' : '기록이 없습니다.' })); return; }
    const W = Math.max(300, ch.clientWidth || 600), H = 180, L = 40, R = 60, T = 12, B = 24, NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', '팔로워 추이');
    const mk = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); svg.appendChild(e); return e; };
    const vals = pts.flatMap(m => [num(m.li), num(m.fb)]).filter(v => v != null);
    const top = Math.ceil(Math.max(10, ...vals) / 10) * 10;
    const x = i => L + (W - L - R) * (i / (pts.length - 1)), y = v => T + (H - T - B) * (1 - v / top);
    [0, top / 2, top].forEach(v => { mk('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: 'var(--line)' }); const t = mk('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 10, fill: 'var(--muted)' }); t.textContent = v; });
    [0, pts.length - 1].forEach(i => { const t = mk('text', { x: x(i), y: H - 6, 'text-anchor': i ? 'end' : 'start', 'font-size': 10, fill: 'var(--muted)' }); t.textContent = mdShort(pts[i].date); });
    [['li', 'var(--li)', 'LI'], ['fb', 'var(--fb)', 'FB']].forEach(([k, c, n]) => {
      const s = pts.map((m, i) => [i, num(m[k])]).filter(a => a[1] != null); if (!s.length) return;
      mk('polyline', { points: s.map(([i, v]) => x(i) + ',' + y(v)).join(' '), fill: 'none', stroke: c, 'stroke-width': 2 });
      const [li, lv] = s[s.length - 1]; mk('circle', { cx: x(li), cy: y(lv), r: 3.5, fill: c });
      const t = mk('text', { x: x(li) + 6, y: y(lv) + 4, 'font-size': 11, fill: c }); t.textContent = n + ' ' + lv;
    });
    ch.appendChild(svg);
  }

  /* ---------- 예산 (data/budget.json) — 연도별 ---------- */
  // 형식: { updated, currency, years: [{ year, label, task, approved, approvedAt, reserveRate, groups[{id,label}], items[] }] }
  function normYear(y) {
    y = (y && typeof y === 'object') ? y : {};
    y.year = num(y.year) || Number(TODAY.slice(0, 4));
    if (!y.label) y.label = y.year + '년 예산';
    if (!Array.isArray(y.groups)) y.groups = [];
    if (!Array.isArray(y.items)) y.items = [];
    if (num(y.reserveRate) == null) y.reserveRate = 0.1;
    if (!('approved' in y)) y.approved = null;
    if (!('approvedAt' in y)) y.approvedAt = null;
    return y;
  }
  function normBudget(b) {
    b = (b && typeof b === 'object' && !Array.isArray(b)) ? b : {};
    if (!Array.isArray(b.years)) {
      // v0.2 형식(연도 없이 groups·items)은 2026년 예산으로 옮긴다
      const old = b;
      b = { updated: old.updated || TODAY, currency: old.currency || 'KRW', years: [] };
      if (Array.isArray(old.items) || Array.isArray(old.groups)) b.years.push({ year: 2026, label: '2026 Q4 행사 예산', task: 'BG-1', approved: old.approved == null ? null : old.approved, approvedAt: old.approvedAt || null, reserveRate: old.reserveRate, groups: old.groups, items: old.items });
    }
    b.years = b.years.map(normYear).sort((a, c) => a.year - c.year);
    if (!b.currency) b.currency = 'KRW';
    return b;
  }
  const sum = (list, k) => list.reduce((a, x) => a + (num(x[k]) || 0), 0);
  // 계획보다 더 쓴 금액. 계획이 없는 항목은 실집행 전액
  const overrun = list => list.reduce((a, x) => num(x.actual) == null ? a : a + Math.max(0, num(x.actual) - (num(x.plan) || 0)), 0);
  const allBudgetItems = () => S.budget.years.flatMap(y => y.items);
  const budgetItemById = id => allBudgetItems().find(x => x.id === id);
  const yearOf = x => S.budget.years.find(y => y.items.includes(x));
  function curYear() {
    const ys = S.budget.years;
    return ys.find(y => y.year === ui.byear) || ys.find(y => y.year === Number(TODAY.slice(0, 4))) || ys[0] || null;
  }
  function budgetGroups(Y) {
    const g = [...Y.groups];
    Y.items.forEach(x => { if (x.group && !g.some(y => y.id === x.group)) g.push({ id: x.group, label: x.group }); });
    return g;
  }
  function yearCalc(Y) {
    const items = Y.items, plan = sum(items, 'plan'), actual = sum(items, 'actual');
    const reserve = Math.round(plan * (num(Y.reserveRate) || 0)), over = overrun(items);
    return { plan, actual, reserve, over, left: reserve - over, total: plan + reserve, approved: num(Y.approved), hasPlan: items.some(x => num(x.plan) != null), hasActual: items.some(x => num(x.actual) != null) };
  }
  const saveBudget = (focusId, peekToo) => { S.budget.updated = TODAY; commit('budget', peekToo, focusId); };
  function newBudgetId() {
    const n = allBudgetItems().map(x => Number(String(x.id).replace(/^B-/, '')) || 0).reduce((a, c) => Math.max(a, c), 0) + 1;
    return 'B-' + pad2(n);
  }
  // 인라인(표에서 바로 입력) 또는 상세 패널로 새 항목
  function addBudgetItem(Y, groupId, inPeek) {
    if (!online || !Y) return;
    const id = newBudgetId();
    Y.items.push({ id, group: groupId || (Y.groups[0] && Y.groups[0].id) || '', title: '', plan: null, actual: null, vendor: '', paidAt: null, note: '' });
    if (inPeek) { S.budget.updated = TODAY; save('budget'); openPeek('budget', id, { focusTitle: true }); }
    else { saveBudget('bt-title-' + id); setTimeout(() => { const n = $('bt-title-' + id); if (n) n.scrollIntoView({ block: 'nearest' }); }, 0); }
  }
  function deleteBudgetItem(x) {
    const Y = yearOf(x); if (!Y) return;
    if (!confirm(x.id + ' · ' + (x.title || '제목 없음') + ' 항목을 지울까요?')) return;
    Y.items.splice(Y.items.indexOf(x), 1);
    if (ui.peek && ui.peek.id === x.id) closePeek(true);
    saveBudget();
  }
  // 항목을 다른 연도로: 같은 id 또는 같은 이름의 구분이 있으면 그대로, 없으면 그 연도의 첫 구분
  function moveBudgetItem(x, year) {
    const from = yearOf(x), to = S.budget.years.find(y => y.year === year);
    if (!from || !to || from === to) return;
    const g = budgetGroups(from).find(g => g.id === x.group);
    const tg = to.groups.find(t => t.id === x.group) || (g && to.groups.find(t => t.label === g.label)) || to.groups[0];
    x.group = tg ? tg.id : '';
    from.items.splice(from.items.indexOf(x), 1); to.items.push(x);
    ui.byear = year;
    saveBudget(null, true);
  }
  function addYear(mode) {
    if (!online) return;
    const ys = S.budget.years, src = curYear();
    const year = ys.length ? Math.max(...ys.map(y => y.year)) + 1 : Number(TODAY.slice(0, 4));
    const Y = normYear({ year, label: year + '년 예산', reserveRate: src ? src.reserveRate : 0.1 });
    if (src && mode !== 'empty') Y.groups = src.groups.map(g => ({ ...g }));
    if (src && mode === 'items') {
      src.items.forEach(x => {
        const ref = [num(x.plan) != null ? '계획 ' + won(x.plan) + '원' : null, num(x.actual) != null ? '실집행 ' + won(x.actual) + '원' : null].filter(Boolean).join(' · ');
        Y.items.push({ id: newBudgetIdAfter(Y), group: x.group, title: x.title, plan: null, actual: null, vendor: x.vendor || '', paidAt: null, note: ref ? src.year + '년 ' + ref : '' });
      });
    }
    ys.push(Y); ys.sort((a, c) => a.year - c.year);
    ui.byear = year;
    saveBudget();
  }
  // addYear에서 아직 years에 넣기 전의 연도 항목까지 포함해 다음 ID
  function newBudgetIdAfter(Y) {
    const n = [...allBudgetItems(), ...Y.items].map(x => Number(String(x.id).replace(/^B-/, '')) || 0).reduce((a, c) => Math.max(a, c), 0) + 1;
    return 'B-' + pad2(n);
  }
  // 구분(큰 항목) 추가·이름 변경·순서·삭제. 구분 ID는 바꾸지 않고 이름(label)만 바꾼다
  // budgetGroups()는 groups에 없는 구분 ID를 쓰는 항목도 보여 주므로, 그런 구분을 고치면 groups에 정식으로 넣는다
  const realGroup = (Y, g) => { let r = Y.groups.find(x => x.id === g.id); if (!r) { r = { id: g.id, label: g.label }; Y.groups.push(r); } return r; };
  function addBudgetGroup(Y) {
    if (!online) return;
    let n = Y.groups.length + 1; while (Y.groups.some(g => g.id === 'group-' + n)) n++;
    const id = 'group-' + n;
    Y.groups.push({ id, label: '새 구분' });
    saveBudget('bg-label-' + id);
    requestAnimationFrame(() => setTimeout(() => { const i = $('bg-label-' + id); if (i) i.select(); }, 0));
  }
  function renameBudgetGroup(Y, g, label) {
    if (!label || label === g.label) return refresh();
    if (budgetGroups(Y).some(x => x.id !== g.id && x.label === label)) { alert(`「${label}」 구분이 이미 있습니다.`); return refresh(); }
    realGroup(Y, g).label = label; saveBudget();
  }
  function moveBudgetGroup(Y, g, dir) {
    budgetGroups(Y).forEach(x => realGroup(Y, x)); // 순서를 바꾸려면 화면에 보이는 구분이 모두 groups에 있어야 한다
    const i = Y.groups.findIndex(x => x.id === g.id), j = i + dir;
    if (i < 0 || j < 0 || j >= Y.groups.length) return;
    [Y.groups[i], Y.groups[j]] = [Y.groups[j], Y.groups[i]];
    saveBudget();
  }
  function deleteBudgetGroup(Y, g, anchor) {
    const list = Y.items.filter(x => x.group === g.id);
    const drop = keepItems => {
      if (keepItems) list.forEach(x => { x.group = ''; });
      else { Y.items = Y.items.filter(x => x.group !== g.id); if (ui.peek && ui.peek.type === 'budget' && !budgetItemById(ui.peek.id)) closePeek(true); }
      Y.groups = Y.groups.filter(x => x.id !== g.id);
      saveBudget(null, true);
    };
    if (!list.length) { if (confirm(`「${g.label}」 구분을 지울까요?`)) drop(true); return; }
    openMenu(anchor, [{ head: `「${g.label}」 · 하위 항목 ${list.length}개` },
      { label: '구분만 지우기 (하위 항목은 「구분 없음」으로)', run: () => drop(true) },
      { label: `구분과 하위 항목 ${list.length}개 함께 지우기`, run: () => { if (confirm(`「${g.label}」과 하위 항목 ${list.length}개(${list.map(x => x.id).join(', ')})를 모두 지울까요?`)) drop(false); } }]);
  }
  function deleteYear(Y) {
    if (!confirm(`${Y.year}년 예산을 지울까요?` + (Y.items.length ? `\n항목 ${Y.items.length}개도 함께 지워집니다.` : ''))) return;
    S.budget.years.splice(S.budget.years.indexOf(Y), 1);
    ui.byear = null;
    if (ui.peek && ui.peek.type === 'budget' && !budgetItemById(ui.peek.id)) closePeek(true);
    saveBudget();
  }

  function renderBudgetPage(root) {
    const ys = S.budget.years, Y = curYear();
    root.appendChild(pageHead('💰', '예산', '연도별 마케팅 예산. 항목을 누르면 오른쪽에서 모든 값을 고치거나 지울 수 있습니다. 금액은 원 단위, 모르는 금액은 비워 둡니다.'));
    const addYearBtn = el('button', { type: 'button', role: 'tab', 'aria-selected': 'false', text: '＋ 연도', disabled: !online });
    addYearBtn.addEventListener('click', () => {
      const next = ys.length ? Math.max(...ys.map(y => y.year)) + 1 : Number(TODAY.slice(0, 4));
      openMenu(addYearBtn, [{ head: next + '년 예산 만들기' },
        { label: '빈 예산', run: () => addYear('empty') },
        ...(Y ? [{ label: Y.year + '년 구분만 복사', run: () => addYear('groups') }, { label: Y.year + '년 구분·항목 복사 (금액은 비우고 메모에 참고값)', run: () => addYear('items') }] : [])]);
    });
    root.appendChild(el('div', { cls: 'viewtabs', role: 'tablist' }, [...ys.map(y => el('button', { type: 'button', role: 'tab', 'aria-selected': String(Y === y), text: y.year + '년', onclick: () => { ui.byear = y.year; refresh(); } })), addYearBtn]));
    if (!Y) { root.appendChild(el('div', { cls: 'empty', text: '예산 연도가 없습니다. 「＋ 연도」로 만드세요.' })); return; }

    const c = yearCalc(Y), task = Y.task ? taskById(Y.task) : null;
    const nb = el('button', { type: 'button', cls: 'btn primary', text: '새로 만들기 ▾', disabled: !online });
    nb.addEventListener('click', () => openMenu(nb, [{ head: Y.year + '년 · 구분 선택' }, ...budgetGroups(Y).map(g => ({ label: g.label, run: () => addBudgetItem(Y, g.id) })),
      ...(budgetGroups(Y).length ? [] : [{ label: '구분 없이 만들기', run: () => addBudgetItem(Y, '') }])]));
    root.appendChild(el('div', { cls: 'toolbar' }, [el('div', { cls: 'yr-title' }, [el('h2', { text: Y.label }), task ? el('button', { type: 'button', cls: 'rel-chip', onclick: () => openPeek('task', task.id) }, [el('span', { cls: 'go', text: task.id + ' ' + task.title + ' · 마감 ' + md(task.due) })]) : null]), nb]));

    root.appendChild(el('div', { cls: 'kpis' }, [
      kpi('계획 합계', c.hasPlan ? man(c.plan) : '—', c.hasPlan ? '예비비 포함 ' + man(c.total) : '항목별 계획 금액을 입력하세요'),
      kpi('대표 승인액', c.approved == null ? '미승인' : man(c.approved),
        c.approved == null ? (task ? task.id + ' 마감 ' + md(task.due) : '승인 전') : (Y.approvedAt ? md(Y.approvedAt) + ' 승인 · ' : '') + (c.hasPlan ? (c.total <= c.approved ? '계획 ' + man(c.approved - c.total) + ' 여유' : '계획이 ' + man(c.total - c.approved) + ' 초과') : ''),
        c.approved == null ? (task && task.due < TODAY ? 'warn' : '') : (c.hasPlan && c.total > c.approved ? 'bad' : 'ok')),
      kpi('실집행', c.hasActual ? man(c.actual) : '—', c.plan ? '계획 대비 ' + pct(c.actual / c.plan) : '계획 입력 후 집행률 표시'),
      kpi('예비비 잔액', c.hasPlan ? man(c.left) : '—', c.hasPlan ? '예비비 ' + man(c.reserve) + ' · 초과 집행 ' + man(c.over) : '예비비 ' + Math.round((num(Y.reserveRate) || 0) * 100) + '%', !c.hasPlan ? '' : c.left < 0 ? 'bad' : c.over > 0 ? 'warn' : 'ok')
    ]));

    // 항목 표 (행을 누르면 상세)
    const groups = budgetGroups(Y);
    const tb = el('tbody');
    // 구분(큰 항목) 머리 행: 이름을 바로 고치고, ↑↓로 순서, ×로 삭제. 그 아래 하위 항목
    groups.forEach((g, gi) => {
      const list = Y.items.filter(x => x.group === g.id), p = sum(list, 'plan'), a = sum(list, 'actual');
      const name = el('input', { type: 'text', id: 'bg-label-' + g.id, cls: 'cell-in g-name', value: g.label, 'aria-label': '구분 이름', disabled: !online, title: '구분 이름 — 눌러서 바꿉니다', style: 'width:calc(' + Math.max(4, g.label.length) + 'em + 12px)' });
      name.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) name.blur(); });
      name.addEventListener('change', () => renameBudgetGroup(Y, g, name.value.trim()));
      const act = (text, label, run, dis) => el('button', { type: 'button', cls: 'btn ghost icon', text, 'aria-label': g.label + ' ' + label, title: label, disabled: !online || dis, onclick: e => { e.stopPropagation(); run(e.currentTarget); } });
      tb.appendChild(el('tr', { cls: 'gsum' }, [
        el('td', { colspan: 2 }, [el('div', { cls: 'name-wrap' }, [name, el('span', { cls: 'cnt', text: list.length + '개' }), el('span', { cls: 'g-acts' }, [
          act('↑', '위로', () => moveBudgetGroup(Y, g, -1), gi === 0),
          act('↓', '아래로', () => moveBudgetGroup(Y, g, 1), gi === groups.length - 1),
          act('×', '구분 삭제', b => deleteBudgetGroup(Y, g, b))
        ])])]),
        el('td', { cls: 'r', text: p ? won(p) : '—' }), el('td', { cls: 'r', text: a ? won(a) : '—' }), el('td', { cls: 'r', text: p ? pct(a / p) : '—' }),
        el('td', { colspan: 4 })
      ]));
      list.forEach(x => tb.appendChild(budgetRow(x, groups)));
      tb.appendChild(el('tr', { cls: 'r-add' }, [el('td', { colspan: 9, role: 'button', tabindex: 0, onclick: () => addBudgetItem(Y, g.id), onkeydown: e => { if (e.key === 'Enter') addBudgetItem(Y, g.id); }, text: '＋ ' + g.label + ' 하위 항목 추가' })]));
    });
    const orphan = Y.items.filter(x => !x.group);
    if (orphan.length) {
      tb.appendChild(el('tr', { cls: 'gsum' }, [el('td', { colspan: 9, text: '구분 없음 · ' + orphan.length + '개 — 구분 칸에서 옮길 곳을 고르세요' })]));
      orphan.forEach(x => tb.appendChild(budgetRow(x, groups)));
    }
    tb.appendChild(el('tr', { cls: 'r-add g-add' }, [el('td', { colspan: 9, role: 'button', tabindex: 0, onclick: () => addBudgetGroup(Y), onkeydown: e => { if (e.key === 'Enter') addBudgetGroup(Y); }, text: '＋ 새 구분 (큰 항목)' })]));
    root.appendChild(el('section', { cls: 'sec' }, [secHead('예산 항목', el('span', { cls: 'note', text: Y.items.length + '개 · 굵은 줄 = 구분(이름을 눌러 수정, ↑↓ 순서, × 삭제) · 칸을 바로 고치거나 행을 눌러 상세에서 편집 · 새 ID ' + newBudgetId() })),
      el('div', { cls: 'hscroll' }, [el('table', { cls: 'db budget' }, [el('thead', {}, [el('tr', {}, [['ID'], ['항목'], ['계획', 'r'], ['실집행', 'r'], ['집행률', 'r'], ['구분'], ['업체'], ['지급일'], ['메모']].map(([h, cl]) => el('th', { cls: cl, text: h })))]), tb])])]));

    // 구분별 집행 + 연도 설정
    const mix = el('div', { cls: 'mix' });
    const max = Math.max(1, ...groups.map(g => { const l = Y.items.filter(x => x.group === g.id); return Math.max(sum(l, 'plan'), sum(l, 'actual')); }));
    groups.forEach(g => {
      const l = Y.items.filter(x => x.group === g.id), p = sum(l, 'plan'), a = sum(l, 'actual'), hot = a > p;
      mix.appendChild(el('div', { cls: 'mix-row' }, [el('span', { text: g.label }),
        el('div', { cls: 'bar' }, [el('i', { cls: 'plan', style: `width:${p / max * 100}%;background:var(--accent)` }), el('i', { style: `width:${a / max * 100}%;background:${hot ? 'var(--bad)' : 'var(--accent)'}` })]),
        el('span', { cls: 'n' + (hot ? ' hot' : ''), text: man(a) + ' / ' + man(p) + (p ? ' · ' + pct(a / p) : '') })]));
    });
    if (!groups.length) mix.appendChild(el('div', { cls: 'empty', text: '구분이 없습니다.' }));
    const yi = 'by-' + Y.year;
    const settings = el('div', { cls: 'form-grid' }, [
      el('label', { for: yi + '-label' }, ['예산 이름', textIn(Y.label, v => { if (v) { Y.label = v; saveBudget(); } else refresh(); }, { id: yi + '-label', label: '예산 이름' })]),
      el('label', { for: yi + '-year' }, ['연도', numIn(Y.year, v => {
        if (!v || v === Y.year) return refresh();
        if (ys.some(y => y !== Y && y.year === v)) { alert(v + '년 예산이 이미 있습니다.'); return refresh(); }
        Y.year = v; ys.sort((a, b) => a.year - b.year); ui.byear = v; saveBudget();
      }, { id: yi + '-year', min: 2000, max: 2100, step: 1, label: '연도' })]),
      el('label', { for: yi + '-task' }, ['연결 업무', plainSelect([{ value: '', label: '(없음)' }, ...S.tasks.filter(t => isRoot(t) && t.kind === '업무').map(t => ({ value: t.id, label: t.id + ' ' + t.title }))], Y.task || '', v => { if (v) Y.task = v; else delete Y.task; saveBudget(); }, { id: yi + '-task', cls: '', label: '연결 업무' })]),
      el('label', { for: yi + '-approved' }, ['대표 승인액 (원)', moneyIn(c.approved, v => { Y.approved = v; saveBudget(); }, { id: yi + '-approved', cls: 'pinput', ph: '미승인', label: '대표 승인액' })]),
      el('label', { for: yi + '-approvedAt' }, ['승인일', dateIn(Y.approvedAt, v => { Y.approvedAt = v; saveBudget(); }, { id: yi + '-approvedAt', label: '승인일' })]),
      el('label', { for: yi + '-rate' }, ['예비비 비율 (%)', numIn(Math.round((num(Y.reserveRate) || 0) * 100), v => { Y.reserveRate = v == null ? 0 : Math.min(100, Math.max(0, v)) / 100; saveBudget(); }, { id: yi + '-rate', min: 0, max: 100, step: 1, label: '예비비 비율' })])
    ]);
    root.appendChild(el('div', { cls: 'grid2' }, [
      el('section', { cls: 'sec' }, [secHead('구분별 집행', el('span', { cls: 'note', text: '옅은 막대 = 계획 · 진한 막대 = 실집행 · 붉은색 = 계획 초과' })), mix]),
      el('section', { cls: 'sec' }, [secHead(Y.year + '년 설정', el('button', { type: 'button', cls: 'btn danger sm', text: Y.year + '년 예산 삭제', disabled: !online, onclick: () => deleteYear(Y) })), settings,
        el('p', { cls: 'note', text: '예비비 = 계획 합계 × 비율. 항목별로 계획보다 더 쓴 금액(계획 없이 쓴 항목은 전액)이 예비비에서 빠집니다.' })])
    ]));

    // 연도별 요약
    const sb = el('tbody');
    ys.forEach(y => {
      const k = yearCalc(y);
      sb.appendChild(el('tr', { cls: 'r' + (y === Y ? ' sel' : ''), tabindex: 0, onclick: () => { ui.byear = y.year; refresh(); }, onkeydown: e => { if (e.key === 'Enter') { ui.byear = y.year; refresh(); } } }, [
        el('td', {}, [el('span', { cls: 'name', text: y.year + '년' }), el('span', { cls: 'idt', text: ' ' + y.label })]),
        el('td', { cls: 'r num', text: k.hasPlan ? won(k.plan) : '—' }), el('td', { cls: 'r num', text: k.hasPlan ? won(k.total) : '—' }),
        el('td', { cls: 'r num', text: k.approved == null ? '미승인' : won(k.approved) }), el('td', { cls: 'r num', text: k.hasActual ? won(k.actual) : '—' }),
        el('td', { cls: 'r num', text: k.plan ? pct(k.actual / k.plan) : '—' }), el('td', { cls: 'r num', text: String(y.items.length) })
      ]));
    });
    root.appendChild(el('section', { cls: 'sec' }, [secHead('연도별 요약', el('span', { cls: 'note', text: '원 단위 · 행을 누르면 그 연도로' })),
      el('div', { cls: 'hscroll' }, [el('table', { cls: 'db budget yrs' }, [el('thead', {}, [el('tr', {}, [['연도'], ['계획', 'r'], ['예비비 포함', 'r'], ['승인', 'r'], ['실집행', 'r'], ['집행률', 'r'], ['항목', 'r']].map(([h, cl]) => el('th', { cls: cl, text: h })))]), sb])])]));
  }
  function budgetRow(x, groups) {
    const set = (k, v) => { x[k] = v; saveBudget(); };
    const p = num(x.plan), a = num(x.actual);
    const hot = a != null && a > (p || 0);
    const sel = ui.peek && ui.peek.type === 'budget' && ui.peek.id === x.id;
    return el('tr', { cls: 'r' + (x.paidAt ? ' paid' : '') + (sel ? ' sel' : ''), tabindex: 0, onclick: () => openPeek('budget', x.id), onkeydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) openPeek('budget', x.id); } }, [
      el('td', { cls: 'note num', text: x.id }),
      el('td', { cls: 'c-name' }, [el('div', { cls: 'name-wrap' }, [textIn(x.title, v => set('title', v), { id: 'bt-title-' + x.id, cls: 'cell-in', ph: '항목명', label: x.id + ' 항목' }), el('span', { cls: 'open-btn', text: '열기' })])]),
      el('td', { cls: 'r' }, [moneyIn(p, v => set('plan', v), { id: 'bt-plan-' + x.id, label: x.id + ' 계획' })]),
      el('td', { cls: 'r' }, [moneyIn(a, v => set('actual', v), { id: 'bt-act-' + x.id, label: x.id + ' 실집행' })]),
      el('td', { cls: 'r num' + (hot ? ' hot' : ''), text: p ? pct(a == null ? 0 : a / p) : (a ? '계획 외' : '—') }),
      el('td', {}, [plainSelect([...(x.group ? [] : [{ value: '', label: '(없음)' }]), ...groups.map(g => ({ value: g.id, label: g.label }))], x.group || '', v => set('group', v), { id: 'bt-g-' + x.id, cls: 'cell-in', label: x.id + ' 구분' })]),
      el('td', {}, [textIn(x.vendor, v => set('vendor', v), { id: 'bt-vendor-' + x.id, cls: 'cell-in', ph: '업체', label: x.id + ' 업체' })]),
      el('td', {}, [dateIn(x.paidAt, v => set('paidAt', v), { typed: true, id: 'bt-paid-' + x.id, cls: 'cell-in', label: x.id + ' 지급일' })]),
      el('td', {}, [el('div', { cls: 'name-wrap' }, [textIn(x.note, v => set('note', v), { id: 'bt-note-' + x.id, cls: 'cell-in', ph: '', label: x.id + ' 메모' }),
        el('button', { type: 'button', cls: 'btn ghost icon', 'aria-label': x.id + ' 삭제', title: '항목 삭제', text: '×', disabled: !online, onclick: e => { e.stopPropagation(); deleteBudgetItem(x); } })])])
    ]);
  }
  function peekBudget(x, body, crumb) {
    const Y = yearOf(x);
    crumb.appendChild(crumbBtn('💰 예산', () => { closePeek(true); go('budget'); }));
    crumb.appendChild(document.createTextNode('/'));
    crumb.appendChild(crumbBtn(Y.year + '년', () => { ui.byear = Y.year; closePeek(true); go('budget'); }));
    crumb.appendChild(document.createTextNode('/'));
    crumb.appendChild(el('span', { text: x.id }));
    const set = (k, v, peekToo) => { x[k] = v; saveBudget(null, peekToo); };
    body.appendChild(textIn(x.title, v => set('title', v), { id: 'pk-title', cls: 'ptitle', multi: true, enterCommits: true, ph: '항목명 없음', label: '항목명' }));
    const p = num(x.plan), a = num(x.actual), groups = budgetGroups(Y);
    const props = el('div', { cls: 'props' });
    [
      prop('연도', plainSelect(S.budget.years.map(y => ({ value: String(y.year), label: y.year + '년 · ' + y.label })), String(Y.year), v => moveBudgetItem(x, Number(v)), { id: 'pk-byear', label: '연도' })),
      prop('구분', plainSelect([{ value: '', label: '(없음)' }, ...groups.map(g => ({ value: g.id, label: g.label }))], x.group || '', v => set('group', v, true), { id: 'pk-bgroup', label: '구분' })),
      prop('계획', moneyIn(p, v => set('plan', v, true), { id: 'pk-bplan', cls: 'pinput', ph: '원', label: '계획' }), el('span', { cls: 'hint', text: p != null ? man(p) : '' })),
      prop('실집행', moneyIn(a, v => set('actual', v, true), { id: 'pk-bact', cls: 'pinput', ph: '원', label: '실집행' }),
        el('span', { cls: 'hint' + (a != null && a > (p || 0) ? ' warn' : ''), text: a == null ? '' : p ? '집행률 ' + pct(a / p) + (a > p ? ' · ' + man(a - p) + ' 초과' : '') : '계획 외 집행' })),
      prop('업체', textIn(x.vendor, v => set('vendor', v), { id: 'pk-bvendor', ph: '비어 있음', label: '업체' })),
      prop('지급일', dateIn(x.paidAt, v => set('paidAt', v, true), { typed: true, id: 'pk-bpaid', label: '지급일' }), el('span', { cls: 'hint', text: x.paidAt ? '지급 완료' : '미지급' })),
      prop('연결 업무', relation(x.tasks || [], S.tasks.filter(isRoot).map(t => ({ value: t.id, label: t.id + ' ' + t.title })), v => { if (v.length) x.tasks = v; else delete x.tasks; saveBudget(null, true); }, { id: 'pk-btasks', label: '연결 업무', open: id => openPeek('task', id) }))
    ].forEach(pair => pair.forEach(n => props.appendChild(n)));
    body.appendChild(props);
    body.appendChild(el('div', { cls: 'psec' }, [el('h3', { text: '메모' }), textIn(x.note, v => set('note', v), { id: 'pk-note', multi: true, rows: 3, raw: true, ph: '견적 비교, 계약 조건, 지급 방법 등', label: '메모' })]));
    body.appendChild(el('div', { cls: 'peek-foot' }, [el('span', { cls: 'note', text: x.id + ' · ' + Y.year + '년' }),
      el('button', { type: 'button', cls: 'btn danger', text: '삭제', disabled: !online, onclick: () => deleteBudgetItem(x) })]));
  }

  /* ---------- 내보내기: Excel(.xlsx) · CSV · PDF ----------
   * 자료(업무·게시물·지표·예산·보고서 요약)마다 필터와 열을 골라 내려받는다.
   * Excel은 자료마다 시트 하나, CSV는 자료마다 파일 하나, PDF는 브라우저 인쇄 창에서 「PDF로 저장」.
   * 고른 설정은 이 브라우저에 기억한다 (localStorage). xlsx 생성은 dashboard/xlsx.js */
  const EXK = 'nets.export';
  const ex = (() => {
    let s = {}; try { s = JSON.parse(localStorage.getItem(EXK) || '{}') || {}; } catch (e) { }
    return Object.assign({ sel: { tasks: true }, f: {}, cols: {}, title: '', orient: 'landscape', withText: true, fname: '' }, s);
  })();
  const exSave = () => { try { localStorage.setItem(EXK, JSON.stringify(ex)); } catch (e) { } };
  const isLate = t => !!t.due && t.due < TODAY && !isTaskDone(t) && !isTaskOff(t);
  const ox = v => v ? 'O' : '';
  // 열: [key, 이름, 형식, 기본으로 켬, 너비]. 형식은 xlsx.js와 같다 (t 글자 · w 긴 글 · n 숫자 · won 금액 · d 날짜 · p 비율)
  const EXSETS = [
    {
      id: 'tasks', label: '업무', icon: '📋', desc: '업무·마일스톤·확인. 상위 업무 바로 아래에 하위 항목을 들여 씁니다.',
      filters: () => [['area', '영역', ['전체', ...cfg('areas')]], ['kind', '종류', ['전체', ...KINDS]], ['status', '상태', ['전체', '미완료', ...cfg('taskStatuses')]],
        ['owner', '담당', ['전체', ...cfg('owners')]], ['from', '마감 시작', 'date'], ['to', '마감 끝', 'date'], ['kids', '하위 항목 포함', 'bool', true]],
      cols: [['id', 'ID', 't', 1, 11], ['kind', '종류', 't', 1, 8], ['title', '제목', 'w', 1, 46], ['area', '영역', 't', 1, 11], ['priority', '우선', 't', 1, 6], ['owner', '담당', 't', 1, 13],
        ['start', '시작', 'd', 1], ['due', '종료(마감)', 'd', 1], ['status', '상태', 't', 1, 8], ['doneAt', '완료일', 'd', 1], ['late', '늦음', 't', 1, 6], ['progress', '진행', 't', 1, 12],
        ['parent', '상위 업무', 't', 0, 28], ['event', '행사', 't', 0], ['deliverable', '산출물', 'w', 0], ['doneWhen', '완료 기준', 'w', 0], ['deps', '선행 업무', 't', 0], ['posts', '연결 게시물', 't', 0],
        ['steps', '체크리스트', 'w', 0, 44], ['note', '메모', 'w', 1, 36]],
      rows: f => {
        const inR = d => (!f.from || (d && d >= f.from)) && (!f.to || (d && d <= f.to));
        const ok = t => (f.area === '전체' || t.area === f.area) && (f.kind === '전체' || t.kind === f.kind) && (f.owner === '전체' || t.owner === f.owner)
          && (f.status === '전체' ? true : f.status === '미완료' ? !(isTaskDone(t) || isTaskOff(t)) : t.status === f.status) && inR(t.due);
        const ai = a => { const i = cfg('areas').indexOf(a); return i < 0 ? 999 : i; };
        const rec = (t, lvl) => {
          const steps = t.steps || [], kids = childrenOf(t.id), pt = taskById(t.parent);
          return { _lvl: lvl, id: t.id, kind: t.kind, title: (lvl ? '   └ ' : '') + (t.title || ''), area: t.area, priority: t.priority, owner: t.owner, start: t.start, due: t.due, status: t.status,
            doneAt: isTaskDone(t) ? (t.doneAt || '') : '', late: isLate(t) ? '늦음' : '',
            progress: steps.length ? '체크 ' + steps.filter(s => s.done).length + '/' + steps.length : kids.length ? '하위 ' + kids.filter(isTaskDone).length + '/' + kids.length : '',
            parent: pt ? pt.id + ' ' + (pt.title || '') : '', event: t.event ? eventLabel(t.event) : '', deliverable: t.deliverable, doneWhen: t.doneWhen,
            deps: (t.deps || []).join(', '), posts: (t.posts || []).join(', '), steps: steps.map(s => (s.done ? '☑ ' : '☐ ') + s.text).join('\n'), note: t.note };
        };
        const out = [];
        S.tasks.filter(isRoot).sort((a, b) => ai(a.area) - ai(b.area) || rootSort(a, b)).forEach(r => {
          if (ok(r)) out.push(rec(r, 0));
          if (f.kids || f.kind === '마일스톤') childrenOf(r.id).filter(ok).forEach(c => out.push(rec(c, 1)));
        });
        return out;
      }
    },
    {
      id: 'posts', label: 'SNS 게시물', icon: '📣', desc: '게시 계획·상태·성과. 참여율 = (반응+댓글+공유) ÷ 노출(Facebook은 도달)',
      filters: () => [['channel', '채널', ['전체', ...CHANNELS.map(c => c.label)]], ['pillar', '필러', ['전체', ...cfg('pillars')]], ['status', '상태', ['전체', '미게시', ...cfg('postStatuses')]], ['from', '게시일 시작', 'date'], ['to', '게시일 끝', 'date']],
      cols: [['no', '#', 'n', 1, 5], ['id', 'ID', 't', 1, 6], ['date', '게시일', 'd', 1], ['dow', '요일', 't', 1, 5], ['time', '시간', 't', 0, 7], ['phase', '단계', 'n', 0, 6], ['pillar', '필러', 't', 1, 9],
        ['channels', '채널', 't', 1, 16], ['liDone', 'LI 게시', 't', 0, 7], ['fbDone', 'FB 게시', 't', 0, 7], ['liUrl', 'LI 링크', 't', 0, 30], ['fbUrl', 'FB 링크', 't', 0, 30],
        ['topic', '주제', 'w', 1, 50], ['format', '포맷', 't', 1, 14], ['cta', 'CTA', 't', 1, 16], ['status', '상태', 't', 1, 9], ['prod', '제작 마감', 'd', 1], ['approval', '공개 동의 필요', 't', 0, 8],
        ['liImpr', 'LI 노출', 'n', 0], ['liEng', 'LI 반응', 'n', 0], ['liClicks', 'LI 클릭', 'n', 0], ['liRate', 'LI 참여율', 'p', 1],
        ['fbReach', 'FB 도달', 'n', 0], ['fbEng', 'FB 반응', 'n', 0], ['fbClicks', 'FB 클릭', 'n', 0], ['fbRate', 'FB 참여율', 'p', 1],
        ['liHook', 'LinkedIn 첫 문장', 'w', 0, 40], ['fbHook', 'Facebook 첫 문장', 'w', 0, 40], ['source', '원천 자료', 'w', 0, 30], ['draft', '초안 파일', 't', 0], ['note', '메모', 'w', 1, 30]],
      rows: f => S.posts.filter(p => (!f.channel || f.channel === '전체' || chOn(p, chOf(f.channel).k)) && (f.pillar === '전체' || p.pillar === f.pillar)
        && (f.status === '전체' ? true : f.status === '미게시' ? !isPostDone(p) && !isPostDrop(p) : p.status === f.status)
        && (!f.from || p.date >= f.from) && (!f.to || p.date <= f.to))
        .sort((a, b) => a.date.localeCompare(b.date) || (num(a.no) || 0) - (num(b.no) || 0))
        .map(p => { const li = p.li || {}, fb = p.fb || {}; const cs = k => chOn(p, k) ? (chDone(p, k) ? '게시 ✓' : '예정') : '안 함'; return { no: p.no, id: p.id, date: p.date, dow: DAYS[P(p.date).getDay()], time: p.time, phase: p.phase, pillar: p.pillar, topic: p.topic, format: p.format, cta: p.cta, status: p.status,
          channels: CHANNELS.filter(c => chOn(p, c.k)).map(c => c.label + (chDone(p, c.k) ? ' ✓' : '')).join(' · '), liDone: cs('li'), fbDone: cs('fb'), liUrl: li.url || '', fbUrl: fb.url || '',
          prod: prodDeadline(p), approval: ox(p.approval), liImpr: li.impr, liEng: li.eng, liClicks: li.clicks, liRate: rate(li.eng, li.impr), fbReach: fb.reach, fbEng: fb.eng, fbClicks: fb.clicks, fbRate: rate(fb.eng, fb.reach),
          liHook: p.liHook, fbHook: p.fbHook, source: p.source, draft: p.draft, note: p.note }; })
    },
    {
      id: 'metrics', label: '지표', icon: '📈', desc: '주간 기록 (팔로워, 행사 경유 수)',
      filters: () => [['from', '기준일 시작', 'date'], ['to', '기준일 끝', 'date']],
      cols: [['date', '기준일', 'd', 1], ...MFIELDS.map(([k, l]) => [k, l, 'n', 1, 14])],
      rows: f => [...S.metrics].filter(m => (!f.from || m.date >= f.from) && (!f.to || m.date <= f.to)).sort((a, b) => a.date.localeCompare(b.date)).map(m => Object.assign({}, m))
    },
    {
      id: 'budget', label: '예산', icon: '💰', desc: '구분(큰 항목) 아래 하위 항목. 소계·합계 줄은 굵게.',
      filters: () => [['year', '연도', ['전체', ...S.budget.years.map(y => String(y.year))]], ['subtotal', '소계·합계 줄', 'bool', true]],
      cols: [['year', '연도', 'n', 0, 7], ['id', 'ID', 't', 1, 7], ['group', '구분', 't', 1, 16], ['title', '항목', 't', 1, 30], ['plan', '계획', 'won', 1], ['actual', '실집행', 'won', 1], ['rate', '집행률', 'p', 1],
        ['vendor', '업체', 't', 1, 16], ['paidAt', '지급일', 'd', 1], ['tasks', '연결 업무', 't', 0], ['note', '메모', 'w', 1, 34]],
      rows: f => {
        const out = [];
        S.budget.years.filter(Y => f.year === '전체' || String(Y.year) === f.year).forEach(Y => {
          const line = (x, g) => ({ year: Y.year, id: x.id, group: g ? g.label : '구분 없음', title: x.title, plan: num(x.plan), actual: num(x.actual), rate: num(x.plan) ? (num(x.actual) || 0) / num(x.plan) : null, vendor: x.vendor, paidAt: x.paidAt, tasks: (x.tasks || []).join(', '), note: x.note });
          const tot = (label, list, extra) => { const p = sum(list, 'plan'), a = sum(list, 'actual'); return Object.assign({ _b: 1, year: Y.year, group: label, plan: list.some(x => num(x.plan) != null) ? p : null, actual: list.some(x => num(x.actual) != null) ? a : null, rate: p ? a / p : null }, extra); };
          budgetGroups(Y).forEach(g => {
            const list = Y.items.filter(x => x.group === g.id);
            list.forEach(x => out.push(line(x, g)));
            if (f.subtotal && list.length) out.push(tot(g.label + ' 소계', list));
          });
          const orphan = Y.items.filter(x => !x.group);
          orphan.forEach(x => out.push(line(x, null)));
          if (f.subtotal) {
            const c = yearCalc(Y);
            out.push(tot(Y.year + '년 합계', Y.items, { title: (c.hasPlan ? '예비비 ' + Math.round((num(Y.reserveRate) || 0) * 100) + '% 포함 ' + won(c.total) + '원' : '계획 금액 미입력') + ' · 승인액 ' + (c.approved == null ? '미승인' : won(c.approved) + '원') }));
          }
        });
        return out;
      }
    },
    {
      id: 'blocks', label: '상위 업무 진행', icon: '🧩', desc: '하위 항목(마일스톤)이 있는 상위 업무별 완료율·늦음·다음 할 일',
      filters: () => [['area', '영역', ['전체', ...cfg('areas')]]],
      cols: [['id', 'ID', 't', 1, 9], ['title', '상위 업무', 'w', 1, 34], ['area', '영역', 't', 1, 10], ['status', '상태', 't', 1, 8], ['due', '마감', 'd', 1], ['kids', '하위 완료', 't', 1, 10],
        ['rate', '완료율', 'p', 1], ['late', '늦음', 'n', 1, 6], ['next', '다음 할 일', 'w', 1, 40], ['nextDue', '다음 마감', 'd', 1]],
      rows: f => {
        const ai = a => { const i = cfg('areas').indexOf(a); return i < 0 ? 999 : i; };
        return S.tasks.filter(t => isRoot(t) && childrenOf(t.id).length && (f.area === '전체' || t.area === f.area)).sort((a, b) => ai(a.area) - ai(b.area) || rootSort(a, b)).map(t => {
          const k = childrenOf(t.id).filter(c => !isTaskOff(c)), d = k.filter(isTaskDone).length, nx = k.filter(c => !isTaskDone(c)).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'))[0];
          return { id: t.id, title: t.title, area: t.area, status: t.status, due: t.due, kids: d + '/' + k.length, rate: k.length ? d / k.length : null, late: k.filter(isLate).length,
            next: nx ? nx.id + ' ' + (nx.title || '') : '모두 완료', nextDue: nx ? nx.due : '' };
        });
      }
    },
    {
      id: 'report', label: '보고서 요약', icon: '📊', desc: '보고서 페이지와 같은 계산: 기간·묶음별 마감·완료·늦음·이행률. PDF에는 보고 문구도 넣을 수 있습니다.',
      filters: f => [['area', '영역', ['전체', ...cfg('areas')]], ['period', '기간', PERIODS.map(([v, l]) => ({ value: v, label: l }))], ...(f.period === 'custom' ? [['from', '시작', 'date'], ['to', '끝', 'date']] : []),
        ['group', '묶음', RGROUPS.map(g => ({ value: g[0], label: g[1] + '별' }))]],
      defaults: { period: 'thisMonth', group: 'area', area: '전체' },
      cols: [['key', '구분', 't', 1, 18], ['due', '기간 내 마감', 'n', 1, 12], ['dueDone', '마감 중 완료', 'n', 1, 12], ['late', '늦음', 'n', 1, 8], ['rate', '이행률(오늘까지 마감 기준)', 'p', 1, 14], ['done', '기간 중 완료', 'n', 1, 12]],
      ctx: f => { const [from, to] = periodRange({ period: f.period, from: f.from, to: f.to }); const G = RGROUPS.find(g => g[0] === f.group) || RGROUPS[0]; return { from, to, G, R: reportData(from, to, f.area) }; },
      rows: f => {
        const { G, R } = EXSETS.find(d => d.id === 'report').ctx(f);
        const keys = G[3]().concat([...new Set([...R.due, ...R.done].map(G[2]))].filter(k => k != null && !G[3]().includes(k)));
        const row = (key, due, done, b) => { const past = due.filter(t => t.due <= TODAY); return { _b: b, key, due: due.length, dueDone: due.filter(isTaskDone).length, late: due.filter(t => !isTaskDone(t) && t.due < TODAY).length, rate: past.length ? past.filter(isTaskDone).length / past.length : null, done: done.length }; };
        const out = keys.map(k => row(k, R.due.filter(t => G[2](t) === k), R.done.filter(t => G[2](t) === k))).filter(r => r.due || r.done);
        out.push(row('합계', R.due, R.done, 1));
        return out;
      }
    }
  ];
  // 필터 값: 저장된 값 → 없으면 기본값(선택지 첫 값, bool 기본, defaults)
  function exF(d) {
    const f = ex.f[d.id] = ex.f[d.id] || {};
    Object.assign(f, Object.assign({}, d.defaults, f));
    d.filters(f).forEach(([k, , opts, def]) => {
      if (f[k] !== undefined) return;
      f[k] = opts === 'bool' ? def !== false : opts === 'date' ? '' : typeof opts[0] === 'object' ? opts[0].value : opts[0];
    });
    return f;
  }
  const exCols = d => { const keys = ex.cols[d.id]; return d.cols.filter(c => keys ? keys.includes(c[0]) : c[3]); };
  // 내보낼 표: 열 이름·형식 + 값 배열. f·cols를 주면 저장된 설정 대신 그것으로 (보고서 발행 등)
  function exTable(d, f, cols) {
    f = f || exF(d); cols = cols || exCols(d);
    const recs = d.rows(f);
    return { name: d.label, cols: cols.map(c => ({ key: c[0], label: c[1], type: c[2], width: c[4] })), rows: recs.map(r => ({ v: cols.map(c => r[c[0]] == null ? null : r[c[0]]), b: !!r._b, lvl: r._lvl || 0 })), f };
  }
  function exFilterText(d, f) {
    f = f || exF(d);
    const parts = d.filters(f).filter(([k, , o]) => o !== 'bool' && f[k] && f[k] !== '전체').map(([k, l, o]) => l + ' ' + (Array.isArray(o) && typeof o[0] === 'object' ? (o.find(x => x.value === f[k]) || {}).label : f[k]));
    if (d.id === 'report') { const c = d.ctx(f); parts.push(md(c.from) + ' ~ ' + md(c.to)); }
    return parts.join(' · ');
  }
  const exStamp = () => TODAY.replace(/-/g, '');
  const exName = list => (ex.fname || '').trim() || ('NETS_마케팅_' + (list.length === 1 ? list[0].label.replace(/\s+/g, '') + '_' : '') + exStamp());
  function download(blob, name) {
    const a = el('a', { href: URL.createObjectURL(blob), download: name, style: 'display:none' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const exSel = () => EXSETS.filter(d => ex.sel[d.id]);
  // 내보낼 묶음: [{ d: 자료, f: 필터, cols: 열(선택) }]. 기본은 내보내기 창에서 고른 것
  const exItems = () => exSel().map(d => ({ d, f: exF(d) }));
  const exOpts = o => Object.assign({ title: ex.title, fname: ex.fname, withText: ex.withText, orient: ex.orient }, o);
  const fileName = (items, o) => (o.fname || '').trim() || ('NETS_마케팅_' + (items.length === 1 ? items[0].d.label.replace(/\s+/g, '') + '_' : '') + exStamp());
  const reportSheet = c => ({ name: '보고 문구', filter: false, cols: [{ label: '보고 문구 (' + (c.R.area ? c.R.area + ' · ' : '') + md(c.from) + ' ~ ' + md(c.to) + ')', type: 't', width: 110 }], rows: reportText(c.from, c.to, c.R, c.G).split('\n').map(s => ({ v: [s], b: /^#/.test(s) })) });
  function exportXlsx(items, o) {
    items = items || exItems(); o = exOpts(o); if (!items.length) return;
    const sheets = items.map(it => exTable(it.d, it.f, it.cols));
    items.filter(it => it.d.id === 'report').forEach(it => { if (o.withText) sheets.splice(sheets.indexOf(sheets.find(s => s.f === it.f)) + 1, 0, reportSheet(it.d.ctx(it.f))); });
    download(new Blob([NetsXlsx.workbook(sheets)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName(items, o) + '.xlsx');
  }
  function exportCsv(items, o) {
    items = items || exItems(); o = exOpts(o);
    items.forEach((it, i) => setTimeout(() => download(new Blob([NetsXlsx.csv(exTable(it.d, it.f, it.cols))], { type: 'text/csv;charset=utf-8' }), fileName(items.length > 1 ? [it] : items, items.length > 1 ? exOpts({ fname: '' }) : o) + '.csv'), i * 400));
  }
  // 보고서 페이지 「발행」: 지금 고른 영역·기간·묶음 그대로 (요약 + 보고 문구 [+ 그 기간 업무 목록])
  function publishReport(fmt, summaryOnly) {
    const [from, to] = periodRange(), area = ui.rp.area;
    const rep = EXSETS.find(d => d.id === 'report'), tasks = EXSETS.find(d => d.id === 'tasks');
    const items = [{ d: rep, f: { area, period: ui.rp.period, from: ui.rp.from, to: ui.rp.to, group: ui.rp.group } }];
    if (!summaryOnly) items.push({ d: tasks, f: { area, kind: '전체', status: '전체', owner: '전체', from, to, kids: true }, cols: tasks.cols.filter(c => c[3]) });
    const label = '마케팅 활동 보고' + (area !== '전체' ? ' · ' + area : '');
    const o = { title: label + ' (' + md(from) + ' ~ ' + md(to) + ')', fname: 'NETS_보고서_' + (area !== '전체' ? area.replace(/[\s·\/]+/g, '') + '_' : '') + from.replace(/-/g, '') + '-' + to.replace(/-/g, ''), withText: true, orient: 'portrait' };
    if (fmt === 'xlsx') exportXlsx(items, o); else exportPdf(items, o);
  }

  /* ---------- 탭별 보고서: 각 페이지·영역 탭 오른쪽 위 「📄 보고서 ▾」 ----------
   * 탭마다 넣을 내용·기간·묶음·업무 목록 범위와 열을 정해 두면(이 브라우저에 기억) 메뉴에서 바로 PDF·Excel로 발행한다 */
  const RPK = 'nets.reports';
  const rpStore = (() => { try { return JSON.parse(localStorage.getItem(RPK) || '{}') || {}; } catch (e) { return {}; } })();
  const rpSaveStore = () => { try { localStorage.setItem(RPK, JSON.stringify(rpStore)); } catch (e) { } };
  const RP_PAGES = ['week', 'tasks', 'metrics', 'budget'];
  const RSECS = [['summary', '요약 표', '기간 내 마감·완료·늦음·이행률을 묶음별로'], ['text', '보고 문구', '요약을 문장으로 (요약 표와 함께)'], ['blocks', '상위 업무 진행', '세미나·전시처럼 하위가 있는 업무별 완료율·다음 할 일'],
    ['tasks', '업무 목록', '상위 업무 아래 하위 항목 들여쓰기'], ['posts', 'SNS 게시물', '기간 내 게시 계획·상태·참여율'], ['metrics', '지표', '기간 내 주간 기록'], ['budget', '예산', '구분별 계획·실집행·소계']];
  const TSCOPES = [['period', '기간 내 마감'], ['open', '남은 일 전체'], ['all', '전체']];
  function rpTab() {
    const pg = PAGES.find(p => p.id === ui.page) || PAGES[0];
    const area = pg.id === 'tasks' ? ui.area : '전체';
    return { key: pg.id + (pg.id === 'tasks' && area !== '전체' ? '/' + area : ''), page: pg.id, area, label: pg.id === 'tasks' ? (area !== '전체' ? area : '업무 전체') : pg.label };
  }
  function rpDefaults(T) {
    const all = T.area === '전체';
    const c = { title: '', period: 'thisMonth', from: '', to: '', group: all ? 'area' : 'kind', taskScope: 'period', kids: true, taskCols: null, orient: 'portrait',
      sec: { summary: true, text: true, blocks: false, tasks: true, posts: false, metrics: false, budget: false } };
    if (T.page === 'week') { c.period = 'thisWeek'; c.sec.posts = true; }
    if (T.page === 'tasks') { c.sec.posts = all || T.area === 'SNS'; c.sec.blocks = EXSETS.find(d => d.id === 'blocks').rows({ area: T.area }).length > 0; }
    if (T.page === 'metrics') { c.period = 'quarter'; c.sec = { metrics: true }; }
    if (T.page === 'budget') { c.period = 'quarter'; c.sec = { budget: true }; c.orient = 'landscape'; }
    return c;
  }
  function rpGet(T) {
    const d = rpDefaults(T), s = rpStore[T.key];
    return s ? Object.assign(d, s, { sec: Object.assign({}, d.sec, s.sec) }) : d;
  }
  const rpRange = c => periodRange({ period: c.period, from: c.from, to: c.to });
  function rpItems(T, c) {
    const [from, to] = rpRange(c), area = T.area, D = id => EXSETS.find(d => d.id === id), items = [];
    if (c.sec.summary) items.push({ d: D('report'), f: { area, period: c.period, from: c.from, to: c.to, group: c.group } });
    if (c.sec.blocks) items.push({ d: D('blocks'), f: { area } });
    if (c.sec.tasks) {
      const tk = D('tasks'), inP = c.taskScope === 'period';
      items.push({ d: tk, f: { area, kind: '전체', status: c.taskScope === 'open' ? '미완료' : '전체', owner: '전체', from: inP ? from : '', to: inP ? to : '', kids: c.kids !== false },
        cols: c.taskCols ? tk.cols.filter(col => c.taskCols.includes(col[0])) : tk.cols.filter(col => col[3] && !(area !== '전체' && col[0] === 'area')) });
    }
    if (c.sec.posts) items.push({ d: D('posts'), f: { pillar: '전체', status: '전체', from, to } });
    if (c.sec.metrics) items.push({ d: D('metrics'), f: { from, to } });
    if (c.sec.budget) { const Y = S.budget && curYear(); items.push({ d: D('budget'), f: { year: Y ? String(Y.year) : '전체', subtotal: true } }); }
    return items;
  }
  function rpOpts(T, c) {
    const [from, to] = rpRange(c), span = md(from) + ' ~ ' + md(to);
    const def = (T.page === 'budget' ? '예산 보고' : T.page === 'metrics' ? '지표 보고' : '마케팅 활동 보고') + (T.area !== '전체' ? ' · ' + T.area : T.page === 'week' ? ' · 이번 주' : '');
    return { title: (c.title || '').trim() ? c.title.trim() + ' (' + span + ')' : def + ' (' + span + ')', withText: !!(c.sec.summary && c.sec.text), orient: c.orient || 'portrait',
      fname: 'NETS_보고서_' + T.label.replace(/[\s·\/]+/g, '') + '_' + from.replace(/-/g, '') + '-' + to.replace(/-/g, '') };
  }
  function rpPublish(fmt, T) {
    T = T || rpTab(); const c = rpGet(T), items = rpItems(T, c);
    if (!items.length) { alert('보고서에 넣을 내용이 없습니다. 「보고서 구성」에서 하나 이상 골라 주세요.'); return rpOpen(); }
    closeMenu();
    if (fmt === 'xlsx') exportXlsx(items, rpOpts(T, c)); else exportPdf(items, rpOpts(T, c));
  }
  function rpMenu(anchor) {
    const T = rpTab(), c = rpGet(T), [from, to] = rpRange(c);
    const secs = RSECS.filter(([k]) => c.sec[k] && !(k === 'text' && !c.sec.summary)).map(s => s[1]).join(' · ') || '넣을 내용 없음';
    openMenu(anchor, [{ head: T.label + ' 보고서 · ' + mdShort(from) + '~' + mdShort(to) }, { head: secs },
      { label: '🖨 PDF로 발행', run: () => rpPublish('pdf', T) }, { label: '⤓ Excel로 발행', run: () => rpPublish('xlsx', T) },
      { sep: true }, { label: '⚙ 보고서 구성 바꾸기…', run: () => rpOpen() }]);
  }
  let rpDlg = null, rpT = null;
  function closeRp() { if (rpDlg) { rpDlg.remove(); rpDlg = null; } }
  function rpOpen() {
    closeMenu(); if (ui.peek) closePeek(true);
    rpT = rpTab();
    if (!rpDlg) { rpDlg = el('div', { cls: 'modal-scrim' }); rpDlg.addEventListener('mousedown', e => { if (e.target === rpDlg) closeRp(); }); document.body.appendChild(rpDlg); }
    rpRender();
  }
  function rpRender() {
    if (!rpDlg) return;
    const old = rpDlg.querySelector('.modal-body'), st = old ? old.scrollTop : 0, fid = document.activeElement && rpDlg.contains(document.activeElement) ? document.activeElement.id : null;
    rpDlg.textContent = '';
    const T = rpT, c = rpGet(T), [from, to] = rpRange(c);
    const set = (k, v) => { c[k] = v; rpStore[T.key] = c; rpSaveStore(); rpRender(); };
    const body = el('div', { cls: 'modal-body' });
    rpDlg.appendChild(el('div', { cls: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': '보고서 구성' }, [
      el('div', { cls: 'modal-head' }, [el('h2', { text: '📄 ' + T.label + ' 보고서 구성' }),
        el('button', { type: 'button', cls: 'btn ghost icon', 'aria-label': '닫기', title: '닫기 (Esc)', text: '×', onclick: closeRp })]), body]));
    body.appendChild(el('p', { cls: 'note', text: '이 탭에서 낼 보고서를 정합니다. 한 번 정해 두면 오른쪽 위 「📄 보고서 ▾」에서 바로 PDF·Excel로 발행됩니다. 탭마다 따로, 이 브라우저에 기억됩니다.' }));
    const free = n => { n.disabled = false; return n; };
    const seg = (opts, cur, on) => el('div', { cls: 'seg' }, opts.map(([v, l]) => el('button', { type: 'button', 'aria-pressed': String(cur === v), text: l, onclick: () => on(v) })));

    // 제목 · 기간
    const title = free(textIn(c.title, v => set('title', v), { id: 'rp-title', ph: rpOpts(T, Object.assign({}, c, { title: '' })).title.replace(/ \(.*\)$/, ''), label: '보고서 제목' }));
    const period = seg(PERIODS, c.period, v => { if (v === 'custom' && !c.from) { c.from = from; c.to = to; } set('period', v); });
    const custom = c.period === 'custom' ? el('span', { cls: 'filters' }, [free(dateIn(from, v => set('from', v || ''), { id: 'rp-c-from', cls: 'search', label: '시작일' })), '~', free(dateIn(to, v => set('to', v || ''), { id: 'rp-c-to', cls: 'search', label: '종료일' }))]) : null;
    body.appendChild(el('section', { cls: 'sec' }, [secHead('1. 제목·기간'),
      el('div', { cls: 'ex-row' }, [el('div', { cls: 'ex-lk', text: '제목' }), el('div', { cls: 'form-grid' }, [el('label', { for: 'rp-title' }, ['비우면 자동 (기간은 뒤에 붙음)', title])])]),
      el('div', { cls: 'ex-row' }, [el('div', { cls: 'ex-lk', text: '기간' }), el('div', { cls: 'filters' }, [period, custom, el('span', { cls: 'note', text: md(from) + ' ~ ' + md(to) })])])]));

    // 넣을 내용
    const items = rpItems(T, c), cnt = {};
    items.forEach(it => { cnt[it.d.id] = exTable(it.d, it.f, it.cols).rows.filter(r => !r.b).length; });
    const secCards = el('div', { cls: 'ex-cards' }, RSECS.map(([k, l, desc]) => {
      const dis = k === 'text' && !c.sec.summary;
      const cb = free(checkIn(!!c.sec[k] && !dis, v => { c.sec = Object.assign({}, c.sec, { [k]: v }); set('sec', c.sec); }, { id: 'rp-sec-' + k, label: l }));
      cb.disabled = dis;
      const n = { summary: 'report', blocks: 'blocks', tasks: 'tasks', posts: 'posts', metrics: 'metrics', budget: 'budget' }[k];
      return el('label', { cls: 'ex-card' + (c.sec[k] && !dis ? ' on' : '') + (dis ? ' off' : ''), for: 'rp-sec-' + k }, [cb,
        el('span', { cls: 'ex-t' }, [el('b', { text: l }), el('small', { text: (n && cnt[n] != null ? cnt[n] + (k === 'summary' ? '줄' : '건') + ' · ' : '') + desc })])]);
    }));
    body.appendChild(el('section', { cls: 'sec' }, [secHead('2. 넣을 내용', el('span', { cls: 'note', text: 'PDF는 내용마다 새 쪽, Excel은 내용마다 시트 하나' })), secCards]));

    // 세부 설정
    const rows = [];
    if (c.sec.summary) {
      const g = free(plainSelect(RGROUPS.map(x => ({ value: x[0], label: x[1] + '별' })), c.group, v => set('group', v), { id: 'rp-group-sel', cls: '', label: '요약 묶음' }));
      rows.push(el('div', { cls: 'ex-row' }, [el('div', { cls: 'ex-lk', text: '요약 묶음' }), el('div', { cls: 'filters' }, [el('label', { cls: 'fpill on', for: 'rp-group-sel' }, ['묶음', g])])]));
    }
    if (c.sec.tasks) {
      const tk = EXSETS.find(d => d.id === 'tasks'), keys = new Set((items.find(it => it.d === tk).cols || []).map(x => x[0]));
      const kids = free(checkIn(c.kids !== false, v => set('kids', v), { id: 'rp-kids', label: '하위 항목 포함' }));
      rows.push(el('div', { cls: 'ex-row' }, [el('div', { cls: 'ex-lk', text: '업무 범위' }), el('div', { cls: 'filters' }, [seg(TSCOPES, c.taskScope, v => set('taskScope', v)), el('label', { cls: 'cal-toggle', for: 'rp-kids' }, [kids, '하위 항목 포함'])])]));
      const chips = el('div', { cls: 'ex-cols' }, tk.cols.map(col => {
        const id = 'rp-col-' + col[0];
        const cb = free(checkIn(keys.has(col[0]), v => { v ? keys.add(col[0]) : keys.delete(col[0]); set('taskCols', tk.cols.map(x => x[0]).filter(x => keys.has(x))); }, { id, label: col[1] + ' 열' }));
        return el('label', { cls: 'ex-col' + (keys.has(col[0]) ? ' on' : ''), for: id }, [cb, col[1]]);
      }));
      rows.push(el('div', { cls: 'ex-row' }, [el('div', { cls: 'ex-lk' }, ['업무 목록 열', el('span', { cls: 'seg' }, [el('button', { type: 'button', text: '기본', onclick: () => set('taskCols', null) })])]), chips]));
    }
    rows.push(el('div', { cls: 'ex-row' }, [el('div', { cls: 'ex-lk', text: 'PDF 방향' }), seg([['portrait', '세로'], ['landscape', '가로']], c.orient, v => set('orient', v))]));
    body.appendChild(el('section', { cls: 'sec ex-set' }, [secHead('3. 세부 설정')].concat(rows)));

    // 발행
    body.appendChild(el('section', { cls: 'sec' }, [
      el('div', { cls: 'ex-btns' }, [
        el('button', { type: 'button', cls: 'btn primary', text: '🖨 PDF로 발행', disabled: !items.length, onclick: () => { closeRp(); rpPublish('pdf', T); } }),
        el('button', { type: 'button', cls: 'btn', text: '⤓ Excel로 발행', disabled: !items.length, onclick: () => rpPublish('xlsx', T) }),
        el('span', { cls: 'spacer' }),
        el('button', { type: 'button', cls: 'btn ghost', text: '기본 구성으로', onclick: () => { delete rpStore[T.key]; rpSaveStore(); rpRender(); } })
      ]),
      el('p', { cls: 'note', text: 'PDF는 인쇄 창이 열리면 대상을 「PDF로 저장」으로 고르세요. 파일 이름: ' + rpOpts(T, c).fname })
    ]));
    body.scrollTop = st;
    const f = fid && $(fid); if (f) f.focus({ preventScroll: true });
  }
  // PDF: 숨은 iframe에 인쇄용 문서를 만들어 인쇄 창을 연다 → 대상 「PDF로 저장」
  function exportPdf(items, o) {
    items = items || exItems(); o = exOpts(o); if (!items.length) return;
    const list = items.map(it => it.d);
    const h = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const fmt = (v, t) => v == null || v === '' ? '' : t === 'won' ? won(v) : t === 'p' ? pct(v) : t === 'd' ? (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v.slice(2).replace(/-/g, '.') + ' (' + DAYS[P(v).getDay()] + ')' : v) : String(v);
    const title = (o.title || '').trim() || 'NETS 마케팅 ' + (list.length === 1 ? list[0].label : '자료');
    let body = `<h1>${h(title)}</h1><div class="meta">${h(md(TODAY))} 기준 · 넷츠 마케팅</div>`;
    items.forEach(({ d, f, cols }) => {
      const T = exTable(d, f, cols), ft = exFilterText(d, T.f);
      body += `<section><h2>${h(d.label)} <small>${T.rows.filter(r => !r.b).length}건</small></h2>` + (ft ? `<p class="sub">${h(ft)}</p>` : '');
      if (!T.cols.length) body += '<p class="empty">고른 열이 없습니다.</p>';
      else if (!T.rows.length) body += '<p class="empty">조건에 맞는 항목이 없습니다.</p>';
      else body += `<table><thead><tr>${T.cols.map(c => `<th class="${c.type}">${h(c.label)}</th>`).join('')}</tr></thead><tbody>` +
        T.rows.map(r => `<tr class="${r.b ? 'b' : ''}${r.lvl ? ' l1' : ''}">` + T.cols.map((c, i) => {
          let v = fmt(r.v[i], c.type); if (c.key === 'title' && r.lvl) v = v.replace(/^\s*└\s*/, '');
          return `<td class="${c.type}${c.key === 'title' ? ' tt' : ''}${c.type === 't' && (c.width || 14) <= 13 ? ' nw' : ''}">${h(v).replace(/\n/g, '<br>')}</td>`;
        }).join('') + '</tr>').join('') + '</tbody></table>';
      if (d.id === 'report' && o.withText) { const c = d.ctx(T.f); body += `<h3>보고 문구</h3><pre>${h(reportText(c.from, c.to, c.R, c.G))}</pre>`; }
      body += '</section>';
    });
    const doc = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${h(title)}</title><style>
@page{size:A4 ${o.orient === 'portrait' ? 'portrait' : 'landscape'};margin:12mm 11mm}
*{box-sizing:border-box}
body{font-family:'Malgun Gothic','맑은 고딕','Noto Sans KR','Apple SD Gothic Neo',sans-serif;color:#1f1f1f;font-size:8.6pt;line-height:1.45;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
h1{font-size:16pt;margin:0 0 2pt}
.meta{color:#666;font-size:8.5pt;margin-bottom:8pt;padding-bottom:6pt;border-bottom:1.2pt solid #1f1f1f}
section+section{break-before:page}
h2{font-size:12pt;margin:10pt 0 3pt;break-after:avoid}
h2 small{font-size:8.5pt;color:#888;font-weight:400}
h3{font-size:10pt;margin:12pt 0 4pt;break-after:avoid}
.sub{color:#555;font-size:8.3pt;margin:0 0 5pt}
table{width:100%;border-collapse:collapse}
th,td{border-bottom:.5pt solid #d6d6d3;padding:3pt 4pt;vertical-align:top;text-align:left;word-break:keep-all;overflow-wrap:anywhere}
th{background:#f1f1ef;font-weight:700;border-bottom:.9pt solid #9b9b97;white-space:nowrap}
thead{display:table-header-group}
tr{break-inside:avoid}
td.n,td.won,td.p,th.n,th.won,th.p{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
td.d,td.nw{white-space:nowrap}
tr.b td{font-weight:700;background:#f7f7f5;border-top:.7pt solid #9b9b97}
tr.l1 td{color:#333}
tr.l1 td.tt{padding-left:18pt;position:relative}
tr.l1 td.tt::before{content:'└';position:absolute;left:7pt;color:#9b9b97}
pre{white-space:pre-wrap;font-family:inherit;font-size:8.8pt;border:.5pt solid #d6d6d3;border-radius:3pt;padding:7pt 9pt;margin:0}
.empty{color:#888}
</style></head><body>${body}</body></html>`;
    const fr = el('iframe', { title: 'PDF 인쇄', 'aria-hidden': 'true', style: 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0' });
    document.body.appendChild(fr);
    const w = fr.contentWindow;
    w.document.open(); w.document.write(doc); w.document.close();
    const cleanup = () => setTimeout(() => fr.remove(), 500);
    w.addEventListener('afterprint', cleanup);
    setTimeout(() => { try { w.focus(); w.print(); } catch (e) { alert('인쇄 창을 열지 못했습니다: ' + e.message); cleanup(); } }, 250);
  }
  // 다른 페이지의 「내보내기」 버튼: 그 페이지에 맞는 자료를 골라 둔 채로 연다
  const PAGE_SETS = { week: ['tasks', 'posts'], tasks: ['tasks', 'posts'], report: ['report'], metrics: ['metrics'], budget: ['budget'] };
  function openExport(from) {
    const ids = PAGE_SETS[from];
    if (ids) { ex.sel = {}; ids.forEach(id => { ex.sel[id] = true; }); }
    if (from === 'report') { const f = ex.f.report = ex.f.report || {}; f.period = ui.rp.period; f.from = ui.rp.from; f.to = ui.rp.to; f.group = ui.rp.group; f.area = ui.rp.area; }
    if (from === 'budget' && S.budget) { const Y = curYear(); if (Y) { const f = ex.f.budget = ex.f.budget || {}; f.year = String(Y.year); } }
    if (from === 'tasks') { const f = ex.f.tasks = ex.f.tasks || {}; f.area = ui.area; f.kind = ui.kind; f.status = ui.status; f.owner = ui.owner; if (ui.area !== '전체' && ui.area !== 'SNS') ex.sel = { tasks: true }; }
    exSave(); ui.exFrom = from;
    closeMenu(); if (ui.peek) closePeek(true);
    if (!exDlg) { exDlg = el('div', { cls: 'modal-scrim' }); exDlg.addEventListener('mousedown', e => { if (e.target === exDlg) closeExport(); }); document.body.appendChild(exDlg); }
    exRender();
  }
  // 내보내기 창 (각 페이지 오른쪽 위 「⤓ 내보내기」): 그 페이지 자료·필터가 골라진 채로 열리고, 다른 자료도 더 고를 수 있다
  let exDlg = null;
  function closeExport() { if (exDlg) { exDlg.remove(); exDlg = null; } }
  function exRender() {
    if (!exDlg) return;
    const old = exDlg.querySelector('.modal-body'), st = old ? old.scrollTop : 0, fid = document.activeElement && exDlg.contains(document.activeElement) ? document.activeElement.id : null;
    exDlg.textContent = '';
    const pg = PAGES.find(p => p.id === ui.exFrom);
    const body = el('div', { cls: 'modal-body' });
    exDlg.appendChild(el('div', { cls: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': '내보내기' }, [
      el('div', { cls: 'modal-head' }, [el('h2', { text: '⤓ 내보내기' + (pg ? ' · ' + pg.label + (pg.id === 'tasks' && ui.area !== '전체' ? ' / ' + ui.area : '') : '') }),
        el('button', { type: 'button', cls: 'btn ghost icon', 'aria-label': '닫기', title: '닫기 (Esc)', text: '×', onclick: closeExport })]), body]));
    renderExport(body);
    body.scrollTop = st;
    const f = fid && $(fid); if (f) f.focus({ preventScroll: true });
  }

  function renderExport(root) {
    root.appendChild(el('p', { cls: 'note', text: '이 페이지 자료가 골라진 채로 열렸습니다. 다른 자료도 함께 고를 수 있고, 자료마다 필터와 열을 정한 뒤 Excel·CSV·PDF로 저장합니다. 고른 설정은 이 브라우저에 기억됩니다.' }));
    const set = () => { exSave(); exRender(); };
    // 1. 자료 고르기
    const cards = el('div', { cls: 'ex-cards' }, EXSETS.map(d => {
      const n = d.rows(exF(d)).filter(r => !r._b).length, on = !!ex.sel[d.id];
      const c = checkIn(on, v => { ex.sel[d.id] = v; set(); }, { id: 'ex-sel-' + d.id, label: d.label }); c.disabled = false;
      return el('label', { cls: 'ex-card' + (on ? ' on' : ''), for: 'ex-sel-' + d.id }, [c, el('span', { cls: 'ex-ic', 'aria-hidden': 'true', text: d.icon }),
        el('span', { cls: 'ex-t' }, [el('b', { text: d.label }), el('small', { text: n + '건 · ' + d.desc })])]);
    }));
    root.appendChild(el('section', { cls: 'sec' }, [secHead('1. 자료 고르기', el('span', { cls: 'note', text: 'Excel은 자료마다 시트 하나로, PDF는 자료마다 새 쪽으로 나뉩니다' })), cards]));

    // 2. 자료별 필터·열 + 미리보기
    const list = exSel();
    if (list.length) root.appendChild(el('h3', { cls: 'ex-step', text: '2. 필터·열 고르기' }));
    else root.appendChild(el('div', { cls: 'empty', text: '위에서 내보낼 자료를 하나 이상 고르세요.' }));
    list.forEach(d => {
      const f = exF(d);
      const fl = d.filters(f).map(([k, l, o]) => {
        const id = 'ex-' + d.id + '-' + k;
        let ctl;
        if (o === 'bool') { ctl = checkIn(f[k], v => { f[k] = v; set(); }, { id, label: l }); ctl.disabled = false; return el('label', { cls: 'cal-toggle', for: id }, [ctl, l]); }
        if (o === 'date') { ctl = dateIn(f[k], v => { f[k] = v || ''; set(); }, { id, label: l, cls: 'search' }); ctl.disabled = false; return el('label', { cls: 'ex-date', for: id }, [l, ctl]); }
        ctl = plainSelect(o, f[k], v => { f[k] = v; set(); }, { id, label: l, cls: '' }); ctl.disabled = false;
        const on = f[k] !== '전체' && !(typeof o[0] === 'object' && f[k] === o[0].value && d.id !== 'report');
        return el('label', { cls: 'fpill' + (on ? ' on' : ''), for: id }, [l, ctl]);
      });
      const keys = new Set(exCols(d).map(c => c[0]));
      const setCols = ks => { ex.cols[d.id] = d.cols.map(c => c[0]).filter(k => ks.has(k)); set(); };
      const chips = el('div', { cls: 'ex-cols' }, d.cols.map(c => {
        const id = 'ex-c-' + d.id + '-' + c[0];
        const cb = checkIn(keys.has(c[0]), v => { v ? keys.add(c[0]) : keys.delete(c[0]); setCols(keys); }, { id, label: c[1] + ' 열' }); cb.disabled = false;
        return el('label', { cls: 'ex-col' + (keys.has(c[0]) ? ' on' : ''), for: id }, [cb, c[1]]);
      }));
      const colBtns = el('span', { cls: 'seg' }, [
        el('button', { type: 'button', text: '기본', onclick: () => { delete ex.cols[d.id]; set(); } }),
        el('button', { type: 'button', text: '전체', onclick: () => setCols(new Set(d.cols.map(c => c[0]))) }),
        el('button', { type: 'button', text: '없음', onclick: () => setCols(new Set()) })]);
      const T = exTable(d), shown = T.rows.slice(0, 8);
      const prev = T.cols.length ? el('div', { cls: 'hscroll' }, [el('table', { cls: 'db ex-prev' }, [
        el('thead', {}, [el('tr', {}, T.cols.map(c => el('th', { cls: ['n', 'won', 'p'].includes(c.type) ? 'r' : '', text: c.label })))]),
        el('tbody', {}, shown.length ? shown.map(r => el('tr', { cls: (r.b ? 'gsum' : '') + (r.lvl ? ' r-child' : '') }, T.cols.map((c, i) => {
          const v = r.v[i], t = v == null || v === '' ? '' : c.type === 'won' ? won(v) : c.type === 'p' ? pct(v) : String(v);
          return el('td', { cls: (['n', 'won', 'p'].includes(c.type) ? 'r num' : '') + (c.key === 'title' && r.lvl ? ' ex-kid' : ''), text: t.length > 80 ? t.slice(0, 80) + '…' : t });
        }))) : [el('tr', {}, [el('td', { colspan: T.cols.length, cls: 'empty', text: '조건에 맞는 항목이 없습니다.' })])])
      ])]) : el('div', { cls: 'empty', text: '열을 하나 이상 고르세요.' });
      root.appendChild(el('section', { cls: 'sec ex-set' }, [
        secHead(d.icon + ' ' + d.label, el('span', { cls: 'note', text: T.rows.filter(r => !r.b).length + '건 · 열 ' + T.cols.length + '개' })),
        el('div', { cls: 'ex-row' }, [el('div', { cls: 'ex-lk', text: '필터' }), el('div', { cls: 'filters' }, fl)]),
        el('div', { cls: 'ex-row' }, [el('div', { cls: 'ex-lk' }, ['열 ', colBtns]), chips]),
        el('div', { cls: 'ex-row' }, [el('div', { cls: 'ex-lk', text: '미리보기' }), el('div', {}, [prev, T.rows.length > 8 ? el('p', { cls: 'note', text: '처음 8줄만 보여 줍니다 · 전체 ' + T.rows.length + '줄' }) : null])])
      ]));
    });

    // 3. 저장
    const hasRep = !!ex.sel.report;
    const fname = textIn(ex.fname, v => { ex.fname = v; exSave(); }, { id: 'ex-fname', ph: exName(list.length ? list : [{ label: '' }]), label: '파일 이름' }); fname.disabled = false;
    const title = textIn(ex.title, v => { ex.title = v; exSave(); }, { id: 'ex-title', ph: 'NETS 마케팅 ' + (list.length === 1 ? list[0].label : '자료'), label: 'PDF 제목' }); title.disabled = false;
    const orient = el('div', { cls: 'seg' }, [['landscape', '가로'], ['portrait', '세로']].map(([v, l]) => el('button', { type: 'button', 'aria-pressed': String(ex.orient === v), text: l, onclick: () => { ex.orient = v; set(); } })));
    const wt = checkIn(ex.withText, v => { ex.withText = v; set(); }, { id: 'ex-wt', label: '보고 문구 포함' }); wt.disabled = false;
    const none = !list.length;
    root.appendChild(el('section', { cls: 'sec' }, [secHead('3. 저장'),
      el('div', { cls: 'form-grid' }, [
        el('label', { for: 'ex-fname' }, ['파일 이름 (비우면 자동)', fname]),
        el('label', { for: 'ex-title' }, ['PDF 제목', title]),
        el('div', { cls: 'ex-opt' }, [el('span', { text: 'PDF 방향' }), orient]),
        hasRep ? el('label', { cls: 'cal-toggle ex-opt', for: 'ex-wt' }, [wt, '보고서 요약에 보고 문구 포함 (Excel은 시트 추가)']) : null
      ]),
      el('div', { cls: 'ex-btns' }, [
        el('button', { type: 'button', cls: 'btn primary', text: '⤓ Excel (.xlsx)', disabled: none, onclick: () => exportXlsx() }),
        el('button', { type: 'button', cls: 'btn', text: '⤓ CSV' + (list.length > 1 ? ' (' + list.length + '개 파일)' : ''), disabled: none, onclick: () => exportCsv() }),
        el('button', { type: 'button', cls: 'btn', text: '🖨 PDF로 저장', disabled: none, onclick: () => { closeExport(); exportPdf(); } })
      ]),
      el('p', { cls: 'note', text: 'PDF는 인쇄 창이 열리면 대상(프린터)을 「PDF로 저장」으로 고르세요. 화면 그대로(타임라인·차트 포함)를 PDF로 남기려면 오른쪽 위 「이 화면 PDF」를 쓰세요.' })
    ]));
  }

  /* ---------- 설정 (data/config.json) ---------- */
  const LISTS = [
    { key: 'pillars', label: '필러', ck: 'pillar', uses: [['posts', 'pillar']] },
    { key: 'postStatuses', label: '게시 상태', ck: 'postStatus', uses: [['posts', 'status']] },
    { key: 'taskStatuses', label: '업무 상태', ck: 'taskStatus', uses: [['tasks', 'status']] },
    { key: 'priorities', label: '우선순위', ck: 'priority', uses: [['tasks', 'priority']] },
    { key: 'areas', label: '영역', ck: 'area', uses: [['tasks', 'area']] },
    { key: 'owners', label: '담당', ck: 'owner', uses: [['tasks', 'owner']] },
    { key: 'meetingTypes', label: '회의 종류', ck: 'meetingType', uses: [['meetings', 'type'], ['meetingSeries', 'type']] },
    { key: 'meetingStatuses', label: '회의 상태', ck: 'meetingStatus', uses: [['meetings', 'status']] }
  ];
  // 선택지를 쓰는 목록과 그 목록이 저장되는 파일 (회의·정기 회의는 meetings.json 안에 있다)
  const rowsOf = k => k === 'meetings' ? MT() : k === 'meetingSeries' ? S.meetings.series : S[k];
  const fileOf = k => k === 'meetingSeries' ? 'meetings' : k;
  // 대시보드 계산에 쓰이는 값은 이름을 바꾸거나 지울 수 없다
  const LOCKED = { taskStatuses: ['완료', '보류'], postStatuses: ['승인대기', '예약완료', '게시완료', '대체·보류'], priorities: ['P0'], meetingStatuses: ['예정', '완료', '취소'] };
  const usesOf = (L, v) => L.uses.reduce((a, [file, key]) => a + rowsOf(file).filter(x => x[key] === v).length, 0);
  function renameValue(L, i, nv) {
    const arr = S.config[L.key], old = arr[i];
    if (!nv || nv === old) return refresh();
    if (arr.includes(nv)) { alert('이미 있는 값입니다.'); return refresh(); }
    arr[i] = nv;
    const files = new Set(['config']);
    L.uses.forEach(([file, key]) => rowsOf(file).forEach(x => { if (x[key] === old) { x[key] = nv; files.add(fileOf(file)); } }));
    ['area', 'owner', 'pillar', 'status', 'mtype'].forEach(k => { if (ui[k] === old) ui[k] = nv; });
    commit([...files], true);
  }
  function renderSettingsPage(root) {
    const c = S.config;
    if (!Array.isArray(c.events)) c.events = [];
    root.appendChild(pageHead('⚙️', '설정', '행사 일정, 분기 범위, 선택지 목록을 고칩니다 (data/config.json). SNS 운영 규칙은 Megan 확인 후에만 바꿉니다.'));

    // 행사
    const tb = el('tbody');
    c.events.forEach((e, i) => {
      const linked = S.tasks.filter(t => t.event === e.id).length;
      const idIn = textIn(e.id, v => {
        if (!/^[a-z0-9-]+$/.test(v)) { alert('ID는 영문 소문자·숫자·하이픈만 씁니다.'); return refresh(); }
        if (v !== e.id && c.events.some(x => x.id === v)) { alert('이미 있는 ID입니다.'); return refresh(); }
        const old = e.id; e.id = v; let n = 0;
        S.tasks.forEach(t => { if (t.event === old) { t.event = v; n++; } });
        commit(n ? ['config', 'tasks'] : 'config');
      }, { id: 'ev-id-' + i, cls: 'cell-in', label: '행사 ID' });
      tb.appendChild(el('tr', {}, [
        el('td', {}, [idIn]),
        el('td', {}, [textIn(e.label, v => { if (v) { e.label = v; commit('config'); } else refresh(); }, { id: 'ev-label-' + i, cls: 'cell-in', label: '행사 이름' })]),
        el('td', {}, [dateIn(e.start, v => { if (!v) return refresh(); e.start = v; if (!e.end || e.end < v) e.end = v; commit('config'); }, { typed: true, id: 'ev-start-' + i, cls: 'cell-in', label: '시작' })]),
        el('td', {}, [dateIn(e.end, v => { if (!v) return refresh(); e.end = v < e.start ? e.start : v; commit('config'); }, { typed: true, id: 'ev-end-' + i, cls: 'cell-in', label: '종료' })]),
        el('td', { cls: 'c-name' }, [textIn(e.note, v => { e.note = v; commit('config'); }, { id: 'ev-note-' + i, cls: 'cell-in', label: '메모' })]),
        el('td', { cls: 'note', text: linked ? '업무 ' + linked : '' }),
        el('td', {}, [el('button', { type: 'button', cls: 'btn ghost icon', 'aria-label': e.label + ' 삭제', text: '×', disabled: !online, onclick: () => {
          if (!confirm(`「${e.label}」 행사를 지울까요?` + (linked ? `\n연결된 업무 ${linked}개의 행사 연결도 지웁니다.` : ''))) return;
          c.events.splice(i, 1); S.tasks.forEach(t => { if (t.event === e.id) delete t.event; });
          commit(linked ? ['config', 'tasks'] : 'config');
        } })])
      ]));
    });
    const addEvent = () => {
      if (!online) return;
      let n = c.events.length + 1; while (c.events.some(e => e.id === 'event-' + n)) n++;
      c.events.push({ id: 'event-' + n, label: '새 행사', start: TODAY, end: TODAY, note: '' });
      commit('config', false, 'ev-label-' + (c.events.length - 1));
    };
    tb.appendChild(el('tr', { cls: 'r-add' }, [el('td', { colspan: 7, role: 'button', tabindex: 0, onclick: addEvent, onkeydown: ev => { if (ev.key === 'Enter') addEvent(); }, text: '＋ 새 행사' })]));
    root.appendChild(el('section', { cls: 'sec' }, [secHead('행사 일정'),
      el('p', { cls: 'note', text: '행사 날짜를 여기서 바꿔도 마일스톤·게시물 날짜는 따라 움직이지 않습니다. 함께 옮기려면 Claude Code에서 /shift-event 를 쓰세요.' }),
      el('div', { cls: 'hscroll' }, [el('table', { cls: 'db events' }, [el('thead', {}, [el('tr', {}, ['ID', '이름', '시작', '종료', '메모', '연결', ''].map(h => el('th', { text: h })))]), tb])])]));

    // 분기·규칙
    c.rules = c.rules || {}; c.utm = c.utm || {}; c.range = c.range || {};
    root.appendChild(el('section', { cls: 'sec' }, [secHead('분기 범위 · 링크 · 규칙'), el('div', { cls: 'form-grid' }, [
      el('label', { for: 'cf-rs' }, ['타임라인 시작', dateIn(c.range.start, v => { if (v) { c.range.start = v; commit('config'); } }, { id: 'cf-rs', label: '타임라인 시작' })]),
      el('label', { for: 'cf-re' }, ['타임라인 끝', dateIn(c.range.end, v => { if (v) { c.range.end = v; commit('config'); } }, { id: 'cf-re', label: '타임라인 끝' })]),
      el('label', { for: 'cf-camp' }, ['UTM campaign', textIn(c.utm.campaign, v => { c.utm.campaign = v; commit('config'); }, { id: 'cf-camp', label: 'UTM campaign' })]),
      el('label', { for: 'cf-med' }, ['UTM medium', textIn(c.utm.medium, v => { c.utm.medium = v; commit('config'); }, { id: 'cf-med', label: 'UTM medium' })]),
      el('label', { for: 'cf-time' }, ['기본 게시 시간', textIn(c.rules.postTime, v => { c.rules.postTime = v; commit('config'); }, { id: 'cf-time', label: '기본 게시 시간' })]),
      el('label', { for: 'cf-consent' }, ['공개 동의 요청 (게시 N일 전)', numIn(c.rules.consentLeadDays, v => { if (v != null) { c.rules.consentLeadDays = v; commit('config'); } }, { id: 'cf-consent', min: 0, label: '공개 동의 요청 일수' })])
    ])]));

    // 선택지
    const rows = LISTS.map(L => {
      const vals = el('div', { cls: 'vals' });
      (c[L.key] || []).forEach((v, i) => {
        const locked = (LOCKED[L.key] || []).includes(v), used = usesOf(L, v);
        const inp = el('input', { type: 'text', id: 'cv-' + L.key + '-' + i, value: v, 'aria-label': L.label + ' 값', readonly: locked ? true : null, disabled: !online, style: '--w:' + v.length * 1.6, title: locked ? '대시보드 계산에 쓰여 고정된 값' : used ? used + '건에서 사용 중 · 이름을 바꾸면 함께 바뀝니다' : '' });
        inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) inp.blur(); });
        inp.addEventListener('change', () => renameValue(L, i, inp.value.trim()));
        vals.appendChild(el('span', { cls: 'val t-' + tagc(L.ck, v) + (locked ? ' locked' : '') }, [inp,
          locked ? el('button', { type: 'button', 'aria-label': '고정 값', title: '고정 값', text: '🔒', disabled: true })
            : el('button', { type: 'button', 'aria-label': v + ' 삭제', title: used ? used + '건에서 사용 중' : '삭제', text: '×', disabled: !online, onclick: () => {
              if (used) return alert(`「${v}」은(는) ${used}건에서 쓰고 있어 지울 수 없습니다. 이름을 바꾸거나 항목의 값을 먼저 바꿔 주세요.`);
              c[L.key].splice(i, 1); commit('config');
            } })]));
      });
      const add = el('input', { type: 'text', cls: 'val-add', placeholder: '＋ 추가', 'aria-label': L.label + ' 값 추가', disabled: !online });
      add.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) add.blur(); });
      add.addEventListener('change', () => { const v = add.value.trim(); if (!v) return; if ((c[L.key] || []).includes(v)) { alert('이미 있는 값입니다.'); return refresh(); } (c[L.key] = c[L.key] || []).push(v); commit('config'); });
      vals.appendChild(add);
      return el('div', { cls: 'list-row' }, [el('div', { cls: 'lk', text: L.label }), vals]);
    });
    root.appendChild(el('section', { cls: 'sec' }, [secHead('선택지 목록', el('span', { cls: 'note', text: '이름을 바꾸면 쓰고 있는 항목도 함께 바뀝니다 · 🔒 = 계산에 쓰는 고정 값' }))].concat(rows)));
  }

  /* ---------- global events ---------- */
  $('reload').addEventListener('click', () => load());
  $('menu').addEventListener('click', () => $('app').classList.toggle('side-open'));
  $('side-scrim').addEventListener('click', () => $('app').classList.remove('side-open'));
  window.addEventListener('focus', () => { if (online && !document.activeElement.matches('input,textarea,select')) load(); });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (menuEl) return closeMenu();
    if (exDlg) return closeExport();
    if (rpDlg) return closeRp();
    if (ui.peek && !(e.target.matches && e.target.matches('select'))) closePeek();
  });
  // 상세 패널 밖을 누르면 닫는다 (다른 행을 누르면 그 항목으로 바뀐다)
  document.addEventListener('mousedown', e => {
    if (menuEl && !menuEl.contains(e.target)) closeMenu();
    if (!ui.peek || $('peek').contains(e.target) || (menuEl && menuEl.contains(e.target))) return;
    if (e.target.closest && e.target.closest('tr.r, .ci, .bcard, .item, .kid, .side-ev, .menu, circle, path')) return;
    if (e.target.closest && e.target.closest('input, select, textarea, button, label')) return;
    closePeek();
  });
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => refresh(), 150); });
  addEventListener('hashchange', () => { const h = parseHash(location.hash.slice(1)); if (h.page && h.page + h.area !== ui.page + ui.area) go(h.page, h.area); });

  let start = parseHash(location.hash.slice(1));
  if (!start.page) try { start = parseHash(localStorage.getItem('nets.tab') || ''); } catch (e) { }
  if (start.page) { ui.page = start.page; if (start.page === 'tasks') ui.area = start.area; }
  try { ui.calHidden = localStorage.getItem('nets.calHidden') === '1'; } catch (e) { }
  renderPage();
  load();
})();
