(() => {
  const $ = id => document.getElementById(id);
  const definitions = [
    ['video', '영상', '영상 · 카메라 설정', '다음 연결에 적용'],
    ['audio', '소리·녹화', '소리 · 원본 녹화', '연결 옵션과 저장 구분'],
    ['pc', 'PC 표시', 'PC 표시 · 캡처', '폰 설정은 그대로'],
    ['remote', '폰 조작', '폰 원격 조작', '연결 중 바로 실행'],
    ['input', '입력', '입력 · 클립보드', '폰과 PC 사이의 입력'],
    ['advanced', '고급', '고급 연결 · 세션', '다음 연결에 적용'],
    ['presets', '선호', '영상 · 소리 선호', '이 브라우저에 저장']
  ];
  let panel, header, modeField;

  function makeSection(name, title, hint) {
    const section = document.createElement('section');
    section.id = 'mirror-group-' + name;
    section.className = 'mirror-layout-group';
    section.setAttribute('aria-labelledby', section.id + '-heading');
    const heading = document.createElement('header');
    heading.className = 'mirror-layout-heading';
    const label = document.createElement('h2');
    label.id = section.id + '-heading';
    label.textContent = title;
    const note = document.createElement('span');
    note.textContent = hint;
    heading.append(label, note);
    section.append(heading);
    return section;
  }

  function jumpTo(target) {
    if (!panel || !target || !header) return;
    const relativeTop = target.getBoundingClientRect().top - panel.getBoundingClientRect().top;
    // Scroll only the control pane. Never change the device route or the phone view.
    if (panel.scrollHeight > panel.clientHeight && getComputedStyle(panel).overflowY !== 'visible') {
      panel.scrollTo({ top: Math.max(0, panel.scrollTop + relativeTop - header.offsetHeight - 8), behavior: 'smooth' });
    } else {
      window.scrollTo({ top: Math.max(0, window.scrollY + target.getBoundingClientRect().top - header.offsetHeight - 80), behavior: 'smooth' });
    }
  }

  function refreshMode() {
    if (!modeField) return;
    const mode = $('ms-control-only')?.checked ? 'control' : $('media-audio-only')?.checked ? 'audio' : 'video';
    modeField.value = mode;
    panel.dataset.connectionMode = mode;
    const audioToggle = $('stream-audio')?.closest?.('label');
    if (audioToggle) audioToggle.hidden = mode !== 'video';
    const note = $('mirror-connection-mode-note');
    if (note) note.textContent = mode === 'control'
      ? '영상·소리 없이 키·마우스·클립보드만 연결합니다.'
      : mode === 'audio' ? '영상 없이 선택한 폰 소리만 전달합니다.'
      : '아래 영상 소스에서 폰 화면 또는 카메라를 선택하세요.';
    return mode;
  }

  function setMode(mode) {
    if (!['video', 'audio', 'control'].includes(mode)) return false;
    const control = $('ms-control-only'), audio = $('media-audio-only');
    if (!control || !audio) return false;
    // These existing handlers update local controls only. Applying a connection
    // remains an explicit action in the single connection bar.
    control.checked = mode === 'control';
    audio.checked = false;
    control.dispatchEvent(new Event('change', { bubbles: true }));
    audio.checked = mode === 'audio';
    audio.dispatchEvent(new Event('change', { bubbles: true }));
    refreshMode();
    return true;
  }

  function configure() {
    panel = $('screen-controls-panel');
    const tools = $('mirror-tools');
    if (!panel || !tools) return;
    if (panel.classList.contains('mirror-organized')) { refreshMode(); return; }

    // Keep the original nodes, IDs and handlers. This module only groups controls.
    const existingTools = [...tools.children];
    const controls = panel.querySelector('.mirror-controls');
    const toolbar = panel.querySelector('.mirror-toolbar');
    const stream = panel.querySelector('.stream-controls');
    const screenActions = panel.querySelector('.screen-actions');
    const audioControls = panel.querySelector('.stream-audio-controls');
    const media = $('mirror-media-options');
    const remote = panel.querySelector('.remote-panel');
    const actions = panel.querySelector('[data-action-surface="screen"]');

    panel.classList.add('mirror-organized');
    header = document.createElement('header');
    header.className = 'mirror-command-bar';
    if (toolbar) header.append(toolbar);
    const selectionNote = $('mirror-selection-note');
    if (selectionNote) header.append(selectionNote);

    if ($('ms-control-only') && $('media-audio-only')) {
      const row = document.createElement('div');
      row.className = 'mirror-mode-row';
      row.innerHTML = '<label for="mirror-connection-mode">연결 방식</label><select id="mirror-connection-mode"><option value="video">화면·카메라 보기</option><option value="audio">소리만 전달</option><option value="control">조작만 · 영상·소리 없음</option></select><small id="mirror-connection-mode-note"></small>';
      header.append(row);
      modeField = $('mirror-connection-mode') || row.querySelector('select');
      modeField.addEventListener('change', () => setMode(modeField.value));
      for (const id of ['ms-control-only', 'media-audio-only']) {
        const field = $(id);
        const label = field.closest('label');
        if (label) label.hidden = true;
        field.addEventListener('change', refreshMode);
      }
    }

    const nav = document.createElement('nav');
    nav.className = 'mirror-section-nav';
    nav.setAttribute('aria-label', '화면 도구 바로가기');
    const groups = {};
    for (const [name, short, title, hint] of definitions) {
      const section = makeSection(name, title, hint);
      groups[name] = section;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = short;
      button.setAttribute('aria-controls', section.id);
      button.title = title + '으로 이동';
      button.addEventListener('click', () => jumpTo(section));
      nav.append(button);
    }
    header.append(nav);
    panel.prepend(header);
    panel.append(tools);

    const append = (group, node) => { if (node) groups[group].append(node); };
    // Quality and source selection stay together, ahead of the long remote keys.
    append('video', stream);
    append('video', $('mirror-option-panel'));
    append('audio', audioControls);
    append('audio', media);
    append('pc', screenActions);
    append('pc', $('mirror-view-panel'));
    append('pc', $('mirror-compare-panel'));
    append('remote', remote);
    append('advanced', $('mirror-session-options'));
    append('presets', $('mirror-preset-panel'));

    for (const node of existingTools) {
      if (node.parentElement === tools) append('input', node);
    }
    for (const [name] of definitions) {
      const section = groups[name];
      // An unavailable optional module should not leave an empty menu destination.
      if (section.children.length > 1) tools.append(section);
      else nav.querySelector('[aria-controls="' + section.id + '"]')?.remove();
    }
    if (actions) {
      const section = makeSection('device', '기기 화면 · 추가 명령', '실행 시 폰에 반영');
      section.append(actions);
      tools.append(section);
    }
    if (controls && !controls.children.length) controls.remove();
    refreshMode();
  }

  window.MirrorLayout = { configure, refreshMode, setMode };
})();
