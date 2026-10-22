(() => {
  const panel = document.getElementById('device-domains-panel');
  if (!panel) return;
  const domains = [
    ['usb', 'USB·주변기기', '역할·전송 기능·연결 장치'], ['battery', '배터리 상세', '수명·사이클·충전 보호'],
    ['thermal', '발열·성능 제한', '센서 온도·제한 단계'], ['sensors', '센서', '사양·측정 범위·사용 앱'],
    ['location', '위치·GNSS', '제공자·요청 앱·GPS 상태'], ['background', '예약 작업·절전', '앱별 작업·알람·WakeLock'],
    ['notifications', '알림·방해 금지', '메타 정보·채널·중요도'], ['security', '관리 정책·보안', '기기 관리자·암호화·제한'],
    ['input', '입력기·키보드', '선택 상태·언어·배열'],
  ];
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const domainAccess = { usb: 'USB 서비스', battery: '배터리 서비스', thermal: '발열 서비스', location: '위치 서비스', background: '작업·알람·전원 서비스', notifications: '알림 서비스', security: '기기 관리 정책 서비스' };
  const labels = { unavailable: '확인 불가', empty: '항목 없음', unsupported: '기기 미지원', denied: '조회 권한 없음', error: '조회 실패' };
  const shown = value => value == null ? '확인 불가' : typeof value === 'boolean' ? value ? '예' : '아니요' : Array.isArray(value) ? value.length ? value.map(shown).join(', ') : '미지정' : String(value);
  const HISTORY_POINTS = 120, HISTORY_SERIES = 64;
  const state = { id: null, active: false, domain: null, data: null, issue: null, alternative: null, cache: new Map(), revision: 0, busy: false, abort: null, finish: null, query: '', seconds: 0, timer: null, sorting: new Map(), samples: new Map(), historyBreak: new Set(), historyUnavailable: new Set() };
  panel.innerHTML = `<div class="domains-heading"><div><h2 id="domains-result-title">상세 진단 결과</h2><p>진단 도구에서 분야를 선택하면 필요한 정보만 읽습니다.</p></div><span id="domains-updated">조회 전</span></div>
    <div class="domains-categories" role="group" aria-label="기기 상세 진단 분류">${domains.map(([id, title, description]) => `<button type="button" data-device-domain="${id}" aria-pressed="false"><strong>${title}</strong><small>${description}</small>${domainAccess[id] ? `<small class="domains-access-badge" title="${domainAccess[id]}는 검증한 보관 소스에서 android.permission.DUMP를 검사합니다. 공개 파일·속성 조회에는 이 표시를 적용하지 않습니다. 현재 연결에서 권한이 부족하다는 뜻은 아닙니다.">${id === 'thermal' ? 'DUMP' : '일부 조회 DUMP'}</small>` : ''}</button>`).join('')}</div>
    <div class="domains-toolbar"><label class="domains-search"><span>항목 검색</span><input id="domains-search" type="search" placeholder="앱 · 센서 · 정책 · 장치 검색" autocomplete="off"></label><label>자동 갱신 <select id="domains-auto"><option value="0">꺼짐</option><option value="15">15초</option><option value="30">30초</option><option value="60">1분</option></select></label><button id="domains-refresh" type="button" disabled>선택 분류 새로고침</button><button id="domains-export" type="button" disabled>JSON 저장</button></div>
    <div id="domains-loading" class="domains-loading" role="status" hidden><span id="domains-loading-text">정보를 읽고 있습니다.</span><progress aria-label="기기 진단 조회 중"></progress><button id="domains-stop" type="button">화면 대기 중지</button></div>
    <p id="domains-error" class="domains-error" role="alert" hidden></p><div id="domains-status-card" hidden></div><div id="domains-warnings" class="domains-warnings" hidden></div><div id="domains-access-errors" hidden></div><div id="domains-history" hidden></div><div id="domains-content" class="domains-grid" aria-busy="false"><p class="domains-empty">진단 도구의 분야를 선택하면 한글 요약과 상세 목록을 확인할 수 있습니다.</p></div>`;
  const controlsMount=$('device-domains-controls'),controls=typeof controlsMount?.append==='function'?controlsMount:panel;
  if(controls!==panel)for(const selector of ['.domains-categories','.domains-toolbar']){const node=panel.querySelector(selector);if(node)controls.append(node);}

  function setBusy(busy) {
    state.busy = busy; $('domains-loading').hidden = !busy; $('domains-content').setAttribute('aria-busy', String(busy));
    $('domains-refresh').disabled = busy || !state.id || !state.domain;
    for (const button of panel.querySelectorAll('[data-domain-alternative]')) button.disabled = busy || !state.id || !state.active;
  }
  function card(options) { const host = $('domains-status-card'); if (window.DeskFeedback?.state) window.DeskFeedback.state(host, options); else { host.hidden = !options; host.textContent = options ? `${options.title} ${options.message || ''}` : ''; } }
  function retryCard(type, title, message, explanation = {}) { const id = state.id, domain = state.domain; card({ type, title, message, ...explanation, errorContext: { context: 'diagnostics', route: '/api/ops/device-domains' }, actionLabel: '이 분류 다시 조회', onAction: () => { if (state.id === id && state.domain === domain && state.active) return load(domain, true); } }); }
  const textList = value => Array.isArray(value) ? value.filter(item => typeof item === 'string' && item) : typeof value === 'string' && value ? [value] : [];
  function accessIssue(entry) {
    if (entry.accessIssue) return entry.accessIssue;
    if (['ok', 'empty'].includes(entry.status) || !entry.status && (entry.value != null || entry.rows?.length)) return null;
    const rawError = entry.rawError || entry.error || entry.message || (entry.status === 'denied' || entry.status === 'unsupported' ? entry.emptyMessage : '') || '';
    const explained = rawError && window.DeskErrors?.explain?.(rawError, { context: 'diagnostics', route: '/api/ops/device-domains' });
    if (explained?.recognized) return explained;
    return { code: entry.status || 'unavailable', sourceId: entry.source || '', label: entry.label || entry.title || '진단 항목', titleKo: entry.status === 'denied' ? '현재 권한에서 조회가 거절됐습니다.' : entry.status === 'unsupported' ? '기기에서 이 조회를 지원하지 않습니다.' : '항목의 공개 여부를 확인하지 못했습니다.', reasonKo: entry.status === 'denied' ? '읽기 접근이 거절됐지만 구체적인 권한 이름은 확인되지 않았습니다.' : entry.status === 'unsupported' ? '서비스·명령 또는 출력 형식이 제공되지 않습니다.' : '미제공·마스킹 또는 출력 형식 차이일 수 있습니다. 없는 값이나 0으로 판단하지 않습니다.', requiredAccessKo: '구체적인 추가 권한은 확인되지 않았습니다. 현재 기기가 공개한 범위만 읽습니다.', alternativesKo: ['같은 화면에서 읽힌 항목을 확인하세요. 숨겨진 값을 추정하거나 권한을 자동 변경하지 않습니다.'], rawError };
  }
  const issueText = issue => issue ? [issue.titleKo, issue.reasonKo, ...textList(issue.requiredAccessKo), ...textList(issue.alternativesKo)].join(' ') : '';
  const accessBadge = entry => entry?.accessLabel ? `<small class="domains-access-badge" title="${esc(entry.accessTitle || entry.requiredAccessKo || '')}">${esc(entry.accessLabel)}</small>` : '';
  function alternativeMarkup(issue) {
    const choices = Array.isArray(issue.alternatives) ? issue.alternatives.filter(choice => choice && typeof choice.id === 'string' && typeof choice.label === 'string') : [];
    if (!choices.length) return `<p class="domains-no-alternative">이 항목과 같은 정보를 루팅 없이 대신 읽는 방법은 확인되지 않았습니다. 공개된 다른 값으로 원래 항목을 추정하지 않습니다.</p>`;
    const sourceId = issue.sourceId || '', selected = state.alternative?.sourceId === sourceId ? state.alternative : null;
    const result = selected?.data;
    const body = result ? result.sections.map(section => `<section><h5>${esc(section.title)}</h5>${(section.items || []).length ? `<dl class="domains-items">${section.items.map(item => `<div class="domains-item${item.status !== 'ok' ? ' domains-unknown' : ''}"><dt>${esc(item.label)}</dt><dd title="${esc(item.source || '')}">${esc(item.value == null ? labels[item.status] || '확인 불가' : shown(item.value))}</dd></div>`).join('')}</dl>` : ''}${(section.tables || []).map(table => `<div class="domains-table-block"><h5>${esc(table.title)} ${accessBadge(table)}</h5>${table.rows?.length ? `<div class="domains-table-scroll" tabindex="0"><table><thead><tr>${(table.columns || []).map(column => `<th scope="col">${esc(column.label)}</th>`).join('')}</tr></thead><tbody>${table.rows.map(row => `<tr>${(table.columns || []).map(column => `<td>${esc(shown(row[column.key]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : `<p>${esc(table.emptyMessage || labels[table.status] || '공개된 항목이 없습니다.')}</p>`}</div>`).join('')}</section>`).join('') : '';
    const resultIssues = result ? [...new Map([...(result.issues || []), ...result.sections.flatMap(section => [...(section.items || []), ...(section.tables || [])].map(accessIssue).filter(Boolean))].map(entry => [[entry.sourceId, entry.code, entry.rawError].join('|'), entry])).values()] : [];
    return `<div class="domains-alternative-choices"><strong>루팅 없이 다른 출처로 확인</strong><div class="domains-alternative-buttons">${choices.map(choice => `<span><button type="button" data-domain-alternative="${esc(choice.id)}" data-domain-source="${esc(sourceId)}" title="${esc(choice.limitationKo || '')}"${state.busy ? ' disabled' : ''}>${esc(choice.label)}</button>${accessBadge(choice)}</span>`).join('')}</div><p>설정을 바꾸거나 권한을 부여하지 않고 선택한 출처만 읽습니다. 같은 값이 모두 제공된다는 뜻은 아닙니다.</p></div>${selected ? `<div class="domains-alternative-result" role="region" aria-label="대체 조회 결과" aria-busy="${selected.busy ? 'true' : 'false'}"><strong>${esc(selected.label)}</strong>${selected.busy ? '<p role="status">대체 출처를 읽고 있습니다.</p><progress aria-label="대체 출처 조회 중"></progress>' : ''}${selected.error ? `<p class="domains-error" role="alert">${esc(selected.error.reasonKo)}</p><p>${esc(selected.error.requiredAccessKo || '필요한 추가 권한은 확인되지 않았습니다.')}</p>${selected.error.rawError ? `<details><summary>기술 오류 원문</summary><pre class="wb-result">${esc(selected.error.rawError)}</pre></details>` : ''}` : ''}${result ? `<p>${esc(result.alternative.limitationKo)}</p><p class="domains-alternative-source">출처: ${esc(result.alternative.sourceIds.join(', '))} · ${esc(new Date(result.updatedAt).toLocaleTimeString('ko-KR', { hour12: false }))} · 원래 조회 결과 유지</p>${body}${resultIssues.map(entry => `<p class="domains-unknown">${esc(entry.label || '대체 항목')} · ${esc(entry.reasonKo || entry.titleKo)} ${esc(entry.requiredAccessKo || '')}</p>`).join('')}` : ''}</div>` : ''}`;
  }
  function accessMarkup(issue) {
    return `<div class="domains-access-note ops-note"><strong>${esc(issue.label || '조회 안내')} · ${esc(issue.titleKo || '조회 제한')}</strong>${accessBadge(issue)}<p>${esc(issue.reasonKo || '원인을 확인하지 못했습니다.')}</p>${textList(issue.requiredAccessKo).map(text => `<p><b>필요한 접근</b> ${esc(text)}</p>`).join('')}${alternativeMarkup(issue)}${textList(issue.alternativesKo).length ? `<p><b>현재 권한에서 가능한 방법</b></p><ul>${textList(issue.alternativesKo).map(text => `<li>${esc(text)}</li>`).join('')}</ul>` : ''}${issue.rawError ? `<details><summary>원문 오류 보기 · 민감값 일부 숨김</summary><pre class="wb-result">${esc(issue.rawError)}</pre></details>` : ''}</div>`;
  }
  function cancel() { state.revision++; state.abort?.abort(); state.abort = null; state.alternative = null; state.finish?.(); state.finish = null; clearTimeout(state.timer); state.timer = null; setBusy(false); }
  function schedule() {
    clearTimeout(state.timer); state.timer = null;
    if (state.id && state.active && state.domain && state.seconds > 0 && !document.hidden) state.timer = setTimeout(() => load(state.domain, true), state.seconds * 1000);
  }
  function record(data) {
    if (data.domain !== 'thermal' && data.domain !== 'battery') return;
    const stamp = Date.parse(data.updatedAt); if (!Number.isFinite(stamp)) return;
    const sample = { at: data.updatedAt, stamp, breakBefore: state.historyBreak.has(data.domain), values: {} };
    const add = (name, type, measured, status = null) => {
      // parseThermal's server output already assigns the official Temperature type's
      // units. Do not label unknown/vendor types as Celsius or parse arbitrary numbers.
      const match = /^(-?(?:\d+(?:\.\d+)?|\.\d+)) (°C|mV|mA|%)$/.exec(String(measured || ''));
      if (!name || !match || !Number.isFinite(Number(match[1])) || Object.keys(sample.values).length >= HISTORY_SERIES) return;
      const key = JSON.stringify([name, type || '', match[2]]);
      sample.values[key] = { name, type: type || '', unit: match[2], value: Number(match[1]), status };
    };
    if (data.domain === 'thermal') for (const section of data.sections) for (const table of section.tables || []) if (table.title === '온도·제한 센서') for (const row of table.rows || []) {
      if (row.freshness !== '현재 HAL 조회') continue;
      add(row.name || row.type, row.type, row.value, row.status);
    }
    if (data.domain === 'battery') for (const section of data.sections) for (const item of section.items || []) if (['온도', '잔량'].includes(item.label) && item.status === 'ok') {
      add(item.label, '배터리', item.value);
    }
    const list = state.samples.get(data.domain) || [];
    const previous = list.at(-1);
    if (previous && stamp <= previous.stamp) return;
    // A failed/hidden/paused interval must not be bridged by a line. A much longer
    // interval than the chosen cadence is also a gap, rather than continuous sampling.
    const maximumGap = state.seconds > 0 ? state.seconds * 3000 : 120000;
    if (previous && stamp - previous.stamp > maximumGap) sample.breakBefore = true;
    list.push(sample); state.historyBreak.delete(data.domain); state.historyUnavailable.delete(data.domain);
    while (list.length > HISTORY_POINTS) list.shift(); state.samples.set(data.domain, list);
  }
  function renderHistory() {
    const samples = state.samples.get(state.domain) || [], host = $('domains-history');
    host.hidden = !samples.length;
    if (host.hidden) { host.innerHTML = ''; return; }
    // Prefer currently present sensors, then older sensors still within the bounded window.
    const keys = [...new Set([...samples].reverse().flatMap(sample => Object.keys(sample.values)))], palette = ['#2563eb', '#dc2626', '#059669', '#9333ea', '#d97706', '#0e7490'];
    const query = state.query.trim().toLocaleLowerCase('ko-KR');
    const time = at => new Date(at).toLocaleTimeString('ko-KR', { hour12: false });
    const displayNumber = value => Number(value.toFixed(4)).toLocaleString('ko-KR', { maximumFractionDigits: 4 });
    const firstStamp = samples[0].stamp, span = Math.max(1, samples.at(-1).stamp - firstStamp);
    const charts = keys.slice(0, HISTORY_SERIES).map((key, index) => {
      const measurements = samples.map((sample, index) => ({ index, at: sample.at, stamp: sample.stamp, breakBefore: sample.breakBefore, measurement: sample.values[key] || null }));
      const points = measurements.filter(point => point.measurement);
      if (!points.length) return '';
      const meta = points.at(-1).measurement;
      if (query && !`${meta.name} ${meta.type} ${meta.unit}`.toLocaleLowerCase('ko-KR').includes(query)) return '';
      const min = Math.min(...points.map(point => point.measurement.value)), max = Math.max(...points.map(point => point.measurement.value));
      const padding = Math.max(0.5, (max - min) * 0.1), lower = min - padding, upper = max + padding, color = palette[index % palette.length];
      const position = point => ({ x: 8 + (point.stamp - firstStamp) / span * 284, y: 57 - (point.measurement.value - lower) / (upper - lower) * 48 });
      const paths = []; let segment = [];
      for (const point of measurements) {
        if ((!point.measurement || point.breakBefore) && segment.length) { paths.push(segment.join(' ')); segment = []; }
        if (point.measurement) { const { x, y } = position(point); segment.push(`${x.toFixed(2)},${y.toFixed(2)}`); }
      }
      if (segment.length) paths.push(segment.join(' '));
      const latest = state.historyUnavailable.has(state.domain) ? null : measurements.at(-1).measurement;
      const hoverTargets = measurements.map((point, index) => {
        const x = 8 + (point.stamp - firstStamp) / span * 284;
        const left = index ? (x + 8 + (measurements[index - 1].stamp - firstStamp) / span * 284) / 2 : 0;
        const right = index < measurements.length - 1 ? (x + 8 + (measurements[index + 1].stamp - firstStamp) / span * 284) / 2 : 300;
        const tooltip = `${time(point.at)} · ${meta.name} (${meta.type || '유형 미공개'})\n${point.measurement ? displayNumber(point.measurement.value) + ' ' + meta.unit + (point.measurement.status ? '\n제한 단계: ' + point.measurement.status : '') : '현재 값 확인 불가 · 이 구간은 선을 잇지 않습니다.'}`;
        return `<rect x="${left.toFixed(2)}" y="0" width="${Math.max(0.1, right - left).toFixed(2)}" height="65" fill="transparent"><title>${esc(tooltip)}</title></rect>`;
      }).join('');
      return `<div class="domains-mini-chart" data-history-series="${esc(key)}"><strong>${esc(meta.name)} <span>${latest ? esc(displayNumber(latest.value)) + ' ' + esc(meta.unit) : '현재 확인 불가'}</span></strong><div class="domains-chart-type">${esc(meta.type || '유형 미공개')} · ${esc(meta.unit)}${latest?.status ? ' · ' + esc(latest.status) : ''}</div><svg viewBox="0 0 300 66" role="img" aria-label="${esc(meta.name)} ${esc(meta.type)} ${esc(meta.unit)} 시계열, 유효 ${points.length}/${samples.length}회, 최소 ${min}, 최대 ${max}"><line x1="8" y1="58" x2="292" y2="58" stroke="#e2e8f0"/>${paths.map(points => `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2"/>`).join('')}${points.map(point => { const { x, y } = position(point); return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="2" fill="${color}"/>`; }).join('')}${hoverTargets}</svg><div class="domains-chart-time"><span>${esc(time(samples[0].at))}</span><span>${esc(time(samples.at(-1).at))}</span></div><small>최소 ${esc(displayNumber(min))} · 최대 ${esc(displayNumber(max))} ${esc(meta.unit)} · 유효 ${points.length}/${samples.length}회</small></div>`;
    }).join('');
    host.hidden = !keys.length;
    host.innerHTML = keys.length ? `<div class="domains-history-heading"><strong>${state.domain === 'thermal' ? '센서별 발열·제한 값 시계열' : '배터리 변화'} · ${samples.length}회 조회</strong><button type="button" data-domains-history-reset>시계열 초기화</button></div><p class="domains-history-note">센서별 단위를 따로 표시합니다. 그래프에 마우스를 올리면 그 시각의 값·제한 단계를 볼 수 있습니다. 미조회·실패·캐시 값은 선을 잇지 않습니다.<br>이 브라우저에서만 최대 ${HISTORY_POINTS}회·${HISTORY_SERIES}개 센서를 보관합니다. 자동 갱신은 직접 켜야 합니다. 기기 전환/페이지 새로고침 시 초기화됩니다.${keys.length > HISTORY_SERIES ? ` 현재·최근 센서 ${HISTORY_SERIES}개를 우선 표시합니다.` : ''}</p><div class="domains-history-charts">${charts || '<p class="domains-empty">검색 조건에 맞는 시계열이 없습니다.</p>'}</div>` : '';
  }
  function render() {
    const data = state.data; if (!data) return;
    const query = state.query.trim().toLocaleLowerCase('ko-KR'), includes = value => !query || String(value || '').toLocaleLowerCase('ko-KR').includes(query);
    let visible = 0;
    $('domains-content').innerHTML = data.sections.map((section, si) => {
      const whole = includes(section.title), items = (section.items || []).filter(item => whole || includes([item.label, shown(item.value), item.description, issueText(accessIssue(item))].join(' ')));
      const visibleIssues = [];
      for (const item of items) { const issue = accessIssue(item); if (issue) visibleIssues.push(issue); }
      const tables = (section.tables || []).map((table, ti) => {
        const issue = accessIssue(table), columns = table.columns || [], tableMatch = whole || includes(table.title) || includes(issueText(issue)), rows = (table.rows || []).filter(row => tableMatch || columns.some(column => includes(shown(row[column.key]))));
        if (query && !tableMatch && !rows.length) return '';
        if (issue) visibleIssues.push(issue);
        const key = `${state.domain}/${si}/${ti}`, sorting = state.sorting.get(key);
        if (sorting) rows.sort((left, right) => {
          const a = left[sorting.key], b = right[sorting.key]; if (a == null) return b == null ? 0 : 1; if (b == null) return -1;
          return (typeof a === 'number' && typeof b === 'number' ? a - b : shown(a).localeCompare(shown(b), 'ko', { numeric: true })) * sorting.direction;
        });
        const emptyMessage = table.emptyMessage && /[가-힣]/.test(table.emptyMessage) ? table.emptyMessage : issue?.titleKo || labels[table.status] || '공개된 항목이 없습니다.';
        return `<div class="domains-table-block"><h4>${esc(table.title)} <span>${rows.length}개</span></h4>${table.description ? `<p>${esc(table.description)}</p>` : ''}${rows.length ? `<div class="domains-table-scroll" role="region" aria-label="${esc(table.title)}" tabindex="0"><table><thead><tr>${columns.map(column => `<th scope="col" aria-sort="${sorting?.key === column.key ? sorting.direction === 1 ? 'ascending' : 'descending' : 'none'}"><button type="button" data-domains-sort="${esc(key)}" data-column="${esc(column.key)}">${esc(column.label)}${sorting?.key === column.key ? sorting.direction === 1 ? ' ↑' : ' ↓' : ' ↕'}</button></th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${columns.map(column => `<td class="${row[column.key] == null ? 'domains-unknown' : ''}">${esc(shown(row[column.key]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : `<p class="domains-empty">${esc(emptyMessage)}</p>`}</div>`;
      }).filter(Boolean);
      if (query && !whole && !items.length && !tables.length) return '';
      visible++;
      const explanations = [...new Map(visibleIssues.map(issue => [[issue.sourceId || issue.source || '', issue.code || '', issue.requiredAccessKo || '', issue.rawError || ''].join('|'), issue])).values()];
      return `<section data-section="${esc(section.id||'')}" class="domains-card${tables.length ? ' domains-card-wide' : ''}"><h3>${esc(section.title)}</h3>${section.description?`<p class="domains-section-note">${esc(section.description)}</p>`:''}${items.length ? `<dl class="domains-items">${items.map(item => `<div class="domains-item${item.status !== 'ok' ? ' domains-unknown' : ''}"><dt>${esc(item.label)}${item.description ? `<small>${esc(item.description)}</small>` : ''}</dt><dd title="${esc(issueText(accessIssue(item)) || item.source || '')}">${esc(item.value == null ? labels[item.status] || '확인 불가' : shown(item.value))}</dd></div>`).join('')}</dl>` : ''}${tables.join('')}${explanations.length ? `<div class="domains-table-block"><h4>조회 제한·필요한 접근 안내</h4>${explanations.map(accessMarkup).join('')}</div>` : ''}</section>`;
    }).join('');
    if (!visible) {
      $('domains-content').innerHTML = '<p class="domains-empty">검색 조건에 맞는 항목이 없습니다.</p>';
      if (query) { const id = state.id, domain = state.domain; card({ type: 'empty', title: '검색에 맞는 진단 항목이 없습니다.', message: '검색어를 지우면 이미 읽어 둔 전체 항목을 표시합니다.', actionLabel: '검색어 지우기', onAction: () => { if (state.id !== id || state.domain !== domain) return; state.query = ''; $('domains-search').value = ''; render(); } }); }
      else retryCard('empty', '공개된 진단 항목이 없습니다.', '기기 응답에 표시할 항목이 없었습니다. 다른 분류를 선택하거나 같은 분류를 다시 조회할 수 있습니다.');
    } else {
      const statuses = data.sections.flatMap(section => [...(section.items || []).filter(item => item.label !== '설정 조회 사용자'), ...(section.tables || [])]).map(entry => entry.status || (Array.isArray(entry.rows) ? entry.rows.length ? 'ok' : 'empty' : entry.value == null ? 'unavailable' : 'ok'));
      if (statuses.length && !statuses.includes('ok')) {
        if (statuses.includes('denied')) retryCard('warning', '이 진단의 조회 권한이 제한되어 있습니다.', '기기가 공개하지 않은 값을 0이나 꺼짐으로 표시하지 않았습니다. 현재 권한에서 다시 조회할 수 있습니다.');
        else if (statuses.includes('unsupported')) retryCard('warning', '이 기기에서 제공하지 않는 진단 항목입니다.', '지원하지 않는 서비스 또는 출력 형식으로 확인되었습니다. 다른 분류를 선택하거나 다시 조회하세요.');
        else if (statuses.every(status => status === 'empty')) retryCard('empty', '현재 목록에 항목이 없습니다.', '이번 응답에서 현재 항목이 없는 것으로 확인했습니다. 필요할 때 다시 조회하세요.');
        else retryCard('warning', '현재 진단 값을 확인하지 못했습니다.', '기기에서 제공되지 않거나 읽지 못한 항목입니다. 기기 연결과 공개 범위를 확인한 뒤 다시 조회하세요.');
      } else card(null);
      if (state.issue) retryCard(state.issue.type, state.issue.title, state.issue.message, state.issue.explanation);
      else if ((data.warnings || []).length && statuses.includes('ok')) retryCard('warning', '일부 진단 항목을 읽지 못했습니다.', '확인한 값은 아래에 표시합니다. 조회 제한 내용을 확인하고 같은 분류를 다시 읽을 수 있습니다.');
    }
    $('domains-updated').textContent = `마지막 조회 ${new Date(data.updatedAt).toLocaleString('ko-KR', { hour12: false })}`;
    $('domains-export').disabled = false;
    const warnings = (data.warnings || []).filter(value => typeof value === 'string');
    $('domains-warnings').hidden = !warnings.length; $('domains-warnings').innerHTML = warnings.length ? `<strong>조회 제한 ${warnings.length}건</strong><ul>${warnings.map(value => `<li>${esc(value)}</li>`).join('')}</ul>` : '';
    const issues = [...new Map((data.issues || []).map(issue => [[issue.sourceId, issue.code, issue.rawError].join('|'), issue])).values()];
    $('domains-access-errors').hidden = !issues.length; $('domains-access-errors').innerHTML = issues.length ? `<details class="ops-note"><summary>명령별 사유·필요한 접근 ${issues.length}건</summary>${issues.map(accessMarkup).join('')}</details>` : '';
    renderHistory();
  }
  async function load(domain, force = false, button = null) {
    if (!state.id || !state.active || !domains.some(entry => entry[0] === domain)) return;
    cancel(); state.domain = domain; state.issue = null;
    for (const button of controls.querySelectorAll('[data-device-domain]')) button.setAttribute('aria-pressed', String(button.dataset.deviceDomain === domain));
    $('domains-result-title').textContent=domains.find(entry=>entry[0]===domain)[1]+' · 조회 결과';
    $('domains-error').hidden = true;
    card(null);
    const cached = state.cache.get(domain);
    state.data = cached || null;
    if (cached) { render(); if (!force) { schedule(); return; } }
    else { $('domains-content').innerHTML = '<p class="domains-empty">선택한 분류의 정보를 읽고 있습니다.</p>'; $('domains-updated').textContent = '조회 중'; $('domains-export').disabled = true; $('domains-warnings').hidden = true; $('domains-access-errors').hidden = true; $('domains-history').hidden = true; }
    const id = state.id, revision = ++state.revision, controller = new AbortController(); state.abort = controller;
    const title = domains.find(entry => entry[0] === domain)[1]; $('domains-loading-text').textContent = `${title} 정보를 읽고 있습니다.`; setBusy(true);
    const endFeedback = window.DeskFeedback?.start(`${title} 조회`, { button }) || (() => {}); let finished = false;
    const finish = () => { if (!finished) { finished = true; endFeedback(); } if (state.finish === finish) state.finish = null; }; state.finish = finish;
    try {
      const response = await fetch(`/api/ops/device-domains?${new URLSearchParams({ deviceId: id, domain })}`, { cache: 'no-store', signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '기기 진단 정보를 읽지 못했습니다.');
      if (revision !== state.revision || id !== state.id || !state.active) return;
      if (data.deviceId !== id || data.domain !== domain || !Array.isArray(data.sections)) throw new Error('선택한 기기·분류의 진단 결과가 아닙니다. 다시 조회해 주세요.');
      state.data = data; state.cache.set(domain, data); record(data); render();
    } catch (error) {
      if (revision === state.revision && error.name !== 'AbortError') {
        const explained = window.DeskErrors?.explain?.(error.message, { context: 'diagnostics', route: '/api/ops/device-domains' });
        const reason = explained?.reasonKo || (/[가-힣]/.test(error.message) ? error.message : '진단 요청을 완료하지 못했습니다. 아래 원문과 현재 연결 상태를 확인하세요.');
        $('domains-error').hidden = false; $('domains-error').textContent = `${reason}${cached ? ' 마지막 조회 결과를 표시합니다.' : ''}`;
        if (!cached) $('domains-content').innerHTML = '<p class="domains-empty">정보를 읽지 못했습니다. 연결 상태를 확인하고 새로고침하세요.</p>';
        state.issue = { type: /연결|offline|not found|Failed to fetch|network/i.test(error.message) ? 'offline' : 'error', title: explained?.titleKo || '진단 정보를 읽지 못했습니다.', message: `${reason}${cached ? ' 마지막으로 조회한 값을 아래에 유지합니다.' : ''}`, explanation: { rawError: explained?.rawError ?? error.message, ...(explained?.requiredAccessKo ? { requiredAccessKo: explained.requiredAccessKo } : {}), ...(explained?.alternativesKo ? { alternativesKo: explained.alternativesKo } : {}) } };
        retryCard(state.issue.type, state.issue.title, state.issue.message, state.issue.explanation); state.historyBreak.add(domain); state.historyUnavailable.add(domain); renderHistory();
      }
    } finally { finish(); if (revision === state.revision) { state.abort = null; setBusy(false); schedule(); } }
  }
  async function loadAlternative(sourceId, alternativeId, button) {
    if (!state.id || !state.active || !state.data || state.busy) return;
    const entries = [...(state.data.issues || []), ...state.data.sections.flatMap(section => [...(section.items || []), ...(section.tables || [])].map(accessIssue).filter(Boolean))];
    const issue = entries.find(entry => entry.sourceId === sourceId && entry.alternatives?.some(choice => choice.id === alternativeId));
    const choice = issue?.alternatives.find(entry => entry.id === alternativeId); if (!choice) return;
    clearTimeout(state.timer); state.timer = null;
    const id = state.id, domain = state.domain, revision = state.revision, controller = new AbortController(); state.abort = controller;
    state.alternative = { sourceId, id: alternativeId, label: choice.label, busy: true, data: null, error: null };
    const selected = state.alternative;
    $('domains-loading-text').textContent = `${choice.label} · 현재 권한으로 읽는 중`; setBusy(true); render();
    const endFeedback = window.DeskFeedback?.start(choice.label, { button }) || (() => {}); let finished = false;
    const finish = () => { if (!finished) { finished = true; endFeedback(); } if (state.finish === finish) state.finish = null; }; state.finish = finish;
    try {
      const response = await fetch(`/api/ops/device-domains?${new URLSearchParams({ deviceId: id, domain, alternative: alternativeId })}`, { cache: 'no-store', signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '대체 출처를 읽지 못했습니다.');
      if (revision !== state.revision || state.id !== id || state.domain !== domain || !state.active || state.alternative !== selected) return;
      if (data.deviceId !== id || data.domain !== domain || data.alternative?.id !== alternativeId || !Array.isArray(data.sections) || !Array.isArray(data.alternative.sourceIds) || !data.alternative.sourceIds.length || data.alternative.sourceIds.some(source => !choice.sourceIds?.includes(source))) throw new Error('선택한 기기·대체 출처의 결과가 아닙니다. 같은 버튼으로 다시 조회해 주세요.');
      selected.data = data;
    } catch (error) {
      if (error.name !== 'AbortError' && revision === state.revision && state.id === id && state.domain === domain && state.active && state.alternative === selected) selected.error = window.DeskErrors?.explain?.(error.message, { context: 'diagnostics', route: '/api/ops/device-domains' }) || { reasonKo: /[가-힣]/.test(error.message) ? error.message : '현재 권한으로 대체 출처를 읽지 못했습니다. 필요한 추가 권한은 응답만으로 확인되지 않았습니다.', rawError: error.message };
    } finally {
      finish();
      if (revision === state.revision && state.id === id && state.domain === domain && state.active && state.alternative === selected) { selected.busy = false; state.abort = null; setBusy(false); render(); schedule(); }
    }
  }
  const handleClick=event=>{
    if (event.target.closest('[data-domains-history-reset]')) { state.samples.delete(state.domain); renderHistory(); return; }
    const alternative = event.target.closest('[data-domain-alternative]'); if (alternative) return loadAlternative(alternative.dataset.domainSource, alternative.dataset.domainAlternative, alternative);
    const category = event.target.closest('[data-device-domain]'); if (category) { load(category.dataset.deviceDomain, true, category);if(controls!==panel)panel.scrollIntoView({block:'start',behavior:'smooth'});return; }
    const sort = event.target.closest('[data-domains-sort]');
    if (sort) { const previous = state.sorting.get(sort.dataset.domainsSort); state.sorting.set(sort.dataset.domainsSort, { key: sort.dataset.column, direction: previous?.key === sort.dataset.column ? -previous.direction : 1 }); render(); }
  };
  panel.addEventListener('click',handleClick);if(controls!==panel)controls.addEventListener('click',handleClick);
  $('domains-refresh').addEventListener('click', () => load(state.domain, true, $('domains-refresh')));
  $('domains-stop').addEventListener('click', () => { cancel(); state.historyBreak.add(state.domain); state.seconds = 0; $('domains-auto').value = '0'; $('domains-error').hidden = true; state.issue = { type: 'info', title: '진단 조회 대기를 중지했습니다.', message: '이미 시작한 서버 읽기는 제한 시간 안에 끝납니다. 다시 조회를 눌러 새 요청을 시작할 수 있습니다.' }; if (!state.data) { $('domains-content').innerHTML = '<p class="domains-empty">조회 대기를 중지했습니다. 다시 조회하면 현재 값을 읽습니다.</p>'; $('domains-updated').textContent = '조회 중지'; } retryCard(state.issue.type, state.issue.title, state.issue.message); });
  $('domains-search').addEventListener('input', event => { state.query = event.target.value; render(); });
  $('domains-auto').addEventListener('change', event => { const value = Number(event.target.value); state.seconds = [0, 15, 30, 60].includes(value) ? value : 0; state.historyBreak.add(state.domain); schedule(); });
  $('domains-export').addEventListener('click', () => {
    if (!state.data) return;
    const history = state.samples.get(state.domain);
    const payload = history?.length ? { ...state.data, browserHistory: { maxPoints: HISTORY_POINTS, maxSensors: HISTORY_SERIES, samples: history } } : state.data;
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })), link = document.createElement('a');
    link.href = url; link.download = `device-${state.domain}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { clearTimeout(state.timer); state.timer = null; state.historyBreak.add(state.domain); } else schedule(); });
  window.DeviceDomains = {
    async show(domain){if(!state.id||!state.active||!domains.some(([id])=>id===domain))return;const id=state.id;await load(domain,true,controls.querySelector('[data-device-domain="'+domain+'"]'));if(state.id===id&&state.active&&state.domain===domain)panel.scrollIntoView({block:'start',behavior:'smooth'});},
    open(id) {
      cancel(); Object.assign(state, { id, active: false, domain: null, data: null, issue: null, query: '', seconds: 0 }); state.cache.clear(); state.sorting.clear(); state.samples.clear(); state.historyBreak.clear(); state.historyUnavailable.clear();
      $('domains-search').value = ''; $('domains-auto').value = '0'; $('domains-updated').textContent = '조회 전'; $('domains-result-title').textContent='상세 진단 결과';$('domains-export').disabled = true; $('domains-refresh').disabled = true;
      $('domains-error').hidden = true; $('domains-warnings').hidden = true; $('domains-access-errors').hidden = true; $('domains-history').hidden = true; card(null);
      for (const button of controls.querySelectorAll('[data-device-domain]')) { button.setAttribute('aria-pressed', 'false'); button.disabled = !id; }
      $('domains-content').innerHTML = '<p class="domains-empty">진단 도구에서 분야를 선택하면 필요한 정보만 읽습니다.</p>';
    },
    close() { cancel(); state.id = null; state.active = false; state.data = null; state.issue = null; state.cache.clear(); state.samples.clear(); card(null); $('domains-access-errors').hidden = true; $('domains-export').disabled = true; $('domains-refresh').disabled = true; for (const button of controls.querySelectorAll('[data-device-domain]')) button.disabled = true; },
    activate(name) { state.active = name === 'monitor' || name === true; if (!state.active) { state.historyBreak.add(state.domain); cancel(); } else schedule(); },
  };
})();
