import {getExtensionsForDevice,subscribeExtensions} from './extensions.mjs';
export const CORE_SETTINGS=Object.freeze([
  {
    "key": "screen_brightness_mode",
    "namespace": "system",
    "category": "display",
    "title": "자동 밝기",
    "description": "주변 밝기에 맞춰 화면 밝기를 자동으로 조절합니다. 수동 밝기를 사용하려면 끄세요.",
    "options": [
      {
        "value": "0",
        "label": "끄기"
      },
      {
        "value": "1",
        "label": "켜기"
      }
    ]
  },
  {
    "key": "screen_brightness",
    "namespace": "system",
    "category": "display",
    "title": "화면 밝기",
    "description": "수동 화면 밝기입니다. 자동 밝기가 켜져 있으면 기기가 이 값을 다시 조절할 수 있습니다.",
    "min": 1,
    "max": 255,
    "step": 1,
    "unit": "단계"
  },
  {
    "key": "screen_off_timeout",
    "namespace": "system",
    "category": "display",
    "title": "화면 자동 꺼짐",
    "description": "터치하지 않을 때 화면이 꺼지기까지 기다리는 시간입니다. 길게 설정하면 배터리를 더 사용합니다.",
    "options": [
      {
        "value": "15000",
        "label": "15초"
      },
      {
        "value": "30000",
        "label": "30초"
      },
      {
        "value": "60000",
        "label": "1분"
      },
      {
        "value": "120000",
        "label": "2분"
      },
      {
        "value": "300000",
        "label": "5분"
      },
      {
        "value": "600000",
        "label": "10분"
      },
      {
        "value": "1800000",
        "label": "30분"
      }
    ]
  },
  {
    "key": "font_scale",
    "namespace": "system",
    "category": "display",
    "title": "글자 크기",
    "description": "시스템 글자의 배율입니다. 1이 기본 크기이며 앱에 따라 적용 방식이 다를 수 있습니다.",
    "min": 0.85,
    "max": 1.5,
    "step": 0.05,
    "unit": "배"
  },
  {
    "key": "accelerometer_rotation",
    "namespace": "system",
    "category": "rotation",
    "title": "화면 자동 회전",
    "description": "폰을 돌리면 화면 방향도 바뀝니다. 고정 방향을 지정하려면 끄세요.",
    "options": [
      {
        "value": "0",
        "label": "끄기"
      },
      {
        "value": "1",
        "label": "켜기"
      }
    ]
  },
  {
    "key": "user_rotation",
    "namespace": "system",
    "category": "rotation",
    "title": "고정 화면 방향",
    "description": "자동 회전이 꺼져 있을 때 사용할 방향입니다. 일부 앱이나 제조사 설정은 이 값을 무시할 수 있습니다.",
    "options": [
      {
        "value": "0",
        "label": "세로 (0°)"
      },
      {
        "value": "1",
        "label": "가로 (90°)"
      },
      {
        "value": "2",
        "label": "반대 세로 (180°)"
      },
      {
        "value": "3",
        "label": "반대 가로 (270°)"
      }
    ]
  },
  {
    "key": "window_animation_scale",
    "namespace": "global",
    "category": "animation",
    "title": "창 애니메이션",
    "description": "팝업이나 창이 열리고 닫히는 효과의 재생 시간입니다. 0은 효과 없음, 1은 기본 속도입니다.",
    "options": [
      {
        "value": "0",
        "label": "사용 안 함 (0×)"
      },
      {
        "value": "0.5",
        "label": "빠르게 (0.5×)"
      },
      {
        "value": "1",
        "label": "기본 (1×)"
      },
      {
        "value": "1.5",
        "label": "느리게 (1.5×)"
      },
      {
        "value": "2",
        "label": "더 느리게 (2×)"
      }
    ]
  },
  {
    "key": "transition_animation_scale",
    "namespace": "global",
    "category": "animation",
    "title": "화면 전환 애니메이션",
    "description": "앱과 화면 사이를 이동할 때 전환 효과의 재생 시간입니다. 0은 효과 없음, 1은 기본 속도입니다.",
    "options": [
      {
        "value": "0",
        "label": "사용 안 함 (0×)"
      },
      {
        "value": "0.5",
        "label": "빠르게 (0.5×)"
      },
      {
        "value": "1",
        "label": "기본 (1×)"
      },
      {
        "value": "1.5",
        "label": "느리게 (1.5×)"
      },
      {
        "value": "2",
        "label": "더 느리게 (2×)"
      }
    ]
  },
  {
    "key": "animator_duration_scale",
    "namespace": "global",
    "category": "animation",
    "title": "앱 내부 애니메이션",
    "description": "버튼·목록 등 앱 내부에서 움직이는 효과의 재생 시간입니다. 0은 효과 없음, 1은 기본 속도입니다.",
    "options": [
      {
        "value": "0",
        "label": "사용 안 함 (0×)"
      },
      {
        "value": "0.5",
        "label": "빠르게 (0.5×)"
      },
      {
        "value": "1",
        "label": "기본 (1×)"
      },
      {
        "value": "1.5",
        "label": "느리게 (1.5×)"
      },
      {
        "value": "2",
        "label": "더 느리게 (2×)"
      }
    ]
  },
  {
    "key": "show_touches",
    "namespace": "system",
    "category": "input",
    "title": "터치 위치 표시",
    "description": "손가락이 닿는 위치에 작은 원을 표시합니다. 원격 조작이나 화면 시연을 확인할 때 유용합니다.",
    "options": [
      {
        "value": "0",
        "label": "끄기"
      },
      {
        "value": "1",
        "label": "켜기"
      }
    ]
  },
  {
    "key": "pointer_location",
    "namespace": "system",
    "category": "input",
    "title": "포인터 좌표 표시",
    "description": "화면 위에 터치 좌표와 이동 경로를 표시하는 개발자 옵션입니다. 일반 사용 중에는 화면을 가릴 수 있습니다.",
    "options": [
      {
        "value": "0",
        "label": "끄기"
      },
      {
        "value": "1",
        "label": "켜기"
      }
    ]
  },
  {
    "key": "haptic_feedback_enabled",
    "namespace": "system",
    "category": "input",
    "title": "터치 진동 피드백",
    "description": "시스템 조작 시 짧은 진동을 사용합니다. 앱 자체 진동이나 제조사 진동 설정은 별개일 수 있습니다.",
    "options": [
      {
        "value": "0",
        "label": "끄기"
      },
      {
        "value": "1",
        "label": "켜기"
      }
    ]
  },
  {
    "key": "sound_effects_enabled",
    "namespace": "system",
    "category": "input",
    "title": "터치 효과음",
    "description": "시스템 화면을 조작할 때 효과음을 재생합니다. 미디어와 알림 음량에는 영향을 주지 않습니다.",
    "options": [
      {
        "value": "0",
        "label": "끄기"
      },
      {
        "value": "1",
        "label": "켜기"
      }
    ]
  },
  {
    "namespace": "system",
    "key": "dtmf_tone",
    "category": "sound",
    "title": "전화 키패드 소리",
    "description": "전화번호를 누를 때 키패드 효과음을 재생합니다.",
    "options": [
      {
        "value": "0",
        "label": "끄기"
      },
      {
        "value": "1",
        "label": "켜기"
      }
    ],
    "requiresExisting": true
  },
  {
    "namespace": "system",
    "key": "lockscreen_sounds_enabled",
    "category": "sound",
    "title": "화면 잠금·해제 소리",
    "description": "화면을 잠그거나 해제할 때 시스템 효과음을 사용합니다.",
    "options": [
      {
        "value": "0",
        "label": "끄기"
      },
      {
        "value": "1",
        "label": "켜기"
      }
    ],
    "requiresExisting": true
  },
  {
    "namespace": "secure",
    "key": "charging_sounds_enabled",
    "category": "sound",
    "title": "충전 연결 소리",
    "description": "충전기를 연결했을 때 효과음을 재생합니다.",
    "options": [
      {
        "value": "0",
        "label": "끄기"
      },
      {
        "value": "1",
        "label": "켜기"
      }
    ],
    "requiresExisting": true
  },
  {
    "namespace": "secure",
    "key": "charging_vibration_enabled",
    "category": "sound",
    "title": "충전 연결 진동",
    "description": "충전기를 연결했을 때 짧게 진동합니다.",
    "options": [
      {
        "value": "0",
        "label": "끄기"
      },
      {
        "value": "1",
        "label": "켜기"
      }
    ],
    "requiresExisting": true
  },
  {
    "namespace": "system",
    "key": "vibrate_when_ringing",
    "category": "sound",
    "title": "전화 수신 시 진동",
    "description": "벨소리와 함께 진동을 사용합니다. 제조사의 소리 모드 설정이 우선할 수 있습니다.",
    "options": [
      {
        "value": "0",
        "label": "끄기"
      },
      {
        "value": "1",
        "label": "켜기"
      }
    ],
    "requiresExisting": true
  },
  {
    "namespace": "system",
    "key": "keyboard_vibration_enabled",
    "category": "sound",
    "title": "키보드 진동 허용 (표준 Android)",
    "description": "표준 Android 키보드 진동의 허용값입니다. 입력기의 자체 진동 메뉴와는 다른 경로이며 전체 진동 허용과 입력기 설정도 따릅니다.",
    "options": [
      {
        "value": "0",
        "label": "끄기"
      },
      {
        "value": "1",
        "label": "켜기"
      }
    ],
    "requiresExisting": true
  },
  {
    "namespace": "secure",
    "key": "night_display_activated",
    "category": "display",
    "title": "야간 화면 필터 (Android)",
    "description": "표준 Android 야간 조명입니다. 제조사 자체 화면 필터와는 별도 항목이며 키가 있는 기기만 수정합니다.",
    "options": [
      {
        "value": "0",
        "label": "끄기"
      },
      {
        "value": "1",
        "label": "켜기"
      }
    ],
    "requiresExisting": true
  },
  {
    "namespace": "system",
    "key": "status_bar_show_battery_percent",
    "category": "display",
    "title": "배터리 잔량 숫자 (표준 Android)",
    "description": "표준 Android 배터리 표시 경로의 저장값입니다. 제조사 메뉴에서 사용하는 잔량 숫자 설정과 다를 수 있습니다.",
    "options": [
      {
        "value": "0",
        "label": "끄기"
      },
      {
        "value": "1",
        "label": "켜기"
      }
    ],
    "requiresExisting": true
  },
  {
    "namespace": "system",
    "key": "peak_refresh_rate",
    "category": "display",
    "title": "최대 주사율",
    "description": "기기에 이 키가 있을 때 최대 주사율 목표를 지정합니다. 패널이 지원하는 범위만 실제 적용됩니다.",
    "options": [
      {
        "value": "60",
        "label": "60Hz"
      },
      {
        "value": "90",
        "label": "90Hz"
      },
      {
        "value": "120",
        "label": "120Hz"
      }
    ],
    "requiresExisting": true
  },
  {
    "namespace": "system",
    "key": "min_refresh_rate",
    "category": "display",
    "title": "최소 주사율",
    "description": "최소 주사율 목표입니다. 높은 값은 전력 사용량을 늘릴 수 있으며 제조사가 무시할 수 있습니다.",
    "options": [
      {
        "value": "0",
        "label": "시스템 결정"
      },
      {
        "value": "30",
        "label": "30Hz"
      },
      {
        "value": "60",
        "label": "60Hz"
      },
      {
        "value": "90",
        "label": "90Hz"
      },
      {
        "value": "120",
        "label": "120Hz"
      }
    ],
    "requiresExisting": true
  },
  {
    "namespace": "secure",
    "key": "doze_always_on",
    "category": "aod",
    "title": "AOD 요청·연동값 (표준 Android)",
    "description": "표준 Android AOD의 요청값입니다. 제조사 AOD 서비스의 연동값일 수 있으므로 독립적인 제조사 AOD 스위치로 취급하지 않습니다.",
    "options": [
      {
        "value": "0",
        "label": "끄기"
      },
      {
        "value": "1",
        "label": "켜기"
      }
    ],
    "requiresExisting": true
  },
  {
    "namespace": "secure",
    "key": "double_tap_to_wake",
    "category": "gesture",
    "title": "두 번 눌러 화면 켜기",
    "description": "꺼진 화면을 두 번 터치해 깨웁니다. 기기의 지원이 필요합니다.",
    "options": [
      {
        "value": "0",
        "label": "끄기"
      },
      {
        "value": "1",
        "label": "켜기"
      }
    ],
    "requiresExisting": true
  },
  {
    "namespace": "secure",
    "key": "one_handed_mode_enabled",
    "category": "gesture",
    "title": "한 손 조작 요청 (표준 Android)",
    "description": "표준 Android 한 손 조작의 사용 요청값입니다. 제조사 화면 축소 메뉴와는 다른 설정 경로일 수 있습니다.",
    "options": [
      {
        "value": "0",
        "label": "끄기"
      },
      {
        "value": "1",
        "label": "켜기"
      }
    ],
    "requiresExisting": true
  },
  {
    "namespace": "secure",
    "key": "show_ime_with_hard_keyboard",
    "category": "input",
    "title": "물리 키보드 사용 중 화면 키보드",
    "description": "하드웨어 키보드가 연결되어 있어도 화면 키보드를 표시합니다.",
    "options": [
      {
        "value": "0",
        "label": "끄기"
      },
      {
        "value": "1",
        "label": "켜기"
      }
    ],
    "requiresExisting": true
  },
  {
    "namespace": "secure",
    "key": "long_press_timeout",
    "category": "input",
    "title": "길게 누르기 인식 시간",
    "description": "길게 누르기로 판정하는 시간입니다. 너무 짧으면 실수로 길게 누르기가 발생할 수 있습니다.",
    "options": [
      {
        "value": "300",
        "label": "300ms"
      },
      {
        "value": "400",
        "label": "400ms"
      },
      {
        "value": "500",
        "label": "500ms"
      },
      {
        "value": "1000",
        "label": "1초"
      },
      {
        "value": "1500",
        "label": "1.5초"
      }
    ],
    "requiresExisting": true
  },
  {
    "namespace": "secure",
    "key": "multi_press_timeout",
    "category": "input",
    "title": "여러 번 누르기 간격",
    "description": "반복 입력을 여러 번 누르기로 인식하는 시간 간격입니다.",
    "requiresExisting": true,
    "min": 200,
    "max": 1000,
    "step": 50,
    "unit": "ms"
  },
  {
    "namespace": "global",
    "key": "stay_on_while_plugged_in",
    "category": "power",
    "title": "충전 중 화면 유지",
    "description": "선택한 전원에 연결된 동안 화면이 자동으로 꺼지지 않도록 합니다. 값은 전원 종류의 비트 조합이며 7에는 도크가 포함되지 않습니다.",
    "options": [
      {
        "value": "0",
        "label": "사용 안 함"
      },
      {
        "value": "1",
        "label": "AC 충전"
      },
      {
        "value": "2",
        "label": "USB 충전"
      },
      {
        "value": "3",
        "label": "AC + USB"
      },
      {
        "value": "4",
        "label": "무선 충전"
      },
      {
        "value": "7",
        "label": "AC + USB + 무선"
      },
      {
        "value": "8",
        "label": "도크 충전"
      },
      {
        "value": "15",
        "label": "모든 전원 (도크 포함)"
      }
    ],
    "requiresExisting": true
  },
  {
    "namespace": "global",
    "key": "low_power",
    "category": "power",
    "title": "절전 모드 설정값",
    "description": "Android 절전 모드 설정값입니다. 제조사 정책이나 자동 절전 조건이 값을 다시 변경할 수 있습니다.",
    "options": [
      {
        "value": "0",
        "label": "끄기"
      },
      {
        "value": "1",
        "label": "켜기"
      }
    ],
    "requiresExisting": true
  },
  {
    "namespace": "system",
    "key": "time_12_24",
    "category": "system",
    "title": "시간 표시 형식",
    "description": "시스템 시계를 12시간제 또는 24시간제로 표시합니다.",
    "options": [
      {
        "value": "12",
        "label": "12시간제"
      },
      {
        "value": "24",
        "label": "24시간제"
      }
    ],
    "requiresExisting": true
  },
  {
    "namespace": "global",
    "key": "auto_time",
    "category": "system",
    "title": "날짜·시간 자동 설정",
    "description": "네트워크에서 제공하는 시간을 사용합니다. 끄더라도 여기서 시간을 임의로 바꾸지는 않습니다.",
    "options": [
      {
        "value": "0",
        "label": "끄기"
      },
      {
        "value": "1",
        "label": "켜기"
      }
    ],
    "requiresExisting": true
  },
  {
    "namespace": "global",
    "key": "auto_time_zone",
    "category": "system",
    "title": "시간대 자동 설정",
    "description": "네트워크나 기기 정책에 따라 시간대를 자동으로 설정합니다.",
    "options": [
      {
        "value": "0",
        "label": "끄기"
      },
      {
        "value": "1",
        "label": "켜기"
      }
    ],
    "requiresExisting": true
  },
  {
    "namespace": "global",
    "key": "wifi_scan_always_enabled",
    "category": "network",
    "title": "Wi-Fi 검색 항상 사용",
    "description": "Wi-Fi 연결을 꺼도 위치 정확도 등을 위한 주변 Wi-Fi 검색을 허용합니다. Wi-Fi 연결 자체의 켜기·끄기와 다릅니다.",
    "options": [
      {
        "value": "0",
        "label": "끄기"
      },
      {
        "value": "1",
        "label": "켜기"
      }
    ],
    "requiresExisting": true
  },
  {
    "namespace": "global",
    "key": "ble_scan_always_enabled",
    "category": "network",
    "title": "블루투스 검색 항상 사용",
    "description": "블루투스를 꺼도 위치 정확도 등을 위한 BLE 검색을 허용합니다. 블루투스 연결 자체의 켜기·끄기와 다릅니다.",
    "options": [
      {
        "value": "0",
        "label": "끄기"
      },
      {
        "value": "1",
        "label": "켜기"
      }
    ],
    "requiresExisting": true
  }
]);
export const SETTINGS=[...CORE_SETTINGS];
subscribeExtensions(extensions=>{SETTINGS.splice(0,SETTINGS.length,...CORE_SETTINGS,...extensions.flatMap(ext=>ext.settings||[]));});
export const settingsForDevice=device=>[...CORE_SETTINGS,...getExtensionsForDevice(device).flatMap(ext=>ext.settings||[])];
export const CATEGORIES=[
  {
    "id": "camera",
    "title": "카메라",
    "description": "셔터음·카메라 피드백"
  },
  {
    "id": "sound",
    "title": "소리·진동",
    "description": "전화·키보드·충전 소리와 진동"
  },
  {
    "id": "display",
    "title": "화면·밝기",
    "description": "화면을 편하게 보는 방법"
  },
  {
    "id": "rotation",
    "title": "화면 회전",
    "description": "세로·가로 방향과 자동 회전"
  },
  {
    "id": "animation",
    "title": "애니메이션",
    "description": "창과 앱 전환 효과의 속도"
  },
  {
    "id": "input",
    "title": "입력·피드백",
    "description": "터치 표시, 진동과 효과음"
  },
  {
    "id": "aod",
    "title": "AOD·잠금화면",
    "description": "상시 표시와 충전 정보"
  },
  {
    "id": "gesture",
    "title": "제스처",
    "description": "화면 깨우기·한 손 조작"
  },
  {
    "id": "power",
    "title": "충전·전원",
    "description": "충전 방식과 절전 옵션"
  },
  {
    "id": "system",
    "title": "시간·시스템",
    "description": "표시 형식과 자동 시간"
  },
  {
    "id": "network",
    "title": "네트워크 검색",
    "description": "주변 무선 검색 옵션"
  }
];
