// Functional explanations checked against the actual Android 16 service consumers.
// AOSP defines the baseline; these entries do not certify a manufacturer's private implementation.
const base = 'https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/';
const bluetooth = 'https://android.googlesource.com/platform/packages/modules/Bluetooth/+/refs/tags/android-16.0.0_r1/';
const connectivity = 'https://android.googlesource.com/platform/packages/modules/Connectivity/+/refs/tags/android-16.0.0_r1/';
const scope = { sourceLabel:'Android 16 동작 소스', sourceScope:'Android 16 기본 구현. 제조사 구현에서의 반영 여부는 별도 확인이 필요합니다.' };
export const SERVICE_HELP = {
  'global:ingress_rate_limit_bytes_per_second': {
    ...scope, title:'네트워크별 다운로드 속도 제한',
    description:'인터넷에 연결되는 각 네트워크의 수신 속도에 상한을 적용하는 값입니다. 앱 하나의 속도나 업로드 속도를 제한하는 항목은 아닙니다. 여러 네트워크를 동시에 쓰면 전체 수신량은 이 값보다 클 수 있습니다.',
    valueGuide:'초당 바이트(B/s) · -1: 제한 없음 · 1,000,000은 약 1 MB/s. 실제 제한 적용에는 기기의 커널·네트워크 구현 지원이 필요합니다.',
    sourceUrl:connectivity+'framework/src/android/net/ConnectivitySettingsManager.java#1106', sourceLine:1106, sourceConstant:'INGRESS_RATE_LIMIT_BYTES_PER_SECOND'
  },
  'global:bluetooth_btsnoop_default_mode': {
    ...scope, title:'블루투스 HCI 통신 로그 기본 모드',
    description:'블루투스 서비스가 시작될 때 컨트롤러와 주고받는 통신의 진단 로그 모드로 읽는 값입니다. 블루투스를 켜고 끄는 설정이 아닙니다. 로그를 남겨 연결·오디오 등 통신 문제를 분석하는 데 쓰며, 변경값은 서비스 시작 시 읽습니다.',
    valueGuide:'disabled: 기록 안 함 · filtered: 필터링한 로그 · full: 전체 로그. 통신 정보가 포함될 수 있습니다. 일반 logcat 화면과는 다른 HCI 로그입니다.',
    sourceUrl:bluetooth+'android/app/src/com/android/bluetooth/btservice/AdapterService.java#1211', sourceLine:1211, sourceConstant:'BLUETOOTH_BTSNOOP_DEFAULT_MODE',
    sourceReferences:['https://android.googlesource.com/platform/system/libsysprop/+/refs/tags/android-16.0.0_r1/srcs/android/sysprop/BluetoothProperties.sysprop#18']
  },
  'secure:clock_seconds': {
    ...scope, title:'상태바 시계의 초 표시',
    description:'Android 기본 상태바 시계가 시·분에 더해 초까지 표시하도록 하는 설정입니다. 시간 자체나 시간대를 바꾸지 않습니다. 화면이 켜져 있을 때 초 단위 갱신을 사용합니다. 제조사 상태바에서는 같은 키를 반영하는지 별도 확인이 필요합니다.',
    valueGuide:'0 또는 미지정: 초 숨김 · 1: 초 표시. Android 기본 SystemUI 구현 기준입니다.',
    sourceUrl:base+'packages/SystemUI/src/com/android/systemui/statusbar/policy/Clock.java#329', sourceLine:329, sourceConstant:'CLOCK_SECONDS',
    sourceReferences:[base+'packages/SystemUI/src/com/android/systemui/tuner/TunerServiceImpl.java#213']
  },
  'secure:icon_blacklist': {
    ...scope, title:'상태바에서 숨길 시스템 아이콘',
    description:'상태바에서 표시하지 않을 시스템 아이콘의 슬롯 이름 목록입니다. 예를 들어 clock 슬롯을 포함하면 기본 SystemUI 시계 표시를 숨깁니다. 앱 알림을 차단하거나 기능 자체를 끄는 설정은 아닙니다. 미지정 시 기기 리소스의 기본 숨김 목록을 사용합니다.',
    valueGuide:'쉼표로 구분한 아이콘 슬롯 이름. 유효한 슬롯과 제조사 상태바의 반영 방식은 기기 구현에 따라 다릅니다.',
    sourceUrl:base+'packages/SystemUI/src/com/android/systemui/statusbar/phone/ui/StatusBarIconController.java#107', sourceLine:107, sourceConstant:'ICON_HIDE_LIST',
    sourceReferences:[base+'packages/SystemUI/src/com/android/systemui/statusbar/policy/Clock.java#334',base+'packages/SystemUI/src/com/android/systemui/tuner/TunerServiceImpl.java#213']
  },
  'secure:sysui_tuner_version': {
    ...scope, title:'SystemUI 튜너 설정 이관 버전',
    description:'시스템 UI 튜너 설정을 어느 버전까지 변환·초기화했는지 기록하는 내부 버전 번호입니다. SystemUI는 이 숫자를 비교해 예전 숨김 아이콘 설정의 보정이나 초기화가 필요한지 결정합니다. 튜너 기능의 켜기·끄기 값이 아닙니다.',
    valueGuide:'내부 이관 버전 정수. 확인한 Android 16 기본 소스의 현재 값은 4입니다. 임의 변경하면 설정 이관·초기화가 다시 실행될 수 있습니다.',
    sourceUrl:base+'packages/SystemUI/src/com/android/systemui/tuner/TunerServiceImpl.java#144', sourceLine:144, sourceConstant:'TUNER_VERSION'
  }
};
