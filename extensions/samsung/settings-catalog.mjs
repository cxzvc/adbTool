export const SETTINGS = [
  {
    "namespace": "system",
    "key": "csc_pref_camera_forced_shuttersound_key",
    "category": "camera",
    "title": "카메라 강제 셔터음 조건",
    "description": "삼성 카메라의 셔터음 강제 설정입니다. 0은 강제 조건을 해제하고, 1은 사용합니다. 0이 모든 촬영음 무음을 보장하는 것은 아닙니다.",
    "options": [
      {
        "value": "0",
        "label": "강제 조건 해제 (0)"
      },
      {
        "value": "1",
        "label": "강제 조건 사용 (1)"
      }
    ],
    "requiresExisting": true,
    "manufacturer": "samsung",
    "effectNote": "카메라 앱·펌웨어·사용자·국가·소리 모드 조건에 따라 실제 소리가 달라질 수 있습니다."
  },
  {
    "namespace": "system",
    "key": "camera_feedback_vibrate",
    "category": "camera",
    "title": "카메라 진동 피드백",
    "description": "삼성 카메라 조작 시 진동 피드백을 사용합니다. 카메라 앱 버전에 따라 다를 수 있습니다.",
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
    "requiresExisting": true,
    "manufacturer": "samsung"
  },
  {
    "namespace": "system",
    "key": "dialing_keypad_vibrate",
    "category": "sound",
    "title": "전화 키패드 진동",
    "description": "삼성 전화 앱에서 번호를 누를 때 진동 피드백을 사용합니다.",
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
    "requiresExisting": true,
    "manufacturer": "samsung"
  },
  {
    "namespace": "system",
    "key": "navigation_gestures_vibrate",
    "category": "sound",
    "title": "내비게이션 제스처 진동",
    "description": "홈·뒤로 등 제스처를 사용할 때 진동 피드백을 줍니다.",
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
    "requiresExisting": true,
    "manufacturer": "samsung"
  },
  {
    "namespace": "system",
    "key": "vibration_sound_enabled",
    "category": "sound",
    "title": "진동 소리 재생",
    "description": "삼성의 진동 소리 재생 옵션입니다. 지원되는 진동 패턴에서 소리를 함께 냅니다.",
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
    "requiresExisting": true,
    "manufacturer": "samsung"
  },
  {
    "namespace": "global",
    "key": "bold_text",
    "category": "display",
    "title": "굵은 글꼴",
    "description": "지원하는 시스템 화면에서 글자를 굵게 표시합니다.",
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
    "requiresExisting": true,
    "manufacturer": "samsung"
  },
  {
    "namespace": "system",
    "key": "blue_light_filter",
    "category": "display",
    "title": "편안하게 화면 보기",
    "description": "삼성의 블루라이트 필터를 켜고 끕니다. 예약 설정이 있으면 예약이 값을 다시 바꿀 수 있습니다.",
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
    "requiresExisting": true,
    "manufacturer": "samsung"
  },
  {
    "namespace": "system",
    "key": "blue_light_filter_opacity",
    "category": "display",
    "title": "화면 색온도 필터 강도",
    "description": "삼성 블루라이트 필터 강도입니다. 값이 커질수록 따뜻한 색조가 강해집니다.",
    "requiresExisting": true,
    "manufacturer": "samsung",
    "min": 0,
    "max": 10,
    "step": 1,
    "unit": "단계"
  },
  {
    "namespace": "secure",
    "key": "refresh_rate_mode",
    "category": "display",
    "title": "주사율 모드 (삼성)",
    "description": "삼성의 화면 주사율 모드입니다. 실제 주사율은 패널·앱·절전 모드에 따라 바뀝니다.",
    "options": [
      {
        "value": "0",
        "label": "표준"
      },
      {
        "value": "1",
        "label": "최적화·적응형"
      }
    ],
    "requiresExisting": true,
    "manufacturer": "samsung"
  },
  {
    "namespace": "system",
    "key": "aod_mode",
    "category": "aod",
    "title": "상시 표시 화면 (AOD)",
    "description": "잠금 상태에서도 시계 등 정보를 표시하는 삼성 AOD를 켜고 끕니다.",
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
    "requiresExisting": true,
    "manufacturer": "samsung"
  },
  {
    "namespace": "system",
    "key": "aod_tap_to_show_mode",
    "category": "aod",
    "title": "AOD 터치할 때 표시",
    "description": "항상 표시 대신 화면을 터치할 때 AOD를 표시합니다. AOD가 켜져 있어야 합니다.",
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
    "requiresExisting": true,
    "manufacturer": "samsung"
  },
  {
    "namespace": "system",
    "key": "aod_charging_mode",
    "category": "aod",
    "title": "AOD 충전 정보",
    "description": "AOD에서 충전 관련 정보를 표시합니다.",
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
    "requiresExisting": true,
    "manufacturer": "samsung"
  },
  {
    "namespace": "system",
    "key": "charging_info_always",
    "category": "aod",
    "title": "충전 정보 항상 표시",
    "description": "화면이 꺼져 있을 때 충전 상태 정보를 표시하는 삼성 옵션입니다.",
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
    "requiresExisting": true,
    "manufacturer": "samsung"
  },
  {
    "namespace": "system",
    "key": "lift_to_wake",
    "category": "gesture",
    "title": "들어서 화면 켜기",
    "description": "폰을 들어 올렸을 때 화면을 켜는 삼성 동작 설정입니다.",
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
    "requiresExisting": true,
    "manufacturer": "samsung"
  },
  {
    "namespace": "system",
    "key": "adaptive_fast_charging",
    "category": "power",
    "title": "고속 유선 충전",
    "description": "유선 고속 충전의 허용값입니다. 고속·초고속이 통합된 기종에서는 통합 설정으로 쓰며 실제 속도는 충전기·케이블·기기 상태에 따라 달라집니다.",
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
    "requiresExisting": true,
    "manufacturer": "samsung"
  },
  {
    "namespace": "system",
    "key": "super_fast_charging",
    "category": "power",
    "title": "초고속 충전 별도 설정 (지원 기기)",
    "description": "별도 초고속 제어 경로가 있는 펌웨어용 저장값입니다. 통합 제어 기종에서는 값이 저장돼도 별도 스위치로 적용되지 않을 수 있습니다.",
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
    "requiresExisting": true,
    "manufacturer": "samsung"
  },
  {
    "namespace": "system",
    "key": "wireless_fast_charging",
    "category": "power",
    "title": "고속 무선 충전",
    "description": "지원되는 삼성 기기와 충전 패드에서 고속 무선 충전을 사용합니다.",
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
    "requiresExisting": true,
    "manufacturer": "samsung"
  }
];
