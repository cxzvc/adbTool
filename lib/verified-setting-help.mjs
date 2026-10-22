// Korean descriptions paraphrased from AOSP Android 16 Settings.java (Apache-2.0).
// Source commit: 99b01a65cc4c104933788b3143285ab6bae65827. Each entry retains its source location.
export const VERIFIED_HELP = {
  "system:end_button_behavior": {
    "title": "통화 종료 버튼의 대기 중 동작",
    "description": "통화 중이 아닐 때 종료 버튼을 누르면 실행할 동작입니다.",
    "valueGuide": "0: 아무 동작 없음 · 1: 홈 · 2: 절전·잠금 · 3: 홈으로 이동, 이미 홈이면 절전",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#4874",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "END_BUTTON_BEHAVIOR",
    "sourceLine": 4874,
    "sourceScope": "Android 16 기본 정의"
  },
  "system:next_alarm_formatted": {
    "title": "다음 알람 표시 문자열",
    "description": "다음 알람을 화면에 표시하기 위한 서식 있는 문자열입니다. 알람이 없으면 빈 문자열입니다. Android 16 소스에서 사용 중단으로 표시된 항목입니다.",
    "valueGuide": "이전 호환 항목이며 실제 알람 조회는 AlarmManager API를 사용합니다.",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#5139",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "NEXT_ALARM_FORMATTED",
    "sourceLine": 5139,
    "sourceScope": "Android 16 기본 정의"
  },
  "system:device_font_scale": {
    "title": "기기 기본 글꼴 배율",
    "description": "기기 리소스 def_device_font_scale에서 읽은 기본 글꼴 배율입니다. 사용자가 선택한 font_scale과 별개입니다.",
    "valueGuide": "소수 배율",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#5155",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "DEFAULT_DEVICE_FONT_SCALE",
    "sourceLine": 5155,
    "sourceScope": "Android 16 기본 정의"
  },
  "system:system_locales": {
    "title": "시스템 언어·지역 목록",
    "description": "시스템 언어·지역 목록을 직렬화한 저장값입니다. 공식 소스는 직접 수정 대신 LocalePicker 사용을 안내합니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#5167",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "SYSTEM_LOCALES",
    "sourceLine": 5167,
    "sourceScope": "Android 16 기본 정의"
  },
  "system:dim_screen": {
    "title": "화면 어둡게 하기 (사용 중단)",
    "description": "과거 화면 어둡게 하기 옵션입니다. Android 16 소스에서는 더 이상 사용하지 않는다고 명시합니다.",
    "valueGuide": "0: 사용 안 함 · 1: 사용",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#5193",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "DIM_SCREEN",
    "sourceLine": 5193,
    "sourceScope": "Android 16 기본 정의"
  },
  "system:mode_ringer_streams_affected": {
    "title": "벨소리·방해 금지 영향 음원",
    "description": "벨소리 모드와 방해 금지 모드 변경 시 음소거할 오디오 스트림들을 비트로 표시합니다.",
    "valueGuide": "각 스트림에 해당하는 비트가 1이면 영향 대상",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#5323",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "MODE_RINGER_STREAMS_AFFECTED",
    "sourceLine": 5323,
    "sourceScope": "Android 16 기본 정의"
  },
  "system:mute_streams_affected": {
    "title": "음소거 대상 오디오 스트림",
    "description": "음소거 요청 시 소리를 끌 오디오 스트림들을 비트로 표시합니다.",
    "valueGuide": "비트마스크이며 단순한 0/1 스위치가 아닙니다.",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#5331",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "MUTE_STREAMS_AFFECTED",
    "sourceLine": 5331,
    "sourceScope": "Android 16 기본 정의"
  },
  "system:apply_ramping_ringer": {
    "title": "점점 커지는 벨소리",
    "description": "전화가 올 때 벨소리 음량을 서서히 높이는 기능의 사용 여부입니다.",
    "valueGuide": "0: 사용 안 함 · 1: 사용",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#5347",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "APPLY_RAMPING_RINGER",
    "sourceLine": 5347,
    "sourceScope": "Android 16 기본 정의"
  },
  "system:media_vibration_intensity": {
    "title": "미디어 진동 강도",
    "description": "음악·영상·게임·애니메이션에 포함된 진동의 강도입니다. 진동 세기 조절을 지원하지 않는 기기는 단계 차이가 없을 수 있습니다.",
    "valueGuide": "0: 끄기 · 1: 약함 · 2: 중간 · 3: 강함",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#5398",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "MEDIA_VIBRATION_INTENSITY",
    "sourceLine": 5398,
    "sourceScope": "Android 16 기본 정의"
  },
  "system:volume_assistant": {
    "title": "음성 비서 음량",
    "description": "가상 음성 비서에 사용하는 음량 단계입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#5557",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "VOLUME_ASSISTANT",
    "sourceLine": 5557,
    "sourceScope": "Android 16 기본 정의"
  },
  "system:show_password": {
    "title": "입력한 비밀번호 문자 표시",
    "description": "입력란에서 방금 입력한 비밀번호 문자를 표시하는 옵션입니다.",
    "valueGuide": "0: 끄기 · 1: 켜기",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#5799",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "TEXT_SHOW_PASSWORD",
    "sourceLine": 5799,
    "sourceScope": "Android 16 기본 정의"
  },
  "system:hide_rotation_lock_toggle_for_accessibility": {
    "title": "접근성용 회전 잠금 버튼 숨김",
    "description": "접근성 때문에 화면 방향을 고정한 경우 실수로 회전 잠금을 바꾸지 않도록 시스템 UI 버튼을 숨깁니다.",
    "valueGuide": "0: 접근성 사유로 숨기지 않음 · 1: 숨김",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#5917",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "HIDE_ROTATION_LOCK_TOGGLE_FOR_ACCESSIBILITY",
    "sourceLine": 5917,
    "sourceScope": "Android 16 기본 정의"
  },
  "system:dtmf_tone_type": {
    "title": "전화 DTMF 신호 길이",
    "description": "CDMA 전화의 번호 입력 DTMF 신호 길이 설정입니다.",
    "valueGuide": "0: 보통 · 1: 길게",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#5961",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "DTMF_TONE_TYPE_WHEN_DIALING",
    "sourceLine": 5961,
    "sourceScope": "Android 16 기본 정의"
  },
  "system:hearing_aid": {
    "title": "보청기 호환 기능",
    "description": "보청기 호환 기능의 사용 여부입니다.",
    "valueGuide": "0: 끄기 · 1: 켜기",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#5970",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "HEARING_AID",
    "sourceLine": 5970,
    "sourceScope": "Android 16 기본 정의"
  },
  "system:tty_mode": {
    "title": "TTY 문자 전화 모드",
    "description": "CDMA에서 사용하는 문자 전화(TTY) 모드입니다.",
    "valueGuide": "0: 끄기 · 1: 전체 TTY · 2: VCO · 3: HCO",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#5983",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "TTY_MODE",
    "sourceLine": 5983,
    "sourceScope": "Android 16 기본 정의"
  },
  "system:notification_light_pulse": {
    "title": "알림 LED 반복 점멸",
    "description": "확인하지 않은 알림이 있을 때 알림 LED를 반복 점멸할지 정합니다.",
    "valueGuide": "0: 끄기 · 1: 켜기",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#6019",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "NOTIFICATION_LIGHT_PULSE",
    "sourceLine": 6019,
    "sourceScope": "Android 16 기본 정의"
  },
  "system:show_key_presses": {
    "title": "키 입력 화면 표시",
    "description": "포커스된 창에 전달된 키 입력을 화면에 표시합니다.",
    "valueGuide": "0: 표시 안 함 · 1: 표시",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#6047",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "SHOW_KEY_PRESSES",
    "sourceLine": 6047,
    "sourceScope": "Android 16 기본 정의"
  },
  "system:touchpad_visualizer": {
    "title": "터치패드 입력 시각화",
    "description": "터치패드에서 발생하는 입력을 화면에 시각적으로 표시합니다.",
    "valueGuide": "0: 끄기 · 1: 켜기",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#6055",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "TOUCHPAD_VISUALIZER",
    "sourceLine": 6055,
    "sourceScope": "Android 16 기본 정의"
  },
  "system:pointer_speed": {
    "title": "마우스 포인터 속도",
    "description": "마우스 등 포인터 장치의 이동 속도를 설정하는 정수값입니다.",
    "valueGuide": "-7: 가장 느림 · 0: 기본 · 7: 가장 빠름",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#6257",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "POINTER_SPEED",
    "sourceLine": 6257,
    "sourceScope": "Android 16 기본 정의"
  },
  "system:screen_flash_notification": {
    "title": "화면 깜빡임 알림",
    "description": "화면을 깜빡여 알림을 전달하는 기능입니다.",
    "valueGuide": "0: 끄기 · 1: 켜기",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#6484",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "SCREEN_FLASH_NOTIFICATION",
    "sourceLine": 6484,
    "sourceScope": "Android 16 기본 정의"
  },
  "system:screen_flash_notification_color_global": {
    "title": "화면 깜빡임 알림 색상",
    "description": "화면 깜빡임 알림에 사용할 색상을 저장합니다.",
    "valueGuide": "32비트 ARGB 색상 정수",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#6501",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "SCREEN_FLASH_NOTIFICATION_COLOR",
    "sourceLine": 6501,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:adaptive_sleep": {
    "title": "적응형 화면 꺼짐",
    "description": "적응형 절전·화면 꺼짐 기능의 사용 여부입니다. System 영역의 이전 키는 Secure 영역으로 이전되었습니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#7639",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ADAPTIVE_SLEEP",
    "sourceLine": 7639,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:bugreport_in_power_menu": {
    "title": "전원 메뉴 버그 신고",
    "description": "전원 메뉴에 버그 보고 명령을 표시할지 정합니다. Global 영역의 이전 키는 Secure로 이전되었습니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#7662",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "BUGREPORT_IN_POWER_MENU",
    "sourceLine": 7662,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:mock_location": {
    "title": "모의 위치 허용 (사용 중단)",
    "description": "과거 개발용 모의 위치 주입 허용 설정입니다. Android 16에서는 이 설정을 더 이상 사용하지 않습니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#7694",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ALLOW_MOCK_LOCATION",
    "sourceLine": 7694,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:bluetooth_name": {
    "title": "블루투스 어댑터 이름",
    "description": "Bluetooth Manager가 저장하는 기기 블루투스 어댑터 이름입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#7703",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "BLUETOOTH_NAME",
    "sourceLine": 7703,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:bluetooth_address": {
    "title": "블루투스 어댑터 주소",
    "description": "Bluetooth Manager가 저장하는 어댑터 주소입니다. 사이트에서는 식별자 값을 숨깁니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#7712",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "BLUETOOTH_ADDRESS",
    "sourceLine": 7712,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:bluetooth_addr_valid": {
    "title": "블루투스 주소 유효 상태",
    "description": "저장된 블루투스 어댑터 주소가 유효한지 기록하는 상태값입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#7721",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "BLUETOOTH_ADDR_VALID",
    "sourceLine": 7721,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:bluetooth_le_broadcast_name": {
    "title": "LE 오디오 방송 이름",
    "description": "Bluetooth LE 오디오 방송에서 사용할 방송 이름입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#7734",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "BLUETOOTH_LE_BROADCAST_NAME",
    "sourceLine": 7734,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:bluetooth_le_broadcast_code": {
    "title": "LE 오디오 방송 코드",
    "description": "Bluetooth LE 오디오 방송의 접근 코드를 저장하는 항목입니다. 사이트에서는 코드 값을 숨깁니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#7740",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "BLUETOOTH_LE_BROADCAST_CODE",
    "sourceLine": 7740,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:odi_captions_volume_ui_enabled": {
    "title": "음량 패널의 실시간 자막 버튼",
    "description": "음량 조절 화면에 실시간 자막 버튼을 표시할지 정합니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#7839",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ODI_CAPTIONS_VOLUME_UI_ENABLED",
    "sourceLine": 7839,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:default_voice_input_method": {
    "title": "기본 음성 입력기 기록",
    "description": "마지막으로 알려진 기본 음성 입력기의 ID입니다. 입력기의 사용 가능 목록과는 별도로 저장됩니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#7942",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "DEFAULT_VOICE_INPUT_METHOD",
    "sourceLine": 7942,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:input_methods_subtype_history": {
    "title": "입력기 하위 유형 사용 이력",
    "description": "입력기 ID와 마지막으로 사용한 언어·배열 하위 유형의 쌍을 저장합니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#7950",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "INPUT_METHODS_SUBTYPE_HISTORY",
    "sourceLine": 7950,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:stylus_handwriting_enabled": {
    "title": "스타일러스 필기 입력",
    "description": "입력란에 포커스가 있을 때 스타일러스 동작을 현재 입력기에 전달하는 필기 기능입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#7970",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "STYLUS_HANDWRITING_ENABLED",
    "sourceLine": 7970,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:credential_service": {
    "title": "선택된 자격 증명 서비스",
    "description": "Credential Manager에 선택된 자격 증명 서비스들의 구성요소 이름을 저장합니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#7996",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "CREDENTIAL_SERVICE",
    "sourceLine": 7996,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:credential_service_primary": {
    "title": "기본 자격 증명 서비스",
    "description": "선택된 기본 자격 증명 서비스의 구성요소 이름입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#8003",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "CREDENTIAL_SERVICE_PRIMARY",
    "sourceLine": 8003,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:autofill_field_classification": {
    "title": "자동완성 입력란 분류",
    "description": "자동완성 기능에서 입력란의 유형을 분류하는 기능의 사용 여부입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#8022",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "AUTOFILL_FEATURE_FIELD_CLASSIFICATION",
    "sourceLine": 8022,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:autofill_user_data_max_category_count": {
    "title": "자동완성 사용자 데이터 분류 상한",
    "description": "자동완성 UserData에서 허용하는 최대 카테고리 수를 정합니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#8081",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "AUTOFILL_USER_DATA_MAX_CATEGORY_COUNT",
    "sourceLine": 8081,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:content_capture_enabled": {
    "title": "화면 콘텐츠 캡처 서비스",
    "description": "현재 사용자의 Content Capture 시스템 서비스 사용 여부입니다. 일반 스크린샷 버튼과는 다른 기능입니다.",
    "valueGuide": "0: 사용 안 함 · 1: 사용",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#8114",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "CONTENT_CAPTURE_ENABLED",
    "sourceLine": 8114,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:user_setup_personalization_state": {
    "title": "기기 개인화 설정 진행 상태",
    "description": "초기 설정 중 사용자의 기기 개인화 진행 상태를 기록합니다. 값은 UserSetupPersonalization 상태 정의를 따릅니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#8213",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "USER_SETUP_PERSONALIZATION_STATE",
    "sourceLine": 8213,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:unknown_sources_default_reversed": {
    "title": "이전 외부 앱 설치 기본값 전환 기록",
    "description": "업데이트 시 외부 출처 앱 설치의 기본 정책이 뒤집혔는지 기기 정책 서비스에 알리는 내부 플래그입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#8397",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "UNKNOWN_SOURCES_DEFAULT_REVERSED",
    "sourceLine": 8397,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:location_changer": {
    "title": "위치 모드 변경 주체",
    "description": "위치 사용 모드를 변경한 앱이나 시스템 모듈을 기록하는 값입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#8430",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "LOCATION_CHANGER",
    "sourceLine": 8430,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:lock_screen_lock_after_timeout": {
    "title": "화면 꺼짐 후 잠금 지연",
    "description": "화면이 꺼진 뒤 기기를 잠글 때까지의 지연 설정입니다. 기기 관리자 정책이 더 짧은 한도를 적용할 수 있습니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#8574",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "LOCK_SCREEN_LOCK_AFTER_TIMEOUT",
    "sourceLine": 8574,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:lock_screen_owner_info_enabled": {
    "title": "잠금 화면 소유자 정보 표시",
    "description": "잠금 화면에 소유자 정보를 표시하는 이전 설정입니다. 소스에서 사용 중단으로 표시됩니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#8620",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "LOCK_SCREEN_OWNER_INFO_ENABLED",
    "sourceLine": 8620,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:trust_agents_initialized": {
    "title": "신뢰 에이전트 초기화 완료",
    "description": "시스템이 신뢰 에이전트를 초기화했음을 기록합니다.",
    "valueGuide": "1: 초기화 완료",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#8703",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "TRUST_AGENTS_INITIALIZED",
    "sourceLine": 8703,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:known_trust_agents_initialized": {
    "title": "알려진 신뢰 에이전트 목록 초기화",
    "description": "알려진 신뢰 에이전트 목록을 시스템이 초기화했음을 기록합니다.",
    "valueGuide": "1: 초기화 완료",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#8710",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "KNOWN_TRUST_AGENTS_INITIALIZED",
    "sourceLine": 8710,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:accessibility_button_target_component": {
    "title": "접근성 버튼 실행 대상",
    "description": "내비게이션 바 접근성 버튼으로 전환할 서비스 또는 시스템 접근성 기능을 지정합니다.",
    "valueGuide": "구성요소 이름 또는 시스템 클래스 이름",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#8830",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ACCESSIBILITY_BUTTON_TARGET_COMPONENT",
    "sourceLine": 8830,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:accessibility_gesture_targets": {
    "title": "접근성 제스처 실행 대상",
    "description": "접근성 제스처 바로가기로 전환할 서비스·기능 목록입니다.",
    "valueGuide": "콜론으로 구분한 구성요소·클래스 이름",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#8856",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ACCESSIBILITY_GESTURE_TARGETS",
    "sourceLine": 8856,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:notified_non_accessibility_category_services": {
    "title": "안내된 비접근성 분류 서비스",
    "description": "접근성 도구로 분류되지 않은 접근성 서비스 중 사용자에게 안내한 서비스 목록입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#8912",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "NOTIFIED_NON_ACCESSIBILITY_CATEGORY_SERVICES",
    "sourceLine": 8912,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:touch_exploration_granted_accessibility_services": {
    "title": "터치 탐색 허용 서비스",
    "description": "사용자가 터치 탐색 모드를 사용할 수 있도록 허용한 접근성 서비스 목록입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#8922",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "TOUCH_EXPLORATION_GRANTED_ACCESSIBILITY_SERVICES",
    "sourceLine": 8922,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:hush_gesture_used": {
    "title": "빠른 무음 제스처 사용 이력",
    "description": "빠른 무음 제스처를 사용한 적이 있는지 기록합니다. 현재 소리 모드 자체는 아닙니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#8961",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "HUSH_GESTURE_USED",
    "sourceLine": 8961,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:manual_ringer_toggle_count": {
    "title": "수동 벨소리 모드 전환 횟수",
    "description": "사용자가 벨소리 모드 전환 버튼을 직접 누른 횟수입니다.",
    "valueGuide": "횟수",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#8968",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "MANUAL_RINGER_TOGGLE_COUNT",
    "sourceLine": 8968,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:keyguard_slice_uri": {
    "title": "잠금 화면 요약 콘텐츠 주소",
    "description": "잠금 화면에 표시하는 Slice 콘텐츠의 URI입니다. 기본 콘텐츠는 날짜와 다음 알람입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#9012",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "KEYGUARD_SLICE_URI",
    "sourceLine": 9012,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:speak_password": {
    "title": "접근성 비밀번호 읽기 (사용 중단)",
    "description": "과거 접근성 모드의 비밀번호 읽기 설정입니다. 현재는 개별 접근성 서비스가 이 동작을 제어합니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#9036",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ACCESSIBILITY_SPEAK_PASSWORD",
    "sourceLine": 9036,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:accessibility_hct_rect_prompt_status": {
    "title": "고대비 글자 안내 상태",
    "description": "고대비 글자의 사각형 표시 변경에 대한 일회성 안내 상태입니다.",
    "valueGuide": "0: 미확인 · 1: 안내 표시됨 · 2: 안내 불필요",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#9056",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ACCESSIBILITY_HCT_RECT_PROMPT_STATUS",
    "sourceLine": 9056,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:reduce_bright_colors_level": {
    "title": "추가 화면 어둡게 강도",
    "description": "밝은 색을 줄이는 접근성 기능의 강도입니다.",
    "valueGuide": "0~100",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#9492",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "REDUCE_BRIGHT_COLORS_LEVEL",
    "sourceLine": 9492,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:allowed_geolocation_origins": {
    "title": "기본 위치 허용 웹 출처",
    "description": "브라우저에서 위치 사용을 기본 허용할 웹 출처 목록입니다.",
    "valueGuide": "공백으로 구분한 출처 목록",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#9815",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ALLOWED_GEOLOCATION_ORIGINS",
    "sourceLine": 9815,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:rtt_calling_mode": {
    "title": "실시간 문자 통화 모드",
    "description": "기기와 통신사가 지원하면 수·발신 통화를 RTT 실시간 문자 통화로 처리합니다.",
    "valueGuide": "0: 끄기 · 1: 켜기",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#9854",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "RTT_CALLING_MODE",
    "sourceLine": 9854,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:last_setup_shown": {
    "title": "마지막 초기 설정 안내 버전",
    "description": "초기 설정 마법사를 마지막으로 표시한 버전을 기록합니다. 안내할 내용이 달라지면 버전이 변경됩니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#9907",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "LAST_SETUP_SHOWN",
    "sourceLine": 9907,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:mount_play_not_snd": {
    "title": "저장장치 이벤트 알림음",
    "description": "저장장치 관리 서비스 이벤트에서 알림음을 재생할지 정합니다.",
    "valueGuide": "0: 끄기 · 1: 켜기",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#10062",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "MOUNT_PLAY_NOTIFICATION_SND",
    "sourceLine": 10062,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:mount_ums_autostart": {
    "title": "USB 대용량 저장 자동 시작",
    "description": "USB 대용량 저장 호스트를 감지했을 때 해당 모드를 자동 시작할지 정합니다.",
    "valueGuide": "0: 끄기 · 1: 켜기",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#10069",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "MOUNT_UMS_AUTOSTART",
    "sourceLine": 10069,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:mount_ums_prompt": {
    "title": "USB 저장 호스트 감지 알림",
    "description": "USB 대용량 저장 호스트를 감지했을 때 알림을 표시할지 정합니다.",
    "valueGuide": "0: 끄기 · 1: 켜기",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#10076",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "MOUNT_UMS_PROMPT",
    "sourceLine": 10076,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:mount_ums_notify_enabled": {
    "title": "USB 저장 모드 사용 알림",
    "description": "USB 대용량 저장 모드가 활성화된 동안 알림을 표시할지 정합니다.",
    "valueGuide": "0: 끄기 · 1: 켜기",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#10083",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "MOUNT_UMS_NOTIFY_ENABLED",
    "sourceLine": 10083,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:anr_show_background": {
    "title": "백그라운드 앱 응답 없음 알림",
    "description": "보이지 않는 백그라운드 앱의 응답 없음(ANR)에도 대화상자를 표시합니다. 꺼져 있으면 해당 프로세스를 조용히 종료합니다.",
    "valueGuide": "0: 사용 안 함 · 0 이외: 사용",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#10096",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ANR_SHOW_BACKGROUND",
    "sourceLine": 10096,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:show_first_crash_dialog_dev_option": {
    "title": "앱 첫 충돌 대화상자",
    "description": "전면 앱의 충돌을 대화상자로 표시할지 정하는 개발자 옵션입니다.",
    "valueGuide": "0: 표시하지 않음 · 0 이외: 표시",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#10106",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "SHOW_FIRST_CRASH_DIALOG_DEV_OPTION",
    "sourceLine": 10106,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:incall_power_button_behavior": {
    "title": "통화 중 전원 버튼 동작",
    "description": "화면이 켜진 통화 중 전원 버튼을 눌렀을 때의 동작입니다.",
    "valueGuide": "1: 화면 끄기·잠금 · 2: 통화 종료",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#10164",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "INCALL_POWER_BUTTON_BEHAVIOR",
    "sourceLine": 10164,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:mirror_built_in_display": {
    "title": "연결 화면에 기본 화면 복제",
    "description": "연결된 모든 디스플레이에 기기의 내장 화면을 복제할지 정합니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#10186",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "MIRROR_BUILT_IN_DISPLAY",
    "sourceLine": 10186,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:wake_gesture_enabled": {
    "title": "동작 감지로 화면 깨우기",
    "description": "깨우기 제스처 센서가 동작을 감지했을 때 기기를 깨울지 정합니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#10287",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "WAKE_GESTURE_ENABLED",
    "sourceLine": 10287,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:skip_gesture": {
    "title": "미디어 건너뛰기 제스처",
    "description": "미디어를 건너뛰는 제스처의 설정입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#10380",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "SKIP_GESTURE",
    "sourceLine": 10380,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:silence_gesture": {
    "title": "소리 끄기 제스처",
    "description": "알람·알림·전화 소리를 잠재우는 제스처의 설정입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#10408",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "SILENCE_GESTURE",
    "sourceLine": 10408,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:swipe_bottom_to_notification_enabled": {
    "title": "아래쪽 스와이프로 알림 펼치기",
    "description": "화면 아래쪽 스와이프로 알림 패널을 펼치는 사용자 설정입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#10471",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "SWIPE_BOTTOM_TO_NOTIFICATION_ENABLED",
    "sourceLine": 10471,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:one_handed_mode_activated": {
    "title": "한 손 모드 현재 실행 상태",
    "description": "한 손 모드가 현재 실행 중인지 나타냅니다. 기능 사용 허용 설정과는 별개입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#10478",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ONE_HANDED_MODE_ACTIVATED",
    "sourceLine": 10478,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:ui_night_mode_custom_type": {
    "title": "다크 모드 사용자 일정 유형",
    "description": "사용자가 고른 다크 모드 사용자 지정 유형입니다. UiModeManager가 관리합니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#10534",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "UI_NIGHT_MODE_CUSTOM_TYPE",
    "sourceLine": 10534,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:screensaver_enabled": {
    "title": "화면 보호기 사용",
    "description": "화면 보호기 기능을 사용할지 정합니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#10565",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "SCREENSAVER_ENABLED",
    "sourceLine": 10565,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:screensaver_components": {
    "title": "선택한 화면 보호기",
    "description": "사용자가 선택한 화면 보호기 구성요소 목록입니다. 전원·거치 조건에 맞춰 실행됩니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#10575",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "SCREENSAVER_COMPONENTS",
    "sourceLine": 10575,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:screensaver_activate_on_dock": {
    "title": "거치 시 화면 보호기",
    "description": "화면 보호기가 켜져 있을 때 책상 거치대 연결 시 자동 실행할지 정합니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#10583",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "SCREENSAVER_ACTIVATE_ON_DOCK",
    "sourceLine": 10583,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:screensaver_activate_on_sleep": {
    "title": "전원 연결 중 화면 꺼짐 시 보호기",
    "description": "화면 보호기가 켜져 있을 때 배터리로 동작하지 않는 상태에서 화면 시간 초과 시 자동 실행할지 정합니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#10591",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "SCREENSAVER_ACTIVATE_ON_SLEEP",
    "sourceLine": 10591,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:screensaver_default_component": {
    "title": "기본 화면 보호기",
    "description": "화면 보호기가 활성화되어 있을 때 사용할 기본 구성요소입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#10607",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "SCREENSAVER_DEFAULT_COMPONENT",
    "sourceLine": 10607,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:nfc_payment_default_component": {
    "title": "기본 NFC 결제 구성요소",
    "description": "기본 NFC 결제를 처리하던 구성요소입니다. 소스는 현재 지갑 역할(RoleManager)의 사용을 안내합니다. Android 16 소스에서 사용 중단으로 표시된 항목입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#10820",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "NFC_PAYMENT_DEFAULT_COMPONENT",
    "sourceLine": 10820,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:nfc_payment_foreground": {
    "title": "전면 앱의 NFC 결제 처리",
    "description": "NFC 결제를 전면 앱에서 처리할지 기본 결제 앱에서 처리할지 정하는 설정입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#10827",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "NFC_PAYMENT_FOREGROUND",
    "sourceLine": 10827,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:assist_disclosure_enabled": {
    "title": "어시스턴트 화면 전달 알림",
    "description": "화면 내용이 어시스턴트에 전달될 때 안내 애니메이션을 표시할지 정합니다. 타사 어시스턴트 등에는 안내가 강제될 수 있습니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#10892",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ASSIST_DISCLOSURE_ENABLED",
    "sourceLine": 10892,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:num_rotation_suggestions_accepted": {
    "title": "회전 제안 수락 횟수",
    "description": "사용자가 화면 회전 제안을 수락한 횟수입니다. 회전 제안 사용법을 익혔는지 판단할 때 사용합니다.",
    "valueGuide": "횟수",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#10931",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "NUM_ROTATION_SUGGESTIONS_ACCEPTED",
    "sourceLine": 10931,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:sync_parent_sounds": {
    "title": "업무 프로필 소리 동기화",
    "description": "관리되는 업무 프로필의 벨소리를 부모 프로필에서 동기화할지 정합니다.",
    "valueGuide": "0: 동기화 안 함 · 1: 동기화",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#10985",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "SYNC_PARENT_SOUNDS",
    "sourceLine": 10985,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:print_service_search_uri": {
    "title": "인쇄 서비스 검색 주소",
    "description": "설치할 인쇄 서비스를 찾기 위한 검색 URI입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#11001",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "PRINT_SERVICE_SEARCH_URI",
    "sourceLine": 11001,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:autofill_service_search_uri": {
    "title": "자동완성 서비스 검색 주소",
    "description": "설치할 자동완성 서비스를 찾기 위한 검색 URI입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#11017",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "AUTOFILL_SERVICE_SEARCH_URI",
    "sourceLine": 11017,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:spatial_audio_enabled": {
    "title": "공간 음향 사용",
    "description": "현재 사용자의 공간 음향 기능 사용 상태입니다.",
    "valueGuide": "0: 끄기 · 1: 켜기",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#11043",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "SPATIAL_AUDIO_ENABLED",
    "sourceLine": 11043,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:audio_device_inventory": {
    "title": "오디오 기기 상태 목록",
    "description": "오디오 기기별 상태 정보를 내부 형식으로 저장한 목록입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#11050",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "AUDIO_DEVICE_INVENTORY",
    "sourceLine": 11050,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:lock_screen_show_silent_notifications": {
    "title": "잠금 화면 무음 알림 표시",
    "description": "잠금 화면에 무음 알림을 표시할지 정합니다.",
    "valueGuide": "0: 숨김 · 1: 표시",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#11079",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "LOCK_SCREEN_SHOW_SILENT_NOTIFICATIONS",
    "sourceLine": 11079,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:lock_screen_show_only_unseen_notifications": {
    "title": "잠금 화면에 미확인 알림만 표시",
    "description": "이미 본 알림을 잠금 화면에서 숨길지 정합니다.",
    "valueGuide": "0: 기본 꺼짐 · 1: 미확인 알림만 · 2: 사용 안 함",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#11092",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "LOCK_SCREEN_SHOW_ONLY_UNSEEN_NOTIFICATIONS",
    "sourceLine": 11092,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:show_notification_snooze": {
    "title": "알림 미루기 버튼 표시",
    "description": "알림에서 미루기 옵션을 제공할지 정합니다.",
    "valueGuide": "0: 숨김 · 1: 표시",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#11113",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "SHOW_NOTIFICATION_SNOOZE",
    "sourceLine": 11113,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:usb_audio_automatic_routing_disabled": {
    "title": "USB 오디오 자동 전환 차단",
    "description": "USB 오디오 기기를 연결했을 때 시스템 소리가 자동으로 그 장치로 전환되는 것을 막는 설정입니다.",
    "valueGuide": "0: 자동 전환 허용 · 1: 자동 전환 차단",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#11181",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "USB_AUDIO_AUTOMATIC_ROUTING_DISABLED",
    "sourceLine": 11181,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:sleep_timeout": {
    "title": "완전 절전까지 대기 시간",
    "description": "입력이 없을 때 기기가 완전히 잠들기까지의 최대 대기 시간입니다. 일반적으로 화면 자동 꺼짐 시간보다 길어야 합니다.",
    "valueGuide": "밀리초 · -1: 이 제한 사용 안 함",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#11197",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "SLEEP_TIMEOUT",
    "sourceLine": 11197,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:double_tap_to_sleep": {
    "title": "두 번 눌러 화면 끄기",
    "description": "두 번 터치해 절전 상태로 전환하는 기능의 사용 여부입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#11225",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "DOUBLE_TAP_TO_SLEEP",
    "sourceLine": 11225,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:emergency_gesture_enabled": {
    "title": "긴급 동작 제스처",
    "description": "긴급 동작 제스처를 사용할지 정합니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#11254",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "EMERGENCY_GESTURE_ENABLED",
    "sourceLine": 11254,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:flashlight_available": {
    "title": "손전등 사용 가능 상태",
    "description": "카메라 토치 모드의 손전등을 현재 사용할 수 있는지 나타내는 상태입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#11341",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "FLASHLIGHT_AVAILABLE",
    "sourceLine": 11341,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:flashlight_enabled": {
    "title": "손전등 켜짐 상태",
    "description": "손전등의 현재 사용 상태입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#11349",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "FLASHLIGHT_ENABLED",
    "sourceLine": 11349,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:face_unlock_re_enroll": {
    "title": "얼굴 인식 재등록 필요",
    "description": "얼굴 인식 정보를 다시 등록해야 하는지 나타냅니다.",
    "valueGuide": "0: 재등록 불필요 · 1: 재등록 필요",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#11421",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "FACE_UNLOCK_RE_ENROLL",
    "sourceLine": 11421,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:mandatory_biometrics_requirements_satisfied": {
    "title": "필수 생체인증 요건 충족",
    "description": "필수 생체인증 정책의 요건이 충족되었는지 나타내는 내부 상태입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#11567",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "MANDATORY_BIOMETRICS_REQUIREMENTS_SATISFIED",
    "sourceLine": 11567,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:active_unlock_on_wake": {
    "title": "깨울 때 능동 잠금 해제 요청",
    "description": "기기를 깨울 때 Active Unlock 요청을 발생시킬지 정하는 시스템 정책입니다. 잠금 해제 성공 여부 자체는 아닙니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#11574",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ACTIVE_UNLOCK_ON_WAKE",
    "sourceLine": 11574,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:active_unlock_on_unlock_intent": {
    "title": "해제 의도 감지 시 요청",
    "description": "사용자의 잠금 해제 의도가 감지되었을 때 Active Unlock 요청을 발생시킬지 정합니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#11580",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ACTIVE_UNLOCK_ON_UNLOCK_INTENT",
    "sourceLine": 11580,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:active_unlock_on_biometric_fail": {
    "title": "생체인증 실패 시 해제 요청",
    "description": "생체인증 실패 시 Active Unlock 요청을 발생시킬지 정하는 시스템 정책입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#11587",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ACTIVE_UNLOCK_ON_BIOMETRIC_FAIL",
    "sourceLine": 11587,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:active_unlock_on_face_errors": {
    "title": "해제 요청 대상 얼굴 인식 오류",
    "description": "생체인증 실패로 취급해 Active Unlock을 요청할 얼굴 인식 오류 코드 목록입니다.",
    "valueGuide": "세로줄로 구분한 코드 · 빈 문자열: 대상 없음 · 미지정: 시스템 기본값",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#11605",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ACTIVE_UNLOCK_ON_FACE_ERRORS",
    "sourceLine": 11605,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:active_unlock_on_face_acquire_info": {
    "title": "해제 요청 대상 얼굴 인식 수집 상태",
    "description": "Active Unlock 요청을 유발하는 실패로 취급할 얼굴 인식 수집 정보 코드 목록입니다.",
    "valueGuide": "세로줄로 구분한 코드 · 빈 문자열: 대상 없음",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#11616",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ACTIVE_UNLOCK_ON_FACE_ACQUIRE_INFO",
    "sourceLine": 11616,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:active_unlock_on_unlock_intent_when_biometric_enrolled": {
    "title": "생체인증 등록 유형별 해제 요청 조건",
    "description": "특정 생체인증 유형만 등록되어 있을 때 해제 의도로 Active Unlock을 요청하는 조건 목록입니다.",
    "valueGuide": "0: 없음 · 1: 얼굴 · 2: 지문 · 3: 화면 내 지문 / 세로줄 구분",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#11628",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ACTIVE_UNLOCK_ON_UNLOCK_INTENT_WHEN_BIOMETRIC_ENROLLED",
    "sourceLine": 11628,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:active_unlock_wakeups_considered_unlock_intents": {
    "title": "해제 의도로 취급하는 깨우기 사유",
    "description": "Active Unlock에서 잠금 해제 의도로 취급할 PowerManager 깨우기 사유 코드 목록입니다.",
    "valueGuide": "세로줄로 구분한 코드 목록",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#11639",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ACTIVE_UNLOCK_WAKEUPS_CONSIDERED_UNLOCK_INTENTS",
    "sourceLine": 11639,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:sysui_qs_tiles": {
    "title": "빠른 설정 타일 순서",
    "description": "빠른 설정 패널에 표시할 타일과 순서를 저장합니다.",
    "valueGuide": "쉼표로 구분한 타일 목록",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#11982",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "QS_TILES",
    "sourceLine": 11982,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:power_menu_locked_show_content": {
    "title": "잠긴 상태의 전원 메뉴 콘텐츠",
    "description": "잠금 상태에서도 전원 메뉴의 카드·패스·기기 제어 콘텐츠를 보여줄지 정합니다.",
    "valueGuide": "0 또는 미지정: 숨김 · 1: 표시",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#12006",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "POWER_MENU_LOCKED_SHOW_CONTENT",
    "sourceLine": 12006,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:lockscreen_show_controls": {
    "title": "잠금 화면 기기 제어 접근",
    "description": "잠금 화면에서 홈 기기 제어에 접근할 수 있도록 할지 정합니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#12014",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "LOCKSCREEN_SHOW_CONTROLS",
    "sourceLine": 12014,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:lockscreen_show_wallet": {
    "title": "잠금 화면 지갑 접근",
    "description": "잠금 화면에서 지갑 기능에 접근할 수 있도록 할지 정합니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#12029",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "LOCKSCREEN_SHOW_WALLET",
    "sourceLine": 12029,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:status_bar_show_vibrate_icon": {
    "title": "상태 표시줄 진동 아이콘",
    "description": "상태 표시줄에 진동 모드 아이콘을 표시할지 정합니다. 기본값은 꺼짐입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#12044",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "STATUS_BAR_SHOW_VIBRATE_ICON",
    "sourceLine": 12044,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:lock_screen_show_qr_code_scanner": {
    "title": "잠금 화면 QR 스캐너 접근",
    "description": "잠금 화면에서 QR 코드 스캐너에 접근할 수 있도록 할지 정합니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#12060",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "LOCK_SCREEN_SHOW_QR_CODE_SCANNER",
    "sourceLine": 12060,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:notification_history_enabled": {
    "title": "알림 기록 저장",
    "description": "수신한 알림의 기록을 유지합니다. 끄면 기록 기능이 중지되고 기존 기록도 삭제됩니다.",
    "valueGuide": "0: 끄기 · 1: 켜기",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#12104",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "NOTIFICATION_HISTORY_ENABLED",
    "sourceLine": 12104,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:notification_bubbles": {
    "title": "알림 말풍선",
    "description": "지원되는 알림을 말풍선 형태로 열 수 있게 합니다. Global의 이전 키는 Secure로 이전되었습니다.",
    "valueGuide": "0: 사용 안 함 · 1: 사용",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#12126",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "NOTIFICATION_BUBBLES",
    "sourceLine": 12126,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:qs_auto_tiles": {
    "title": "자동 추가된 빠른 설정 타일",
    "description": "빠른 설정에 이미 자동으로 추가한 타일들의 이력입니다. 현재 타일 순서와는 다릅니다.",
    "valueGuide": "쉼표 구분 목록",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#12142",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "QS_AUTO_ADDED_TILES",
    "sourceLine": 12142,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:backup_manager_constants": {
    "title": "백업 관리자 동작 매개변수",
    "description": "백업 주기, 충전·네트워크 조건 등 백업 관리자의 동작 매개변수 묶음입니다.",
    "valueGuide": "쉼표로 구분한 키=값 목록",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#12177",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "BACKUP_MANAGER_CONSTANTS",
    "sourceLine": 12177,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:volume_hush_gesture": {
    "title": "빠른 무음 제스처 동작",
    "description": "빠른 무음 제스처로 실행할 동작을 지정합니다. 사용 안 함·진동·무음 중 하나에 해당합니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#12220",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "VOLUME_HUSH_GESTURE",
    "sourceLine": 12220,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:theme_customization_overlay_packages": {
    "title": "테마 맞춤설정 오버레이",
    "description": "테마 분류별로 적용할 오버레이 패키지와 Material You 색상·스타일 구성을 저장합니다.",
    "valueGuide": "JSON 객체",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#12380",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "THEME_CUSTOMIZATION_OVERLAY_PACKAGES",
    "sourceLine": 12380,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:back_gesture_inset_scale_left": {
    "title": "왼쪽 뒤로 제스처 영역 배율",
    "description": "화면 왼쪽의 뒤로 제스처 인식 영역 크기에 적용하는 배율입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#12428",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "BACK_GESTURE_INSET_SCALE_LEFT",
    "sourceLine": 12428,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:back_gesture_inset_scale_right": {
    "title": "오른쪽 뒤로 제스처 영역 배율",
    "description": "화면 오른쪽의 뒤로 제스처 인식 영역 크기에 적용하는 배율입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#12436",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "BACK_GESTURE_INSET_SCALE_RIGHT",
    "sourceLine": 12436,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:nearby_sharing_component": {
    "title": "주변 공유 제공 서비스",
    "description": "가까운 기기와 공유하는 서비스를 제공하는 현재 구성요소입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#12446",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "NEARBY_SHARING_COMPONENT",
    "sourceLine": 12446,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:accessibility_magnification_mode": {
    "title": "접근성 확대 방식",
    "description": "세 번 터치하거나 접근성 바로가기로 확대할 때 사용할 전체 화면·창 확대 모드입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#12554",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ACCESSIBILITY_MAGNIFICATION_MODE",
    "sourceLine": 12554,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:accessibility_magnification_capability": {
    "title": "접근성 확대 지원 모드",
    "description": "전체 화면 확대·창 확대 중 사용할 수 있는 확대 기능 범위를 정합니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#12690",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ACCESSIBILITY_MAGNIFICATION_CAPABILITY",
    "sourceLine": 12690,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:accessibility_floating_menu_size": {
    "title": "접근성 플로팅 메뉴 크기",
    "description": "화면 위에 떠 있는 접근성 메뉴의 크기입니다.",
    "valueGuide": "0: 작게 · 1: 크게",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#12754",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ACCESSIBILITY_FLOATING_MENU_SIZE",
    "sourceLine": 12754,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:accessibility_floating_menu_icon_type": {
    "title": "접근성 플로팅 아이콘 형태",
    "description": "접근성 플로팅 메뉴 아이콘의 표시 형태입니다.",
    "valueGuide": "0: 원형 · 1: 반원형",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#12766",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ACCESSIBILITY_FLOATING_MENU_ICON_TYPE",
    "sourceLine": 12766,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:accessibility_floating_menu_fade_enabled": {
    "title": "접근성 메뉴 흐려짐 효과",
    "description": "접근성 플로팅 메뉴를 사용하지 않을 때 흐리게 표시하는 효과를 사용할지 정합니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#12774",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ACCESSIBILITY_FLOATING_MENU_FADE_ENABLED",
    "sourceLine": 12774,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:accessibility_floating_menu_opacity": {
    "title": "접근성 메뉴 불투명도",
    "description": "접근성 플로팅 메뉴가 흐려졌을 때의 불투명도입니다.",
    "valueGuide": "0.0: 투명 ~ 1.0: 불투명",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#12783",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ACCESSIBILITY_FLOATING_MENU_OPACITY",
    "sourceLine": 12783,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:clipboard_show_access_notifications": {
    "title": "클립보드 접근 알림",
    "description": "앱이 클립보드에 접근할 때 알림을 표시할지 정합니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#12895",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "CLIPBOARD_SHOW_ACCESS_NOTIFICATIONS",
    "sourceLine": 12895,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:device_state_rotation_lock": {
    "title": "기기 자세별 회전 잠금",
    "description": "접힘·반접힘·펼침 등 기기 상태별로 적용할 회전 잠금 상태를 저장합니다.",
    "valueGuide": "상태키:설정값을 반복하는 직렬화 형식",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#12992",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "DEVICE_STATE_ROTATION_LOCK",
    "sourceLine": 12992,
    "sourceScope": "Android 16 기본 정의"
  },
  "secure:contextual_search_package": {
    "title": "화면 맥락 검색 제공 앱",
    "description": "제조사가 지정한 화면 맥락 검색 기능 제공 앱의 패키지명입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#13317",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "CONTEXTUAL_SEARCH_PACKAGE",
    "sourceLine": 13317,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:add_users_when_locked": {
    "title": "잠금 화면에서 사용자 추가",
    "description": "잠금 화면에서 사용자나 게스트를 추가할 수 있도록 할지 정합니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#13367",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ADD_USERS_WHEN_LOCKED",
    "sourceLine": 13367,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:theater_mode_on": {
    "title": "극장 모드",
    "description": "극장 모드가 켜져 있는지 나타내는 시스템 설정입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#13412",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "THEATER_MODE_ON",
    "sourceLine": 13412,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:bluetooth_disabled_profiles": {
    "title": "사용 중지할 블루투스 프로필",
    "description": "블루투스 시작 시 비활성화할 프로필을 지정하는 비트맵입니다.",
    "valueGuide": "긴 정수 비트마스크",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#13512",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "BLUETOOTH_DISABLED_PROFILES",
    "sourceLine": 13512,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:car_dock_sound": {
    "title": "차량 거치 연결음",
    "description": "차량 거치대에 연결했을 때 재생하는 소리의 URI입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#13624",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "CAR_DOCK_SOUND",
    "sourceLine": 13624,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:car_undock_sound": {
    "title": "차량 거치 분리음",
    "description": "차량 거치대에서 분리했을 때 재생하는 소리의 URI입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#13631",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "CAR_UNDOCK_SOUND",
    "sourceLine": 13631,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:desk_dock_sound": {
    "title": "책상 거치 연결음",
    "description": "책상 거치대에 연결했을 때 재생하는 소리의 URI입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#13638",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "DESK_DOCK_SOUND",
    "sourceLine": 13638,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:desk_undock_sound": {
    "title": "책상 거치 분리음",
    "description": "책상 거치대에서 분리했을 때 재생하는 소리의 URI입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#13645",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "DESK_UNDOCK_SOUND",
    "sourceLine": 13645,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:dock_sounds_enabled": {
    "title": "거치대 이벤트 소리",
    "description": "거치대 연결·분리 이벤트의 소리를 재생할지 정합니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#13652",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "DOCK_SOUNDS_ENABLED",
    "sourceLine": 13652,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:dock_sounds_enabled_when_accessbility": {
    "title": "접근성 사용 중 거치대 소리",
    "description": "접근성 서비스가 켜져 있을 때만 거치대 이벤트 소리를 재생하는 설정입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#13659",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "DOCK_SOUNDS_ENABLED_WHEN_ACCESSIBILITY",
    "sourceLine": 13659,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:lock_sound": {
    "title": "기기 잠금 효과음",
    "description": "기기가 잠겨 잠금 화면이 표시될 때 재생하는 소리의 URI입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#13666",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "LOCK_SOUND",
    "sourceLine": 13666,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:unlock_sound": {
    "title": "기기 잠금 해제 효과음",
    "description": "기기 잠금이 풀렸을 때 재생하는 소리의 URI입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#13673",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "UNLOCK_SOUND",
    "sourceLine": 13673,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:trusted_sound": {
    "title": "신뢰 상태 진입 효과음",
    "description": "잠금 해제 없이 기기가 신뢰 상태에 들어갔을 때 재생하는 소리의 URI입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#13681",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "TRUSTED_SOUND",
    "sourceLine": 13681,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:low_battery_sound": {
    "title": "배터리 부족 알림음 파일",
    "description": "배터리 부족 알림에 사용하는 소리 파일의 URI입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#13688",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "LOW_BATTERY_SOUND",
    "sourceLine": 13688,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:power_sounds_enabled": {
    "title": "배터리 부족 알림음 사용",
    "description": "배터리 부족 경고에서 소리를 재생할지 정합니다. 충전 연결음 설정과는 별개입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#13695",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "POWER_SOUNDS_ENABLED",
    "sourceLine": 13695,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:wireless_charging_started_sound": {
    "title": "무선 충전 시작음",
    "description": "무선 충전을 시작할 때 재생하는 소리의 URI입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#13702",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "WIRELESS_CHARGING_STARTED_SOUND",
    "sourceLine": 13702,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:charging_started_sound": {
    "title": "유선 충전 시작음",
    "description": "유선 충전을 시작할 때 재생하는 소리의 URI입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#13717",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "CHARGING_STARTED_SOUND",
    "sourceLine": 13717,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:debug_view_attributes": {
    "title": "화면 요소 속성 디버깅",
    "description": "View가 자체 속성 데이터를 저장할 수 있도록 허용하는 개발용 설정입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#13808",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "DEBUG_VIEW_ATTRIBUTES",
    "sourceLine": 13808,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:assisted_gps_enabled": {
    "title": "보조 GPS",
    "description": "위성 위치 측위를 보조하는 Assisted GPS 사용 여부입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#13823",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ASSISTED_GPS_ENABLED",
    "sourceLine": 13823,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:cdma_cell_broadcast_sms": {
    "title": "CDMA 셀 방송 문자",
    "description": "CDMA 셀 방송 SMS의 사용 여부입니다.",
    "valueGuide": "0: 끄기 · 1: 켜기",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#13839",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "CDMA_CELL_BROADCAST_SMS",
    "sourceLine": 13839,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:subscription_mode": {
    "title": "CDMA 가입 정보 방식",
    "description": "CDMA 가입 정보를 SIM/RUIM에서 읽을지 기기의 NV 저장소에서 읽을지 정합니다.",
    "valueGuide": "0: RUIM/SIM · 1: NV",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#13857",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "CDMA_SUBSCRIPTION_MODE",
    "sourceLine": 13857,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:default_restrict_background_data": {
    "title": "백그라운드 데이터 기본 제한",
    "description": "네트워크 정책 서비스가 사용할 백그라운드 데이터 사용 제한의 기본 설정값입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#13867",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "DEFAULT_RESTRICT_BACKGROUND_DATA",
    "sourceLine": 13867,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:force_allow_on_external": {
    "title": "외부 저장장치 앱 설치 강제 허용",
    "description": "앱 매니페스트의 지정과 관계없이 모든 앱을 외부 저장장치 설치·이동 후보로 허용하는 개발용 옵션입니다.",
    "valueGuide": "0: 사용 안 함 · 1: 사용",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#13918",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "FORCE_ALLOW_ON_EXTERNAL",
    "sourceLine": 13918,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:euicc_supported_countries": {
    "title": "eSIM 화면 표시 국가",
    "description": "eSIM 설정 화면을 표시할 국가의 ISO 코드 목록입니다. 빈 목록이면 미지원 국가 목록을 사용합니다.",
    "valueGuide": "쉼표 구분 국가 코드",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#13961",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "EUICC_SUPPORTED_COUNTRIES",
    "sourceLine": 13961,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:euicc_unsupported_countries": {
    "title": "eSIM 화면 숨김 국가",
    "description": "eSIM 설정 화면을 숨길 국가의 ISO 코드 목록입니다. 지원 국가 목록이 비어 있을 때 사용합니다.",
    "valueGuide": "쉼표 구분 국가 코드",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#13977",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "EUICC_UNSUPPORTED_COUNTRIES",
    "sourceLine": 13977,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:enable_non_resizable_multi_window": {
    "title": "크기 조절 미지원 앱의 멀티윈도",
    "description": "크기 조절을 지원하지 않는 앱도 멀티윈도에 표시하도록 허용합니다. 방향·크기 호환 처리가 적용될 수 있습니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#14036",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "DEVELOPMENT_ENABLE_NON_RESIZABLE_MULTI_WINDOW",
    "sourceLine": 14036,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:shade_display_awareness": {
    "title": "외부 화면의 알림 패널 정책",
    "description": "외부 디스플레이 연결 시 알림 패널에 적용할 표시 정책입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#14055",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "DEVELOPMENT_SHADE_DISPLAY_AWARENESS",
    "sourceLine": 14055,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:secure_frp_mode": {
    "title": "공장 초기화 보호 제한 상태",
    "description": "기기가 공장 초기화 보호(FRP)의 제한 상태에 있는지 나타냅니다. Secure의 이전 키는 Global로 이전되었습니다.",
    "valueGuide": "0: 제한 상태 아님 · 1: 제한 상태",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#14092",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "SECURE_FRP_MODE",
    "sourceLine": 14092,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:device_provisioning_mobile_data": {
    "title": "초기 설정 중 모바일 데이터",
    "description": "기기 초기 설정 중 모바일 데이터를 사용할 수 있도록 할지 정합니다.",
    "valueGuide": "0: 허용 안 함 · 1: 허용",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#14126",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "DEVICE_PROVISIONING_MOBILE_DATA_ENABLED",
    "sourceLine": 14126,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:location_background_throttle_interval_ms": {
    "title": "백그라운드 위치 요청 간격",
    "description": "백그라운드에서 들어오는 위치 요청을 제한할 때 사용하는 간격입니다.",
    "valueGuide": "밀리초",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#14185",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "LOCATION_BACKGROUND_THROTTLE_INTERVAL_MS",
    "sourceLine": 14185,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:location_ignore_settings_package_whitelist": {
    "title": "긴급 위치 설정 예외 앱 (이전 항목)",
    "description": "위치 설정이 꺼져 있어도 긴급 용도로 위치를 얻을 수 있게 허용하던 패키지 목록입니다. Android 16 소스에서 사용 중단으로 표시된 항목입니다.",
    "valueGuide": "Android 12 이후에는 사용하지 않는다고 명시된 항목",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#14214",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "LOCATION_IGNORE_SETTINGS_PACKAGE_WHITELIST",
    "sourceLine": 14214,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:wifi_always_requested": {
    "title": "다른 네트워크 연결 중 Wi-Fi 유지",
    "description": "이더넷 등 우선순위가 높은 네트워크를 사용해도 Wi-Fi 데이터 연결을 유지합니다. 앱이 별도 요청하지 않으면 Wi-Fi는 사용되지 않을 수 있습니다.",
    "valueGuide": "0: 끄기 · 1: 켜기",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#14292",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "WIFI_ALWAYS_REQUESTED",
    "sourceLine": 14292,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:night_display_forced_auto_mode_available": {
    "title": "야간 조명 강제 자동 모드 지원",
    "description": "야간 조명의 강제 자동 모드를 사용할 수 있는지 나타내는 값입니다.",
    "valueGuide": "0: 사용 불가 · 1: 사용 가능",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#14413",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "NIGHT_DISPLAY_FORCED_AUTO_MODE_AVAILABLE",
    "sourceLine": 14413,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:ota_disable_automatic_update": {
    "title": "시스템 업데이트 자동 예약 차단",
    "description": "시스템 업데이트를 자동 예약하지 않고 알림으로 안내하도록 하는 설정입니다.",
    "valueGuide": "0: 자동 예약 허용 · 1: 자동 예약 차단",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#14546",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "OTA_DISABLE_AUTOMATIC_UPDATE",
    "sourceLine": 14546,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:verifier_timeout": {
    "title": "앱 설치 검증 대기 시간",
    "description": "패키지 설치 검증의 응답을 기다리는 제한 시간입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#14561",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "PACKAGE_VERIFIER_TIMEOUT",
    "sourceLine": 14561,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:tether_offload_disabled": {
    "title": "테더링 하드웨어 오프로딩 차단",
    "description": "테더링 처리를 하드웨어에 넘기는 HAL 사용을 시도하지 않도록 하는 설정입니다.",
    "valueGuide": "미지정: 차단하지 않음",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#14785",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "TETHER_OFFLOAD_DISABLED",
    "sourceLine": 14785,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:carrier_app_whitelist": {
    "title": "통신사 앱 설치 권유 허용 목록",
    "description": "SIM의 통신사 권한 규칙과 일치할 때 설치를 권유할 수 있는 인증서·패키지 쌍의 목록입니다.",
    "valueGuide": "인증서:패키지 쌍을 세미콜론으로 구분",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#14810",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "CARRIER_APP_WHITELIST",
    "sourceLine": 14810,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:carrier_app_names": {
    "title": "통신사 앱 표시 이름",
    "description": "통신사 앱 패키지명과 표시 이름의 대응 목록입니다.",
    "valueGuide": "패키지:이름 쌍을 세미콜론으로 구분",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#14821",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "CARRIER_APP_NAMES",
    "sourceLine": 14821,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:usb_mass_storage_enabled": {
    "title": "USB 대용량 저장 모드",
    "description": "USB 대용량 저장 모드의 활성화 설정입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#14827",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "USB_MASS_STORAGE_ENABLED",
    "sourceLine": 14827,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:user_switcher_enabled": {
    "title": "사용자 전환·생성 사용",
    "description": "사용자가 사용자 전환과 생성을 사용할 수 있도록 할지 정합니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#14841",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "USER_SWITCHER_ENABLED",
    "sourceLine": 14841,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:network_watchlist_last_report_time": {
    "title": "네트워크 감시 최근 보고 시각",
    "description": "Network Watchlist 기능에서 마지막으로 보고한 시각을 기록합니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#14924",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "NETWORK_WATCHLIST_LAST_REPORT_TIME",
    "sourceLine": 14924,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:wifi_display_on": {
    "title": "Wi-Fi 디스플레이 사용",
    "description": "무선 디스플레이 기능의 사용 여부입니다.",
    "valueGuide": "0: 끄기 · 1: 켜기",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#14945",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "WIFI_DISPLAY_ON",
    "sourceLine": 14945,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:wifi_display_certification_on": {
    "title": "무선 디스플레이 인증 시험 모드",
    "description": "Wi-Fi 디스플레이 인증 시험 모드의 사용 여부입니다.",
    "valueGuide": "0: 끄기 · 1: 켜기",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#14953",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "WIFI_DISPLAY_CERTIFICATION_ON",
    "sourceLine": 14953,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:wifi_migration_completed": {
    "title": "Wi-Fi 설정 이전 완료",
    "description": "Wi-Fi 설정 데이터 이전 작업이 끝났는지 나타내는 내부 상태입니다.",
    "valueGuide": "0: 미완료 · 1: 완료",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#15104",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "WIFI_MIGRATION_COMPLETED",
    "sourceLine": 15104,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:uwb_enabled": {
    "title": "UWB 사용",
    "description": "초광대역(UWB) 무선 기능의 사용 여부입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#15110",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "UWB_ENABLED",
    "sourceLine": 15110,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:network_scoring_ui_enabled": {
    "title": "네트워크 품질 점수 표시",
    "description": "네트워크 품질 점수와 배지를 화면에 표시하던 옵션입니다. 관련 NetworkScoreManager는 사용 중단되었습니다.",
    "valueGuide": "0: 숨김 · 1: 표시",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#15121",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "NETWORK_SCORING_UI_ENABLED",
    "sourceLine": 15121,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:network_recommendations_enabled": {
    "title": "네트워크 추천 사용",
    "description": "네트워크 추천 서비스의 사용 상태입니다. 제거 예정으로 표시된 이전 기능입니다.",
    "valueGuide": "-1: 강제 끄기 · 0: 끄기 · 1: 켜기",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#15153",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "NETWORK_RECOMMENDATIONS_ENABLED",
    "sourceLine": 15153,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:network_recommendations_package": {
    "title": "네트워크 추천 앱",
    "description": "네트워크 추천을 제공하는 패키지명입니다. 미지정이면 추천을 요청하거나 수락하지 않습니다. Android 16 소스에서 사용 중단으로 표시된 항목입니다.",
    "valueGuide": "관련 NetworkScoreManager는 사용 중단된 API입니다.",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#15169",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "NETWORK_RECOMMENDATIONS_PACKAGE",
    "sourceLine": 15169,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:ble_scan_low_power_window_ms": {
    "title": "BLE 저전력 검색 구간",
    "description": "저전력 검색 모드에서 한 번 BLE를 검색하는 구간의 길이입니다.",
    "valueGuide": "밀리초",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#15227",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "BLE_SCAN_LOW_POWER_WINDOW_MS",
    "sourceLine": 15227,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:ble_scan_balanced_window_ms": {
    "title": "BLE 균형 검색 구간",
    "description": "균형 검색 모드에서 한 번 BLE를 검색하는 구간의 길이입니다.",
    "valueGuide": "밀리초",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#15236",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "BLE_SCAN_BALANCED_WINDOW_MS",
    "sourceLine": 15236,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:ble_scan_low_power_interval_ms": {
    "title": "BLE 저전력 검색 주기",
    "description": "저전력 모드의 BLE 검색 구간 사이에 적용할 주기입니다.",
    "valueGuide": "밀리초",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#15255",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "BLE_SCAN_LOW_POWER_INTERVAL_MS",
    "sourceLine": 15255,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:ble_scan_balanced_interval_ms": {
    "title": "BLE 균형 검색 주기",
    "description": "균형 모드의 BLE 검색 구간 사이에 적용할 주기입니다.",
    "valueGuide": "밀리초",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#15265",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "BLE_SCAN_BALANCED_INTERVAL_MS",
    "sourceLine": 15265,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:wifi_watchdog_poor_network_test_enabled": {
    "title": "불량 Wi-Fi 연결 회피",
    "description": "품질이 낮은 Wi-Fi를 회피하는 기능의 사용 여부입니다. 기본은 켜짐입니다.",
    "valueGuide": "0: 회피 기능 끄기",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#15332",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "WIFI_WATCHDOG_POOR_NETWORK_TEST_ENABLED",
    "sourceLine": 15332,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:wifi_max_dhcp_retry_count": {
    "title": "DHCP 실패 후 재연결 횟수",
    "description": "DHCP로 IP 주소를 얻지 못한 Wi-Fi에 다시 연결할 최대 재시도 횟수입니다.",
    "valueGuide": "N이면 최초 시도를 포함해 총 N+1회",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#15382",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "WIFI_MAX_DHCP_RETRY_COUNT",
    "sourceLine": 15382,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:overlay_display_devices": {
    "title": "가상 보조 디스플레이",
    "description": "개발용 가상 보조 화면의 해상도·밀도·플래그를 정의하는 문자열입니다. 빈 값이면 가상 화면을 만들지 않습니다.",
    "valueGuide": "예: 1280x720/213 · 화면별 세미콜론 구분",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#15553",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "OVERLAY_DISPLAY_DEVICES",
    "sourceLine": 15553,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:send_action_app_error": {
    "title": "앱 오류 보고 동작 허용",
    "description": "앱 충돌이나 응답 없음에서 ACTION_APP_ERROR를 보내도록 허용합니다. 끄면 오류 대화상자의 보고 버튼도 표시하지 않습니다.",
    "valueGuide": "0: 허용 안 함 · 1: 허용",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#15579",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "SEND_ACTION_APP_ERROR",
    "sourceLine": 15579,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:set_install_location": {
    "title": "기본 앱 설치 위치 선택 허용",
    "description": "사용자가 기본 앱 설치 위치를 고를 수 있도록 하는 개발용 설정입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#15919",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "SET_INSTALL_LOCATION",
    "sourceLine": 15919,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:default_install_location": {
    "title": "기본 앱 설치 위치",
    "description": "앱의 기본 설치 위치를 정하는 값입니다.",
    "valueGuide": "0: 시스템 자동 결정 · 1: 내부 저장소 · 2: SD 카드",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#15929",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "DEFAULT_INSTALL_LOCATION",
    "sourceLine": 15929,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:activity_starts_logging_enabled": {
    "title": "앱 활동 시작 기록",
    "description": "액티비티가 시작되는 이벤트를 기록하는 기능입니다.",
    "valueGuide": "0: 끄기 · 1: 켜기 · 기본값: 1",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#16185",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ACTIVITY_STARTS_LOGGING_ENABLED",
    "sourceLine": 16185,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:battery_tip_constants": {
    "title": "배터리 관리 제안 매개변수",
    "description": "사용량 높은 앱·낮은 배터리 잔량 등 배터리 관리 제안의 조건을 묶어서 저장합니다.",
    "valueGuide": "쉼표로 구분한 키=값 목록",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#16352",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "BATTERY_TIP_CONSTANTS",
    "sourceLine": 16352,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:anomaly_detection_constants": {
    "title": "배터리 이상 사용 감지 조건",
    "description": "웨이크락·깨우기 알람·블루투스 검색 등의 이상 사용 감지 기준을 저장합니다.",
    "valueGuide": "쉼표로 구분한 키=값 목록",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#16378",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ANOMALY_DETECTION_CONSTANTS",
    "sourceLine": 16378,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:anomaly_config_version": {
    "title": "이상 감지 구성 버전",
    "description": "이상 감지 구성 데이터의 버전을 나타내는 정수입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#16386",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ANOMALY_CONFIG_VERSION",
    "sourceLine": 16386,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:anomaly_config": {
    "title": "이상 통계 수집 구성",
    "description": "StatsManager에 사용하는 이상 통계 수집 구성 데이터입니다.",
    "valueGuide": "Base64로 인코딩된 문자열",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#16394",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ANOMALY_CONFIG",
    "sourceLine": 16394,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:always_on_display_constants": {
    "title": "AOD 내부 동작 매개변수",
    "description": "AOD 밝기 배열, 근접 센서로 화면을 끄는 지연 등 동작 조건을 묶어 저장합니다.",
    "valueGuide": "쉼표로 구분한 키=값 목록",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#16414",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ALWAYS_ON_DISPLAY_CONSTANTS",
    "sourceLine": 16414,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:sys_uidcpupower": {
    "title": "UID별 CPU 전력 통계",
    "description": "sys.uidcpupower 시스템 속성과 연계해 UID별 CPU 전력 통계 인터페이스를 제어합니다.",
    "valueGuide": "0: 사용 안 함 · 1 및 기타 값: 사용",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#16425",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "SYS_UIDCPUPOWER",
    "sourceLine": 16425,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:art_verifier_verify_debuggable": {
    "title": "디버그 앱 바이트코드 검증",
    "description": "디버깅 가능한 앱에도 ART 바이트코드 검증을 수행할지 정합니다.",
    "valueGuide": "0: 끄기 · 1: 켜기",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#16479",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ART_VERIFIER_VERIFY_DEBUGGABLE",
    "sourceLine": 16479,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:text_classifier_constants": {
    "title": "텍스트 분류 동작 매개변수",
    "description": "언어 감지, 텍스트 선택·링크 생성·대화 추천 등 TextClassifier 기능의 매개변수입니다.",
    "valueGuide": "쉼표로 구분한 키=값 목록",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#16581",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "TEXT_CLASSIFIER_CONSTANTS",
    "sourceLine": 16581,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:battery_stats_constants": {
    "title": "배터리 사용 통계 매개변수",
    "description": "CPU 시간 추적, 통계 수집 간격, 이력 파일 크기 등 BatteryStats의 동작 조건입니다.",
    "valueGuide": "쉼표로 구분한 키=값 목록",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#16607",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "BATTERY_STATS_CONSTANTS",
    "sourceLine": 16607,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:network_watchlist_enabled": {
    "title": "네트워크 감시 기능",
    "description": "Network Watchlist 기능의 활성화 설정입니다.",
    "valueGuide": "0: 끄기 · 1: 켜기 · 기본값: 0",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#16776",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "NETWORK_WATCHLIST_ENABLED",
    "sourceLine": 16776,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:adb_allowed_connection_time": {
    "title": "ADB 승인 유지 시간",
    "description": "항상 허용한 PC가 사용자 재승인 없이 다시 ADB 연결할 수 있는 기간입니다. 마지막 연결 시각과 함께 판단합니다.",
    "valueGuide": "밀리초",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#16831",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ADB_ALLOWED_CONNECTION_TIME",
    "sourceLine": 16831,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:emergency_tone": {
    "title": "CDMA 긴급 알림 방식",
    "description": "CDMA 긴급 알림의 소리·진동 방식을 정합니다.",
    "valueGuide": "0: 끄기 · 1: 소리 · 2: 진동",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#16899",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "EMERGENCY_TONE",
    "sourceLine": 16899,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:call_auto_retry": {
    "title": "CDMA 통화 자동 재시도",
    "description": "CDMA 통화 자동 재시도 기능의 사용 여부입니다.",
    "valueGuide": "0: 끄기 · 1: 켜기",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#16908",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "CALL_AUTO_RETRY",
    "sourceLine": 16908,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:emergency_gesture_power_button_cooldown_period_ms": {
    "title": "긴급 제스처 후 전원 버튼 대기",
    "description": "긴급 제스처를 실행한 뒤 전원 버튼의 단일 누르기 동작을 잠시 억제하는 시간입니다.",
    "valueGuide": "밀리초 · 0: 대기 기능 끄기",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#16925",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "EMERGENCY_GESTURE_POWER_BUTTON_COOLDOWN_PERIOD_MS",
    "sourceLine": 16925,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:enable_gpu_debug_layers": {
    "title": "GPU 디버깅 레이어",
    "description": "GPU 디버깅 레이어를 허용하는 개발자 옵션입니다.",
    "valueGuide": "0: 허용 안 함 · 1: 허용",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#16986",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ENABLE_GPU_DEBUG_LAYERS",
    "sourceLine": 16986,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:updatable_driver_production_denylist": {
    "title": "업데이트형 GPU 드라이버 제외 앱",
    "description": "업데이트 가능한 정식 그래픽 드라이버를 사용하지 못하게 할 앱 목록입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#17088",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "UPDATABLE_DRIVER_PRODUCTION_DENYLIST",
    "sourceLine": 17088,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:updatable_driver_production_allowlist": {
    "title": "업데이트형 GPU 드라이버 허용 앱",
    "description": "업데이트 가능한 정식 그래픽 드라이버를 사용할 수 있는 앱 목록입니다.",
    "valueGuide": "쉼표로 구분한 패키지명",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#17107",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "UPDATABLE_DRIVER_PRODUCTION_ALLOWLIST",
    "sourceLine": 17107,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:dock_audio_media_enabled": {
    "title": "거치대 오디오로 미디어 출력",
    "description": "미디어 소리를 거치대의 오디오 출력으로 보낼지 정합니다.",
    "valueGuide": "0: 끄기 · 1: 켜기",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#17346",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "DOCK_AUDIO_MEDIA_ENABLED",
    "sourceLine": 17346,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:audio_safe_volume_state": {
    "title": "안전한 헤드폰 음량 관리 상태",
    "description": "AudioService가 저장하는 헤드폰 안전 음량 관리 상태입니다. 음량 숫자 자체는 아닙니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#17432",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "AUDIO_SAFE_VOLUME_STATE",
    "sourceLine": 17432,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:sms_short_codes_content_url": {
    "title": "SMS 단축번호 규칙 업데이트 주소",
    "description": "SMS 단축번호 규칙 데이터의 업데이트 URL입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#17486",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "SMS_SHORT_CODES_UPDATE_CONTENT_URL",
    "sourceLine": 17486,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:sms_short_codes_metadata_url": {
    "title": "SMS 단축번호 규칙 메타데이터 주소",
    "description": "SMS 단축번호 규칙 업데이트의 메타데이터 URL입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#17494",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "SMS_SHORT_CODES_UPDATE_METADATA_URL",
    "sourceLine": 17494,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:cert_pin_content_url": {
    "title": "인증서 고정 목록 업데이트 주소",
    "description": "인증서 고정 목록 데이터를 업데이트할 URL입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#17516",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "CERT_PIN_UPDATE_CONTENT_URL",
    "sourceLine": 17516,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:cert_pin_metadata_url": {
    "title": "인증서 고정 목록 메타데이터 주소",
    "description": "인증서 고정 목록 업데이트에 사용하는 메타데이터 URL입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#17523",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "CERT_PIN_UPDATE_METADATA_URL",
    "sourceLine": 17523,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:debug.force_rtl": {
    "title": "오른쪽에서 왼쪽 배치 강제",
    "description": "앱과 시스템 화면의 배치를 오른쪽에서 왼쪽(RTL) 방향으로 강제하는 개발자 옵션입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#17599",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "DEVELOPMENT_FORCE_RTL",
    "sourceLine": 17599,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:low_battery_sound_timeout": {
    "title": "화면 꺼짐 후 배터리 경고음 제한",
    "description": "화면이 꺼진 뒤 이 시간이 지나면 배터리 부족 경고음을 내지 않도록 합니다.",
    "valueGuide": "밀리초 · 0: 시간 제한 없이 재생",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#17610",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "LOW_BATTERY_SOUND_TIMEOUT",
    "sourceLine": 17610,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:policy_control": {
    "title": "창 정책 실행 중 재정의",
    "description": "창 관리 정책을 실행 중에 덮어쓰는 설정 문자열입니다. 구체적인 형식은 WindowManager의 PolicyControl 정의를 따릅니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#17630",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "POLICY_CONTROL",
    "sourceLine": 17630,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:user_disabled_hdr_formats": {
    "title": "사용자가 제외한 HDR 형식",
    "description": "사용자가 사용하지 않도록 지정한 HDR 형식 목록입니다. 관련 허용 설정에 따라 앱에 형식을 보고하지 않을 수 있습니다.",
    "valueGuide": "쉼표로 구분한 형식 코드",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#17686",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "USER_DISABLED_HDR_FORMATS",
    "sourceLine": 17686,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:require_password_to_decrypt": {
    "title": "구형 전체 디스크 암호화 부팅 인증",
    "description": "전체 디스크 암호화 기기에서 부팅 시 기본 사용자의 잠금 자격 증명을 요구할지 정합니다. 파일 기반 암호화 기기에는 효과가 없습니다.",
    "valueGuide": "Android 10 이상으로 출시된 기기는 파일 기반 암호화를 사용합니다.",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#17909",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "REQUIRE_PASSWORD_TO_DECRYPT",
    "sourceLine": 17909,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:lid_behavior": {
    "title": "덮개를 닫았을 때 동작",
    "description": "덮개를 닫았을 때 실행할 동작을 정합니다. 값은 WindowManagerPolicy의 동작 정의를 따릅니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#18009",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "LID_BEHAVIOR",
    "sourceLine": 18009,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:database_creation_buildid": {
    "title": "설정 데이터베이스 생성 빌드",
    "description": "설정 데이터베이스를 최초 생성하거나 재생성했을 때의 OS 빌드 ID입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#18154",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "DATABASE_CREATION_BUILDID",
    "sourceLine": 18154,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:euicc_factory_reset_timeout_millis": {
    "title": "eSIM 초기화 응답 대기",
    "description": "시스템 설정에서 eSIM 초기화를 기다릴 최대 시간입니다.",
    "valueGuide": "밀리초",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#18192",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "EUICC_FACTORY_RESET_TIMEOUT_MILLIS",
    "sourceLine": 18192,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:euicc_switch_slot_timeout_millis": {
    "title": "eSIM 슬롯 전환 응답 대기",
    "description": "eSIM 슬롯 전환 완료를 기다릴 최대 시간입니다.",
    "valueGuide": "밀리초",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#18201",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "EUICC_SWITCH_SLOT_TIMEOUT_MILLIS",
    "sourceLine": 18201,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:enable_multi_slot_timeout_millis": {
    "title": "다중 SIM 슬롯 활성화 응답 대기",
    "description": "여러 SIM 슬롯의 활성화 완료를 기다리는 시간입니다.",
    "valueGuide": "밀리초",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#18210",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ENABLE_MULTI_SLOT_TIMEOUT_MILLIS",
    "sourceLine": 18210,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:autofill_compat_mode_allowed_packages": {
    "title": "자동완성 호환 모드 앱",
    "description": "자동완성 호환 모드가 허용된 앱과 선택적인 주소창 리소스 ID 목록입니다. 이전 설정이며 DeviceConfig 방식으로 이전되었습니다.",
    "valueGuide": "콜론으로 앱 구분, 대괄호로 리소스 ID 지정",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#18275",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "AUTOFILL_COMPAT_MODE_ALLOWED_PACKAGES",
    "sourceLine": 18275,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:autofill_logging_level": {
    "title": "자동완성 로그 상세 수준",
    "description": "자동완성 기능의 로그 출력을 없음·디버그·상세 수준으로 지정합니다. 실제 숫자는 AutofillManager 상수 정의를 따릅니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#18289",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "AUTOFILL_LOGGING_LEVEL",
    "sourceLine": 18289,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:stylus_ever_used": {
    "title": "스타일러스 사용 이력",
    "description": "이 기기에서 스타일러스를 사용한 적이 있는지 기록합니다. 현재 연결 상태와는 다릅니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#18315",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "STYLUS_EVER_USED",
    "sourceLine": 18315,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:sound_trigger_detection_service_op_timeout": {
    "title": "소리 감지 서비스 작업 제한",
    "description": "SoundTriggerDetectionService의 단일 작업에 허용할 최대 시간입니다.",
    "valueGuide": "밀리초",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#18364",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "SOUND_TRIGGER_DETECTION_SERVICE_OP_TIMEOUT",
    "sourceLine": 18364,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:max_sound_trigger_detection_service_ops_per_day": {
    "title": "소리 감지 서비스 하루 작업 상한",
    "description": "SoundTriggerDetectionService가 하루에 수행할 수 있는 최대 작업 수입니다.",
    "valueGuide": "일일 작업 수",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#18374",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "MAX_SOUND_TRIGGER_DETECTION_SERVICE_OPS_PER_DAY",
    "sourceLine": 18374,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:hearing_device_local_ambient_volume": {
    "title": "보청 기기 주변 소리 음량",
    "description": "블루투스 보청 기기의 로컬·그룹 주변 소리 음량과 제어 상태를 저장합니다.",
    "valueGuide": "기기별 키=값 묶음을 세미콜론으로 구분",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#18545",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "HEARING_DEVICE_LOCAL_AMBIENT_VOLUME",
    "sourceLine": 18545,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:multi_sim_voice_call": {
    "title": "기본 음성 통화 회선 ID",
    "description": "다중 SIM 기기에서 음성 통화에 사용할 가입 회선 ID입니다. 물리 슬롯 번호와 같다고 단정할 수 없습니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#19045",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "MULTI_SIM_VOICE_CALL_SUBSCRIPTION",
    "sourceLine": 19045,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:multi_sim_data_call": {
    "title": "기본 데이터 회선 ID",
    "description": "다중 SIM 기기에서 데이터 통신에 사용할 가입 회선 ID입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#19061",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "MULTI_SIM_DATA_CALL_SUBSCRIPTION",
    "sourceLine": 19061,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:multi_sim_sms": {
    "title": "기본 SMS 회선 ID",
    "description": "다중 SIM 기기에서 SMS에 사용할 가입 회선 ID입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#19068",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "MULTI_SIM_SMS_SUBSCRIPTION",
    "sourceLine": 19068,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:enable_cellular_on_boot": {
    "title": "부팅 시 이동통신 사용",
    "description": "기기를 부팅할 때 이동통신 기능을 활성화할지 정합니다.",
    "valueGuide": "0: 사용 안 함 · 1: 사용",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#19135",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ENABLE_CELLULAR_ON_BOOT",
    "sourceLine": 19135,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:disable_screen_share_protections_for_apps_and_notifications": {
    "title": "앱·알림 화면 공유 보호 해제 플래그",
    "description": "앱과 알림의 화면 공유 보호를 해제하는 시스템 설정 플래그입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#19163",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "DISABLE_SCREEN_SHARE_PROTECTIONS_FOR_APPS_AND_NOTIFICATIONS",
    "sourceLine": 19163,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:cell_on": {
    "title": "이동통신 기능 상태",
    "description": "이동통신 기능의 사용 상태를 저장하는 값입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#19171",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "CELL_ON",
    "sourceLine": 19171,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:notification_snooze_options": {
    "title": "알림 미루기 시간 선택지",
    "description": "알림 미루기의 기본 시간과 선택 가능한 시간 목록을 정합니다.",
    "valueGuide": "분 단위 · 예: default=60,options_array=15:30:60:120",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#19257",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "NOTIFICATION_SNOOZE_OPTIONS",
    "sourceLine": 19257,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:blocking_helper_dismiss_to_view_ratio": {
    "title": "알림 차단 제안의 삭제 비율 기준",
    "description": "알림 조회 대비 삭제 비율로 차단 도움말 표시 여부를 판단하는 기준입니다.",
    "valueGuide": "0.0~1.0 · 낮을수록 차단 도움말이 더 적극적으로 표시됨",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#19280",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "BLOCKING_HELPER_DISMISS_TO_VIEW_RATIO_LIMIT",
    "sourceLine": 19280,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:blocking_helper_streak_limit": {
    "title": "알림 차단 제안의 연속 삭제 기준",
    "description": "알림을 연속으로 삭제한 횟수를 차단 도움말 판단에 사용하는 기준입니다.",
    "valueGuide": "0보다 큰 정수",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#19292",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "BLOCKING_HELPER_STREAK_LIMIT",
    "sourceLine": 19292,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:sqlite_compatibility_wal_flags": {
    "title": "SQLite WAL 호환 구성",
    "description": "SQLite의 WAL 호환 모드·동기화 방식·로그 크기 등을 정하는 키=값 구성입니다. 일부 키는 이전 버전 호환용입니다.",
    "valueGuide": "",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#19320",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "SQLITE_COMPATIBILITY_WAL_FLAGS",
    "sourceLine": 19320,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:enable_gnss_raw_meas_full_tracking": {
    "title": "GNSS 원시 측정 전체 추적",
    "description": "위성 항법의 원시 측정에서 전체 추적을 활성화할지 정합니다.",
    "valueGuide": "0: 끄기 · 1: 켜기",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#19330",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ENABLE_GNSS_RAW_MEAS_FULL_TRACKING",
    "sourceLine": 19330,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:zram_enabled": {
    "title": "압축 RAM 사용",
    "description": "zram 압축 메모리 사용 여부입니다. 재부팅 후 적용되는 설정입니다.",
    "valueGuide": "0: 끄기 · 1: 켜기 · 다른 값은 정의되지 않음",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#19364",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "ZRAM_ENABLED",
    "sourceLine": 19364,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:smart_replies_in_notifications_flags": {
    "title": "알림 답장 추천 구성",
    "description": "알림 답장 추천의 사용 여부, 최소 추천 수, 전송 전 편집 등 동작 조건입니다.",
    "valueGuide": "쉼표로 구분한 키=값 목록",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#19397",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "SMART_REPLIES_IN_NOTIFICATIONS_FLAGS",
    "sourceLine": 19397,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:backup_agent_timeout_parameters": {
    "title": "백업·복원 작업 제한 시간",
    "description": "키-값 백업, 전체 백업, 공유 저장소 백업, 복원 단계별 최대 대기 시간을 지정합니다.",
    "valueGuide": "각 시간은 밀리초 · 쉼표로 구분한 키=값 목록",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#19462",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "BACKUP_AGENT_TIMEOUT_PARAMETERS",
    "sourceLine": 19462,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:gnss_satellite_blocklist": {
    "title": "제외할 위성 목록",
    "description": "위치 측위에서 제외할 위성군과 위성 ID의 쌍을 저장합니다.",
    "valueGuide": "정수 쌍을 쉼표로 구분 · 위성 ID 0은 해당 위성군 전체",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#19476",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "GNSS_SATELLITE_BLOCKLIST",
    "sourceLine": 19476,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:binder_calls_stats": {
    "title": "Binder 호출 통계 구성",
    "description": "Binder 호출 통계의 사용 여부, 세부 추적, 업로드, 샘플링 간격 등을 저장합니다.",
    "valueGuide": "키=값 구성",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#19505",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "BINDER_CALLS_STATS",
    "sourceLine": 19505,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:battery_charging_state_update_delay": {
    "title": "충전 상태 알림 지연",
    "description": "전원 연결 후 ACTION_CHARGING 알림을 보내기까지의 지연을 BatteryStats 기본값 대신 지정합니다.",
    "valueGuide": "BatteryStats의 충전 알림 지연 재정의 값",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#19626",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "BATTERY_CHARGING_STATE_UPDATE_DELAY",
    "sourceLine": 19626,
    "sourceScope": "Android 16 기본 정의"
  },
  "global:battery_charging_state_enforce_level": {
    "title": "충전 중으로 판정할 배터리 기준",
    "description": "잔량이 이 기준 이상이면 이후 잔량이 줄더라도 통계에서 충전 중으로 간주하도록 하는 기준입니다.",
    "valueGuide": "실제 충전 상한이나 배터리 보호 한도가 아닙니다.",
    "sourceUrl": "https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/provider/Settings.java#19642",
    "sourceLabel": "Android 16 공식 소스",
    "sourceConstant": "BATTERY_CHARGING_STATE_ENFORCE_LEVEL",
    "sourceLine": 19642,
    "sourceScope": "Android 16 기본 정의"
  }
};
