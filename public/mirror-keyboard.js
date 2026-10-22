(() => {
  const codes = { Enter:66, Backspace:67, Tab:61, Escape:111, Space:62, ArrowUp:19, ArrowDown:20, ArrowLeft:21, ArrowRight:22, Delete:112, Home:122, End:123, PageUp:92, PageDown:93, Insert:124, ShiftLeft:59, ShiftRight:60, AltLeft:57, AltRight:58, ControlLeft:113, ControlRight:114, MetaLeft:117, MetaRight:118, CapsLock:115, ScrollLock:116, NumLock:143, Pause:121, PrintScreen:120, Comma:55, Period:56, Backquote:68, Minus:69, Equal:70, BracketLeft:71, BracketRight:72, Backslash:73, Semicolon:74, Quote:75, Slash:76, NumpadDivide:154, NumpadMultiply:155, NumpadSubtract:156, NumpadAdd:157, NumpadDecimal:158, NumpadEnter:160, NumpadEqual:161 };
  for (let n = 0; n < 26; n++) codes['Key' + String.fromCharCode(65 + n)] = 29 + n;
  for (let n = 0; n < 10; n++) { codes['Digit' + n] = 7 + n; codes['Numpad' + n] = 144 + n; }
  for (let n = 1; n <= 12; n++) codes['F' + n] = 130 + n;
  const meta = e => (e.shiftKey ? 1 : 0) | (e.altKey ? 2 : 0) | (e.ctrlKey ? 4096 : 0) | (e.metaKey ? 65536 : 0) | (e.getModifierState?.('CapsLock') ? 1048576 : 0) | (e.getModifierState?.('NumLock') ? 2097152 : 0) | (e.getModifierState?.('ScrollLock') ? 4194304 : 0);
  function bind(canvas, api) {
    const held = new Map();
    function release() { for (const [code, item] of [...held].reverse()) { api.send({ type:'key-event', action:1, keycode:item.keycode, repeat:0, metaState:0 }); held.delete(code); } }
    canvas.addEventListener('keydown', event => {
      if (event.key === 'Escape' && document.fullscreenElement) { event.preventDefault(); release(); document.exitFullscreen().catch(() => {}); return; }
      if (!api.isReady() || api.isViewOnly() || window.MirrorView?.inputBlocked || window.MirrorHid?.keyboardActive || event.isComposing) return;
      const code = event.code || ({' ':'Space'}[event.key] || event.key), keycode = codes[code]; if (keycode === undefined) return;
      event.preventDefault(); const previous = held.get(code), repeat = previous ? Math.min(1000, previous.repeat + 1) : 0;
      if (api.send({ type:'key-event', action:0, keycode, repeat, metaState:meta(event) }) !== false) held.set(code, { keycode, repeat });
    });
    canvas.addEventListener('keyup', event => {
      const code = event.code || ({' ':'Space'}[event.key] || event.key), item = held.get(code); if (!item) return;
      event.preventDefault(); api.send({ type:'key-event', action:1, keycode:item.keycode, repeat:0, metaState:meta(event) }); held.delete(code);
    });
    canvas.addEventListener('blur', release); window.addEventListener('blur', release); document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
    return { cancel: release };
  }
  window.MirrorKeyboard = { bind, keycode:code => codes[code], meta };
})();
