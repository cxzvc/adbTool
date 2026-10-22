(() => {
  // Presentation only: callers supply the state they already read. No device command or fetch belongs here.
  const catalog = {
    'server-info': ['이 PC에서 사용하는 ADB 실행 파일과 웹 서버·무선 검색 상태를 확인합니다.', '정보를 확인하고 필요한 주소만 복사하세요. 연결 문제는 기기 목록을 새로고침해 다시 확인합니다.', '조회 전용 · 폰 변경 없음', 'ADB 실행 파일이 없거나 서버·mDNS 조회가 실패하면 연결 목록을 확인할 수 없습니다.'],
    'device-info': ['선택한 기기의 연결 방식과 ADB 상태를 확인합니다.', '온라인·인증 대기·오프라인 상태와 연결 주소를 확인하세요.', '조회 전용 · 폰 변경 없음', '기기가 목록에서 사라졌다면 연결 정보는 현재 상태가 아닐 수 있습니다.'],
    'wireless-pair': ['새 기기를 이 PC와 등록하거나 명시적으로 재페어링합니다. 이미 페어링한 기기의 재연결에는 보통 코드를 다시 입력하지 않습니다.', '폰의 「페어링 코드로 기기 페어링」에 표시된 IP·페어링 포트·6자리 코드를 입력하고 페어링을 누른 뒤, 연결 서비스에서 ADB 연결을 누르세요.', '페어링 실행 시 PC·기기의 신뢰 관계 등록', '페어링 화면의 포트와 일반 연결 포트는 다릅니다. 만료된 코드·포트나 다른 네트워크에서는 실패할 수 있습니다. 코드는 여기에 표시·보관하지 않습니다.'],
    'process-stop': ['선택한 프로세스 또는 그 프로세스가 속한 앱을 종료하는 기능입니다.', '현재 PID·이름과 종료 가능 범위를 조회한 뒤 종료 방식을 고르세요. 실행 버튼을 누르기 전에는 종료하지 않습니다.', '실행 시 프로세스·앱 상태 변경', 'TERM·KILL은 선택 PID만, 「앱 전체」는 같은 앱의 모든 프로세스를 대상으로 합니다. 일반 ADB로 신호를 보낼 수 없는 시스템·다른 UID 프로세스가 있습니다.'],
    'package-manager': ['목록에서 선택한 사용자·프로필의 앱을 관리합니다.', '작업을 고른 뒤 대상과 안내를 확인하세요. 변경 작업은 확인란과 실행 버튼이 필요한 경우 이를 완료해야 접수됩니다.', '조회와 변경 작업이 함께 있음 · 선택만으로 실행되지 않음', 'APK 백업은 설치 파일 보관이며 로그인·앱 내부 데이터 백업이 아닙니다. 비활성화·삭제·강제 종료는 앱 동작에 영향을 줍니다. 기본 앱·프로필 정책에 따라 제한될 수 있습니다.'],
    'file-manager': ['선택한 파일·폴더에 사용할 수 있는 작업을 모아 보여줍니다.', '내용·정보 조회 또는 필요한 파일 작업을 고르세요. 이동·복사 대상은 폴더 목록에서 선택합니다.', '조회와 파일 변경 작업이 함께 있음', '앱 내부 저장소·시스템 경로는 일반 ADB로 읽거나 쓸 수 없는 경우가 있습니다. 접근 제한은 빈 폴더라는 뜻이 아닙니다.'],
    'target-picker': ['다음 작업에서 사용할 앱·파일·폴더를 목록에서 고릅니다.', '검색하거나 폴더를 연 뒤 대상을 선택하고 아래 선택 버튼을 누르세요. 닫으면 선택을 취소합니다.', '목록 조회·대상 선택만 수행', '선택을 마치면 원래 팝업으로 돌아갑니다. 선택만으로 앱 작업·파일 변경을 실행하지 않습니다. 읽기 제한 경로는 완전한 목록을 확인할 수 없습니다.'],
    'device-alias': ['기기를 구분할 별칭을 이 브라우저에 저장합니다.', '이름을 입력하고 PC에 저장을 누르세요. 별칭 지우기는 이 브라우저의 별칭만 지웁니다.', '브라우저 저장 공간만 변경 · 폰 이름 유지', '웹 주소·브라우저별로 저장됩니다. 저장 공간 접근이 막히면 저장할 수 없으며 브라우저 데이터 삭제 시 사라집니다.'],
    'device-bookmark': ['현재 기기와 폴더를 다시 여는 웹 링크입니다. 파일 자체를 공유하는 기능이 아닙니다.', '링크 전체 선택 후 복사해 보관하세요. 같은 서버에서 링크를 열면 해당 기기의 파일 탭으로 이동합니다.', 'PC에서 링크 복사만 수행', '링크를 열 때 웹 서버와 기기가 연결되어 있어야 합니다. 주소를 안다고 읽기 제한이 해제되지는 않습니다.'],
    'file-batch': ['선택한 여러 파일·폴더에 복사·이동·삭제 또는 ZIP 다운로드를 적용합니다.', '선택 항목과 작업을 확인하세요. 복사·이동은 목적지 폴더를 선택하고, 변경 작업은 확인란을 체크한 뒤 실행합니다.', '복사·이동·삭제 실행 시 기기 파일 변경 · 다운로드는 읽기', '기존 항목을 덮어쓰지 않습니다. 삭제에는 휴지통이 없습니다. ZIP 다운로드는 합계 2GB·20,000개 한도이며 접근 제한 항목은 실패할 수 있습니다.'],
    'file-gallery': ['현재 검색·선택 목록의 사진을 PC로 읽어 축소 이미지로 보여줍니다.', '이전·다음으로 페이지를 바꾸고 사진 이름을 누르면 원본 미리보기를 엽니다. 다시 읽기는 폰에서 자료를 다시 준비합니다.', '파일 읽기 · PC에 임시 자료 준비', 'JPG·PNG·WebP만 지원하며 움직이는 사진은 제외됩니다. 페이지당 24개, 사진당 5MB·1,600만 픽셀 등의 한도가 있습니다. 폰 파일을 수정하지 않습니다.'],
    'file-volumes': ['기기가 제공하는 저장장치의 종류·위치·용량과 읽기 가능 상태를 확인합니다.', '조회가 끝나면 읽기 가능한 저장장치의 「이 위치 열기」를 누르세요.', '조회·폴더 이동만 수행', '미연결·암호화·마운트 또는 ADB 접근 제한으로 읽을 수 없는 저장장치는 이유를 표시합니다. 용량 미확인은 0바이트라는 뜻이 아닙니다.'],
    'file-mkdir-preview': ['선택한 부모 폴더 아래에 여러 단계의 하위 폴더를 만듭니다.', '부모 폴더를 고르고 하위 경로를 입력한 뒤 생성 목록을 미리 보세요. 확인란과 「확인한 폴더 만들기」를 눌러야 생성합니다.', '미리보기는 조회 · 생성 실행 시 폴더 추가', '쓰기 가능한 부모 위치가 필요합니다. 시스템·앱 내부 경로는 ADB 정책 때문에 생성이 제한될 수 있습니다.'],
    'file-duplicates': ['선택 폴더에서 크기와 SHA-256 내용이 같은 파일을 찾습니다.', '검사 폴더·하위 폴더 포함 여부·읽기 한도를 고른 뒤 검사 시작을 누르세요.', '조회 전용 · 중복 파일을 자동 삭제하지 않음', '읽기 제한·파일 수·시간·용량 한도로 일부만 검사할 수 있습니다. 일부 미확인 결과로 전체 중복 유무를 단정하지 않습니다.'],
    'file-compare': ['선택한 파일 두 개의 크기와 SHA-256 내용을 비교합니다.', '선택된 두 경로를 확인하고 검사 시작을 누르세요. 결과에서 동일·다름·미확인을 구분합니다.', '조회 전용 · 원본 파일 유지', '두 파일을 읽을 권한과 검사 한도가 필요합니다. 읽지 못한 결과는 「다름」으로 처리하지 않습니다.'],
    'file-preview': ['선택 파일을 PC 임시 자료로 읽어 브라우저에서 표시합니다.', '미리보기를 보거나 원본 다운로드를 누르세요. 표시되지 않으면 형식·코덱 안내와 다시 읽기를 확인하세요.', '파일 읽기 · PC에 임시 자료 준비', '브라우저의 영상·소리 코덱과 PDF 뷰어 지원에 따라 표시가 제한됩니다. 파일 크기·형식·ADB 읽기 권한도 확인합니다.'],
    'archive-list': ['ZIP 내부 목록을 읽고 선택한 파일·폴더를 기기에 새로 풀 수 있습니다.', '목록에서 항목을 선택하고 저장 위치·새 이름을 정한 뒤 확인란과 압축 풀기 버튼을 누르세요.', '목록은 읽기 · 압축 풀기 실행 시 기기에 새 파일 생성', '기존 항목을 덮어쓰지 않습니다. 위험한 경로·지원하지 않는 ZIP·암호화·크기·항목 한도와 읽기·쓰기 권한에 따라 제한될 수 있습니다.'],
    'archive-create': ['선택한 기기 파일을 PC로 읽어 ZIP을 만든 뒤 선택한 기기 폴더에 저장합니다.', '목적지와 .zip으로 끝나는 새 이름을 정하고 확인한 뒤 ZIP 만들기·기기에 저장을 누르세요.', '실행 시 기기에 새 ZIP 파일 생성 · 원본 유지', '합계 2GB·20,000개 한도이며 PC 임시 공간과 기기 목적지 쓰기 권한이 필요합니다. 기존 파일을 덮어쓰지 않습니다.'],
    'mirror-compare': ['여러 기기의 화면을 한 창에서 최대 4개까지 비교합니다.', '연결된 기기를 고르고 「선택 기기 보기 시작」을 누르세요. 각 화면의 중지·제거 또는 모두 중지·닫기로 끝냅니다.', '보기 시작 시 기존 영상 공유 또는 기기에 화면 전송 서버 실행', '목록 조회만으로 영상은 시작하지 않습니다. 터치·키·클립보드는 보내지 않지만 화면 전송은 기기 자원을 사용합니다. 새 연결은 입력·소리 없이 시작하며 인코더·브라우저 지원에 따라 제한됩니다.']
  };
  const widgets = new WeakMap(), observed = new WeakSet();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const targetKeys = ['deviceId','package','userId','path','pid','destination','selection'];
  function target(context) {
    const parts = [];
    if(context.deviceId) parts.push('기기 '+context.deviceId);
    if(context.package) parts.push('앱 '+context.package);
    if(context.userId!=null) parts.push('사용자 '+context.userId);
    if(context.pid!=null) parts.push('PID '+context.pid);
    if(context.path) parts.push('위치 '+context.path);
    if(context.selection) parts.push(context.selection);
    if(context.destination) parts.push('목적지 '+context.destination);
    return parts.join(' · ') || '선택 대상 없음';
  }
  function render(widget) {
    const {key,context,host}=widget, item=catalog[key];
    const korean = (value,fallback,access=false) => {
      if(!value)return '';
      if(/[가-힣]/.test(String(value)))return value;
      const contextName=key.startsWith('file-')||key.startsWith('archive-')?'files':key==='package-manager'?'apps':key==='mirror-compare'?'mirror':'workbench';
      const detail=window.DeskErrors?.explain?.(String(value),{context:contextName,action:key,path:context.path,package:context.package});
      const translated=access?detail?.requiredAccessKo||detail?.reasonKo:detail?.reasonKo;
      if(detail?.recognized&&translated&&/[가-힣]/.test(translated))return translated;
      if(/permission\s*(?:denied|denial)|SecurityException|EACCES|EPERM|operation not permitted/i.test(String(value)))return access?'요청한 작업에 맞는 ADB 접근 권한이 필요합니다. 소유자·저장소 정책·SELinux 중 어느 제한인지는 오류 문구만으로 확정할 수 없습니다.':'현재 ADB 권한으로 요청한 자료를 읽거나 작업을 완료할 수 없습니다. 아래 권한 안내와 대체 조회를 확인하세요.';
      return fallback;
    };
    const stamp = context.checkedAt && !Number.isNaN(new Date(context.checkedAt).getTime()) ? '조회 시각 '+new Date(context.checkedAt).toLocaleString('ko-KR',{hour12:false}) : (context.local ? '이 브라우저의 저장 정보 · 폰 상세 조회 없음' : '선택 정보 · 상세 상태 미조회');
    const state = korean(context.status,'조회·작업 응답을 확인해야 합니다. 아래 결과와 한글 오류 안내를 확인하세요.') || (context.local ? 'PC·브라우저에서만 처리합니다.' : '대상 선택을 확인하세요. 지원 여부와 실제 상태는 해당 조회 결과로 확인합니다.');
    host.dataset.support=context.supported===false?'unsupported':context.supported===true?'supported':'unverified';
    host.innerHTML=`<div class="popup-help-title">기능·현재 상태·사용법 <span>${context.supported===false?'현재 사용 불가':context.supported===true?'조회로 확인한 범위':'지원 조건 확인'}</span></div><dl><div><dt>기능</dt><dd>${esc(item[0])}</dd></div><div><dt>사용법</dt><dd>${esc(item[1])}</dd></div><div><dt>실행 영향</dt><dd>${esc(context.effect||item[2])}</dd></div><div><dt>지원·제한</dt><dd>${esc(korean(context.supportReason,'현재 요청을 완료하지 못했습니다. 연결 상태·대상 접근 권한과 아래 오류 안내를 확인하세요. 제한 원인은 응답만으로 확정하지 않습니다.',true)||item[3])}</dd></div></dl><div class="popup-help-current"><strong>현재 상태</strong><span>${esc(state)}</span><small>${esc(target(context))}</small><small>${esc(stamp)}</small></div>`;
  }
  function clear(dialog) { const widget=widgets.get(dialog);if(widget){widget.host.remove();widgets.delete(dialog);} }
  function show(dialog,key,context={}) {
    if(!dialog || !catalog[key]) return false;
    clear(dialog);
    const host=document.createElement('section');host.className='popup-help';host.setAttribute('aria-label','기능과 현재 상태 및 사용법');
    const header=dialog.querySelector('header, .device-preferences-dialog-head, .file-batch-dialog-head, .mirror-compare-head'), title=dialog.querySelector('h2, h3');
    const anchor=header||title?.closest?.('.dialog-top')||title;
    if(anchor?.after) anchor.after(host); else dialog.prepend(host);
    const widget={key,context:{...context},host};widgets.set(dialog,widget);render(widget);
    if(!observed.has(dialog)){observed.add(dialog);dialog.addEventListener('close',()=>{if(!dialog.open)clear(dialog);});}
    return true;
  }
  function update(dialog,partial={}) {
    const widget=widgets.get(dialog);if(!widget)return false;
    const changed=targetKeys.some(key=>Object.prototype.hasOwnProperty.call(partial,key)&&partial[key]!==widget.context[key]);
    widget.context={...widget.context,...partial};
    if(changed){
      if(!Object.prototype.hasOwnProperty.call(partial,'checkedAt'))widget.context.checkedAt=null;
      if(!Object.prototype.hasOwnProperty.call(partial,'status'))widget.context.status=null;
      if(!Object.prototype.hasOwnProperty.call(partial,'supported'))widget.context.supported=null;
      if(!Object.prototype.hasOwnProperty.call(partial,'supportReason'))widget.context.supportReason=null;
    }
    render(widget);return true;
  }
  window.PopupHelp={show,update,clear,keys:Object.freeze(Object.keys(catalog))};
})();
