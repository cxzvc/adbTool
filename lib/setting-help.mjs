import { SETTINGS,settingsForDevice } from './settings-catalog.mjs';
import {getExtensionForFeature,getEnabledExtensions,subscribeExtensions} from './extensions.mjs';
import { VERIFIED_HELP } from './verified-setting-help.mjs';
import { SERVICE_HELP } from './service-setting-help.mjs';
import './device-code-help.mjs';

// Key definitions and naming clues are deliberately separate: unknown OEM keys
// must never look like verified Android APIs or gain write permission here.
const definitions = Object.fromEntries([
  ['adb_enabled','USB 디버깅','USB를 통한 ADB 디버깅 사용 여부를 저장합니다.'],
  ['adb_wifi_enabled','무선 디버깅','Wi-Fi를 통한 ADB 디버깅 사용 여부를 저장합니다.'],
  ['development_settings_enabled','개발자 옵션','개발자 옵션 메뉴의 활성화 상태입니다.'],
  ['wifi_on','Wi-Fi 사용 상태','Wi-Fi 사용 상태를 저장하는 시스템 값입니다. 현재 연결 상태나 연결된 공유기 주소 자체는 아닙니다.'],
  ['bluetooth_on','블루투스 사용 상태','블루투스 사용 상태를 저장합니다. 연결된 기기 목록과는 별개입니다.'],
  ['airplane_mode_on','비행기 모드','비행기 모드의 활성화 상태입니다.'],
  ['airplane_mode_radios','비행기 모드 적용 무선 기능','비행기 모드를 켤 때 영향을 받는 무선 기능의 목록입니다.'],
  ['airplane_mode_toggleable_radios','비행기 모드 중 사용 가능한 무선 기능','비행기 모드에서도 별도로 켤 수 있는 무선 기능의 목록입니다.'],
  ['mobile_data','모바일 데이터','이동통신 데이터 사용 설정입니다. SIM별 설정이 따로 있을 수 있습니다.'],
  ['mobile_data_always_on','모바일 데이터 연결 대기','Wi-Fi 사용 중에도 모바일 데이터 연결을 유지해 네트워크 전환에 대비하는 옵션입니다.'],
  ['data_roaming','데이터 로밍','다른 통신사 망에서 모바일 데이터 로밍을 사용할지 정합니다.'],
  ['private_dns_mode','프라이빗 DNS 모드','DNS 요청에 적용할 프라이빗 DNS 모드입니다. off는 끄기, opportunistic은 자동, hostname은 지정한 제공업체 사용입니다.'],
  ['private_dns_specifier','프라이빗 DNS 제공업체','프라이빗 DNS에 사용할 제공업체의 호스트 이름입니다. 모드가 제공업체 지정일 때 사용됩니다.'],
  ['http_proxy','HTTP 프록시','네트워크의 HTTP 프록시 주소와 포트를 저장하는 항목입니다.'],
  ['global_http_proxy_host','공통 HTTP 프록시 호스트','기기 공통 HTTP 프록시의 호스트 주소입니다.'],
  ['global_http_proxy_port','공통 HTTP 프록시 포트','기기 공통 HTTP 프록시의 포트 번호입니다.'],
  ['global_http_proxy_exclusion_list','프록시 제외 목록','프록시를 거치지 않을 호스트나 도메인 목록입니다.'],
  ['global_proxy_pac_url','프록시 자동 구성 주소','프록시 자동 구성 스크립트(PAC)의 URL입니다.'],
  ['wifi_sleep_policy','Wi-Fi 절전 정책','이전 Android의 화면 꺼짐·절전 시 Wi-Fi 유지 정책입니다. 최신 기기에서는 사용하지 않을 수 있습니다.'],
  ['wifi_networks_available_notification_on','주변 Wi-Fi 알림','사용 가능한 주변 Wi-Fi 네트워크를 알리는 옵션입니다.'],
  ['wifi_wakeup_enabled','Wi-Fi 자동 켜기','저장된 네트워크 주변에서 Wi-Fi를 다시 켜는 기능의 설정값입니다.'],
  ['network_avoid_bad_wifi','품질이 낮은 Wi-Fi 회피','인터넷 품질이 낮은 Wi-Fi를 피하고 다른 연결을 선택하는 동작과 관련된 설정입니다.'],
  ['device_name','기기 이름','주변 기기나 시스템 화면에 표시할 휴대전화 이름입니다.'],
  ['default_device_name','기본 기기 이름','제조사나 시스템이 정한 기본 휴대전화 이름입니다.'],
  ['device_provisioned','기기 초기 설정 완료','기기의 최초 설정이 완료되었는지 나타내는 시스템 상태입니다.'],
  ['user_setup_complete','사용자 초기 설정 완료','현재 Android 사용자의 초기 설정 완료 상태입니다.'],
  ['boot_count','부팅 횟수','시스템이 기록한 부팅 횟수입니다.'],
  ['android_id','Android 사용자·기기 식별자','Android가 제공하는 식별자입니다. 앱 서명·사용자·기기 등의 조건에 따라 범위가 달라질 수 있으며 화면에서는 값을 숨깁니다.'],
  ['enabled_accessibility_services','활성 접근성 서비스','사용자가 활성화한 접근성 서비스의 구성요소 목록입니다.'],
  ['accessibility_enabled','접근성 서비스 활성 상태','접근성 서비스가 활성화되어 있는지 나타내는 시스템 설정입니다.'],
  ['touch_exploration_enabled','터치 탐색','화면 읽기 등 접근성 기능이 사용하는 터치 탐색 모드입니다.'],
  ['accessibility_display_inversion_enabled','색상 반전','화면 색상을 반전하는 접근성 옵션입니다.'],
  ['accessibility_display_daltonizer_enabled','색상 보정 사용','색각 보조를 위한 화면 색상 보정 기능의 사용 여부입니다.'],
  ['accessibility_display_daltonizer','색상 보정 유형','접근성 색상 보정에 사용할 보정 유형 코드입니다.'],
  ['accessibility_display_magnification_enabled','화면 확대','접근성 화면 확대 기능의 활성화 설정입니다.'],
  ['accessibility_display_magnification_scale','화면 확대 배율','접근성 화면 확대에 적용할 배율입니다.'],
  ['accessibility_shortcut_target_service','접근성 바로가기 대상','접근성 바로가기로 실행할 서비스 또는 기능의 식별자입니다.'],
  ['accessibility_button_targets','접근성 버튼 대상','화면의 접근성 버튼으로 실행할 기능 목록입니다.'],
  ['accessibility_button_mode','접근성 버튼 표시 방식','접근성 버튼을 어떤 방식으로 표시할지 정하는 모드 값입니다.'],
  ['high_text_contrast_enabled','고대비 글자','글자와 배경을 더 쉽게 구분하도록 하는 고대비 글자 옵션입니다.'],
  ['accessibility_captioning_enabled','접근성 자막','지원되는 미디어에서 접근성 자막을 사용할지 정합니다.'],
  ['accessibility_captioning_font_scale','자막 글자 배율','접근성 자막의 글자 크기 배율입니다.'],
  ['accessibility_captioning_locale','자막 언어','접근성 자막에 우선 사용할 언어·지역 코드입니다.'],
  ['accessibility_captioning_preset','자막 표시 스타일','접근성 자막의 색상·배경 등 미리 정한 표시 스타일입니다.'],
  ['font_weight_adjustment','글꼴 굵기 보정','시스템 글꼴의 굵기에 적용하는 보정값입니다. 글자 크기 배율과는 다릅니다.'],
  ['default_input_method','기본 키보드','현재 기본으로 선택한 입력기 서비스입니다.'],
  ['enabled_input_methods','사용 가능한 입력기','사용자가 사용할 수 있도록 활성화한 키보드·입력기 목록입니다.'],
  ['selected_input_method_subtype','입력기 언어·배열 유형','선택한 입력기의 언어 또는 키보드 배열 하위 유형 식별자입니다.'],
  ['show_ime_with_hard_keyboard','물리 키보드 연결 시 화면 키보드','물리 키보드를 사용할 때 화면 키보드도 표시할지 정합니다.'],
  ['spell_checker_enabled','맞춤법 검사','시스템 맞춤법 검사 기능의 사용 여부입니다.'],
  ['selected_spell_checker','선택한 맞춤법 검사기','맞춤법 검사에 사용하는 서비스의 식별자입니다.'],
  ['selected_spell_checker_subtype','맞춤법 검사 언어 유형','선택한 맞춤법 검사기의 언어별 하위 유형 식별자입니다.'],
  ['tts_default_synth','기본 음성 합성 엔진','텍스트를 음성으로 읽을 때 사용하는 기본 TTS 엔진입니다.'],
  ['tts_default_rate','음성 읽기 속도','텍스트 음성 변환의 기본 읽기 속도 설정입니다.'],
  ['tts_default_pitch','음성 읽기 높낮이','텍스트 음성 변환의 기본 음성 높낮이 설정입니다.'],
  ['tts_default_locale','음성 읽기 언어','텍스트 음성 변환 엔진에서 사용할 기본 언어 정보입니다.'],
  ['assistant','기본 어시스턴트','기본 어시스턴트로 사용하는 앱 구성요소입니다.'],
  ['voice_interaction_service','음성 상호작용 서비스','음성 비서의 상호작용을 처리하는 시스템 서비스입니다.'],
  ['voice_recognition_service','음성 인식 서비스','음성을 텍스트나 명령으로 변환하는 기본 서비스입니다.'],
  ['autofill_service','자동완성 서비스','로그인 정보와 입력 양식 등을 자동완성하는 서비스입니다.'],
  ['enabled_notification_listeners','알림 접근 서비스','알림 내용을 읽을 수 있도록 허용한 서비스의 목록입니다.'],
  ['enabled_notification_assistant','알림 보조 서비스','알림 관리와 추천을 보조하는 서비스의 식별자입니다.'],
  ['notification_badging','앱 아이콘 알림 배지','앱 아이콘에 알림 점이나 배지를 표시하는 옵션입니다.'],
  ['heads_up_notifications_enabled','팝업 알림','화면 위에 잠깐 떠오르는 헤드업 알림의 사용 설정입니다.'],
  ['lock_screen_show_notifications','잠금 화면 알림','잠금 화면에 알림을 표시할지 정합니다.'],
  ['lock_screen_allow_private_notifications','잠금 화면 알림 내용','잠금 화면에서 알림의 비공개 내용을 보여줄지 정합니다.'],
  ['zen_mode','방해 금지 모드','시스템의 방해 금지 모드 상태입니다. 알림·전화 허용 정책은 별도 설정을 사용합니다.'],
  ['zen_duration','방해 금지 지속 시간','수동으로 켠 방해 금지 모드를 유지할 시간 또는 종료 방식 설정입니다.'],
  ['zen_mode_config_etag','방해 금지 구성 식별값','방해 금지 정책 구성이 변경되었는지 구분하기 위한 내부 식별값입니다.'],
  ['ui_night_mode','다크 모드','시스템의 밝은 화면·어두운 화면·자동 전환 모드 설정입니다.'],
  ['night_display_color_temperature','야간 조명 색온도','야간 조명에서 사용할 화면 색온도 값입니다.'],
  ['night_display_auto_mode','야간 조명 자동 전환','야간 조명을 예약이나 일출·일몰에 맞춰 전환하는 모드입니다.'],
  ['night_display_custom_start_time','야간 조명 시작 시간','사용자 지정 야간 조명 일정의 시작 시간입니다.'],
  ['night_display_custom_end_time','야간 조명 종료 시간','사용자 지정 야간 조명 일정의 종료 시간입니다.'],
  ['display_density_forced','화면 밀도 재정의','기본값 대신 사용할 화면 밀도(DPI)입니다. 글자·버튼 등 화면 요소의 크기에 영향을 줍니다.'],
  ['display_size_forced','화면 해상도 재정의','기본 화면 크기 대신 사용할 논리적 가로·세로 해상도입니다.'],
  ['screen_brightness_float','화면 밝기 소수 값','화면 밝기를 소수 범위로 저장하는 값입니다. 정수형 screen_brightness와 표현 방식이 다릅니다.'],
  ['screen_auto_brightness_adj','자동 밝기 보정','자동 밝기 결과에 적용하는 사용자 보정값입니다.'],
  ['screen_brightness_for_vr','VR 화면 밝기','VR 화면 표시에서 사용하는 밝기 설정입니다.'],
  ['navigation_mode','내비게이션 방식','시스템의 버튼 또는 제스처 내비게이션 모드입니다. 모드 번호는 제조사에 따라 다를 수 있습니다.'],
  ['user_rotation','화면 고정 방향','화면 자동 회전이 꺼졌을 때 사용할 회전 방향입니다.'],
  ['ringtone','기본 벨소리','전화 수신에 사용하는 기본 벨소리의 리소스 또는 파일 URI입니다.'],
  ['ringtone_2','두 번째 SIM 벨소리','두 번째 SIM의 전화 수신에 사용하는 벨소리 정보입니다.'],
  ['notification_sound','기본 알림음','알림에 사용하는 기본 소리의 리소스 또는 파일 URI입니다.'],
  ['alarm_alert','기본 알람음','알람에 사용하는 기본 소리의 리소스 또는 파일 URI입니다.'],
  ['mode_ringer','소리·진동·무음 모드','휴대전화의 벨소리 모드 상태입니다. 알림별 음량 설정과는 별개입니다.'],
  ['volume_music','미디어 음량','음악·동영상 등 미디어 소리의 저장된 음량 단계입니다. 출력 장치별 값이 따로 있을 수 있습니다.'],
  ['volume_ring','벨소리 음량','전화 수신 벨소리의 저장된 음량 단계입니다.'],
  ['volume_alarm','알람 음량','알람 소리의 저장된 음량 단계입니다.'],
  ['volume_notification','알림 음량','알림 소리의 저장된 음량 단계입니다.'],
  ['volume_system','시스템 음량','시스템 효과음의 저장된 음량 단계입니다.'],
  ['volume_voice','통화 음량','음성 통화에 사용하는 저장된 음량 단계입니다.'],
  ['volume_bluetooth_sco','블루투스 통화 음량','블루투스 통화 오디오 연결에서 사용하는 음량 단계입니다.'],
  ['location_mode','위치 서비스 모드','기기의 위치 서비스 사용 모드입니다. 지원하는 모드와 번호는 Android 버전에 따라 다릅니다.'],
  ['location_providers_allowed','허용된 위치 제공자','이전 Android의 GPS·네트워크 위치 제공자 목록입니다. 현재 기기에서는 내부 호환 정보일 수 있습니다.'],
  ['backup_enabled','시스템 백업 사용','Android의 시스템 백업 서비스 사용 여부입니다.'],
  ['backup_auto_restore','앱 데이터 자동 복원','앱을 다시 설치할 때 백업된 데이터의 자동 복원을 사용할지 정합니다.'],
  ['backup_transport','백업 전송 서비스','시스템 백업 데이터의 저장·전송을 담당하는 서비스입니다.'],
  ['install_non_market_apps','외부 출처 앱 설치 (이전 설정)','이전 Android의 외부 출처 앱 설치 허용 설정입니다. 최근 버전의 앱별 설치 권한과는 다릅니다.'],
  ['package_verifier_enable','앱 설치 검증','앱 설치 과정에서 검증 서비스를 사용할지 정하는 시스템 설정입니다.'],
  ['verifier_verify_adb_installs','ADB 설치 앱 검증','ADB로 설치하는 앱에도 설치 검증을 적용하는 옵션입니다.'],
  ['debug_app','디버깅 대상 앱','개발자 옵션에서 지정한 디버깅 대상 앱의 패키지명입니다.'],
  ['wait_for_debugger','디버거 연결 대기','지정된 디버깅 앱을 실행할 때 디버거 연결을 기다릴지 정합니다.'],
  ['always_finish_activities','활동 유지 안 함','사용자가 떠난 앱 활동을 즉시 종료하는 개발자 옵션입니다.'],
  ['force_resizable_activities','앱 크기 조절 강제','지원하지 않는 앱에도 창 크기 조절을 허용하려는 개발자 옵션입니다. 실제 호환성은 앱마다 다릅니다.'],
  ['force_desktop_mode_on_external_displays','외부 화면 데스크톱 모드 강제','외부 디스플레이에서 데스크톱 모드를 시도하는 개발자 옵션입니다.'],
  ['animator_duration_scale','앱 내부 애니메이션 배율','앱 내부 속성 애니메이션의 재생 시간 배율입니다.'],
  ['transition_animation_scale','화면 전환 애니메이션 배율','화면 간 전환 효과의 재생 시간 배율입니다.'],
  ['window_animation_scale','창 애니메이션 배율','창과 팝업 효과의 재생 시간 배율입니다.'],
  ['show_notification_channel_warnings','알림 채널 경고','알림 채널 사용 문제를 개발자에게 경고하는 옵션입니다.'],
  ['sysui_demo_allowed','시스템 UI 데모 허용','상태 표시줄 등의 데모 모드 사용 허용 여부입니다.'],
  ['sysui_tuner_demo_on','시스템 UI 데모 상태','시스템 UI 데모 모드의 현재 상태입니다.'],
  ['power_button_long_press','전원 버튼 길게 누르기 동작','전원 버튼을 길게 눌렀을 때 실행할 시스템 동작의 코드입니다.'],
  ['low_power_trigger_level','자동 절전 배터리 기준','배터리 잔량에 따라 자동 절전을 시작할 때 사용하는 기준값입니다.'],
  ['low_power_sticky','절전 모드 유지 기록','재시작이나 충전 상태 변화 뒤 절전 모드 복원에 사용하는 상태 기록입니다.'],
  ['cached_apps_freezer','캐시 앱 일시 정지','캐시 상태 앱의 실행을 일시 정지하는 시스템 최적화 기능의 설정입니다.'],
  ['app_standby_enabled','앱 대기 최적화','자주 사용하지 않는 앱의 백그라운드 활동을 제한하는 앱 대기 기능의 설정입니다.'],
].map(([key, title, description]) => [key, { title, description }]));

const phrases = {
  one_handed:'한 손 조작', power_mode:'전원 모드', power_saving:'절전', low_power:'절전', dark_mode:'다크 모드', dark_theme:'어두운 테마',
  blue_light_filter:'화면 색온도 필터', navigation_bar:'내비게이션 바', lock_screen:'잠금 화면', screen_off:'화면 꺼짐', screen_on:'화면 켜짐',
  air_cmd:'S펜 에어 커맨드', air_command:'S펜 에어 커맨드', quick_share:'퀵 셰어', quick_setting:'빠른 설정', quick_settings:'빠른 설정',
  secure_folder:'보안 폴더', smart_view:'스마트 뷰', smart_reply:'답장 추천', smart_replies:'답장 추천', call_recording:'통화 녹음',
  call_transcript:'통화 문자 변환', translate_during_calls:'통화 중 번역', speech_to_text:'음성 문자 변환', text_to_speech:'텍스트 음성 변환',
  last_checked:'마지막 확인', first_launch:'최초 실행', long_press:'길게 누르기', double_press:'두 번 누르기', double_tap:'두 번 터치',
  app_shortcuts:'앱 단축키', tap_to_show:'터치 시 표시', always_on:'항상 표시', user_setup:'사용자 초기 설정',
  notification_listener:'알림 접근 서비스', factory_reset:'공장 초기화', battery_protection:'배터리 보호', fast_charging:'고속 충전',
  preferred_network_mode:'선호 네트워크 모드', mobile_data:'모바일 데이터', multi_sim:'다중 SIM', noise_reduction:'소음 감소',
  wifi:'Wi-Fi', bluetooth:'블루투스', aod:'AOD', dex:'DeX', bixby:'빅스비', knox:'Knox', fota:'펌웨어 업데이트',
  smartswitch:'스마트 스위치', scloud:'삼성 클라우드', quickstar:'퀵스타', doze:'대기·절전', lockscreen:'잠금 화면', navigationbar:'내비게이션 바',
};
const words = Object.fromEntries(Object.entries({
  enabled:'사용', enable:'활성화', disabled:'비활성화', disable:'비활성화', on:'켜짐', off:'꺼짐', mode:'모드', state:'상태', status:'상태',
  screen:'화면', display:'디스플레이', brightness:'밝기', color:'색상', colour:'색상', opacity:'불투명도', transparency:'투명도', density:'밀도',
  wallpaper:'배경화면', theme:'테마', icon:'아이콘', icons:'아이콘', size:'크기', width:'너비', height:'높이', scale:'배율', font:'글꼴',
  audio:'오디오', sound:'소리', sounds:'소리', volume:'음량', vibration:'진동', vibrate:'진동', vib:'진동', magnitude:'세기', intensity:'강도',
  ringtone:'벨소리', alarm:'알람', alert:'알림', notification:'알림', notifications:'알림', noti:'알림', ring:'벨소리', music:'음악', media:'미디어',
  call:'통화', calls:'통화', caller:'발신자', dialer:'전화 앱', dialing:'번호 입력', dialpad:'전화 키패드', keypad:'키패드', tone:'효과음',
  camera:'카메라', shutter:'셔터', flash:'플래시', flashlight:'손전등', video:'동영상', photo:'사진', image:'이미지', capture:'캡처', screenshot:'스크린샷', screenshots:'스크린샷',
  battery:'배터리', charging:'충전', charger:'충전기', charge:'충전', power:'전원', performance:'성능', cpu:'CPU', gpu:'GPU', memory:'메모리', ram:'RAM', thermal:'온도', heat:'발열',
  keyboard:'키보드', key:'키', keys:'키', touch:'터치', tapping:'탭 동작', tap:'터치', pen:'펜', spen:'S펜', stylus:'스타일러스', pointer:'포인터', touchpad:'터치패드',
  gesture:'제스처', gestures:'제스처', swipe:'스와이프', scroll:'스크롤', scrolling:'스크롤', rotation:'회전', orientation:'방향', portrait:'세로', landscape:'가로',
  navigation:'내비게이션', button:'버튼', edge:'엣지', lighting:'조명', panel:'패널', bar:'바', handle:'핸들', corner:'모서리',
  network:'네트워크', internet:'인터넷', mobile:'모바일', cellular:'이동통신', data:'데이터', roaming:'로밍', scan:'검색', scanning:'검색', connection:'연결', connected:'연결됨',
  connect:'연결', disconnect:'연결 해제', wireless:'무선', wired:'유선', tether:'테더링', tethering:'테더링', hotspot:'핫스팟', sim:'SIM', esim:'eSIM', slot:'슬롯',
  nfc:'NFC', uwb:'UWB', ble:'저전력 블루투스', gps:'GPS', gnss:'위성 위치', location:'위치', address:'주소', mac:'MAC', dns:'DNS', proxy:'프록시', vpn:'VPN',
  auto:'자동', automatic:'자동', adaptive:'적응형', smart:'스마트', intelligent:'지능형', dynamic:'동적', default:'기본', custom:'사용자 지정', preferred:'선호',
  current:'현재', previous:'이전', prev:'이전', last:'마지막', first:'최초', before:'이전', after:'이후', time:'시간', date:'날짜', timeout:'대기 시간', interval:'주기',
  duration:'지속 시간', delay:'지연', start:'시작', end:'종료', finish:'종료', started:'시작됨', stopped:'중지됨', minute:'분', min:'최소', max:'최대', count:'횟수', cnt:'횟수',
  limit:'제한', threshold:'기준값', level:'단계', rate:'속도', ratio:'비율', percent:'비율', percentage:'퍼센트', ms:'밀리초', millis:'밀리초', seconds:'초',
  settings:'설정', setting:'설정', config:'구성', configuration:'구성', constants:'동작 매개변수', parameters:'매개변수', param:'매개변수', value:'값', values:'값',
  list:'목록', allowlist:'허용 목록', whitelist:'허용 목록', blocklist:'차단 목록', blacklist:'차단 목록', denylist:'차단 목록', selected:'선택된', selection:'선택',
  target:'대상', targets:'대상', service:'서비스', services:'서비스', package:'패키지', packages:'패키지', app:'앱', apps:'앱', application:'앱', activity:'활동',
  enableds:'활성 목록', supported:'지원 여부', support:'지원', available:'사용 가능 여부', availability:'사용 가능 여부', visible:'표시 여부', visibility:'표시 범위',
  show:'표시', hide:'숨김', shown:'표시 이력', hidden:'숨김', use:'사용', used:'사용 이력', using:'사용 중', unused:'미사용', allow:'허용', allowed:'허용',
  block:'차단', blocked:'차단됨', prevent:'방지', force:'강제', forced:'강제', only:'전용', always:'항상', never:'사용 안 함', all:'전체',
  backup:'백업', restore:'복원', restored:'복원됨', migration:'이전', migrate:'이전', migrated:'이전됨', update:'업데이트', updated:'갱신됨', version:'버전',
  registration:'등록', registered:'등록됨', polling:'확인 주기', client:'클라이언트', server:'서버', sync:'동기화', synced:'동기화됨', download:'다운로드', upload:'업로드',
  accessibility:'접근성', caption:'자막', captions:'자막', captioning:'자막', hearing:'청각 보조', assistant:'어시스턴트', voice:'음성', speech:'음성',
  recognition:'인식', detection:'감지', detected:'감지됨', sensitivity:'민감도', feedback:'피드백', input:'입력', output:'출력', interaction:'상호작용',
  security:'보안', secure:'보안', privacy:'개인정보 보호', protection:'보호', protect:'보호', policy:'정책', policies:'정책', permission:'권한', permissions:'권한',
  password:'비밀번호', auth:'인증', authentication:'인증', biometric:'생체인증', fingerprint:'지문', face:'얼굴', lock:'잠금', unlock:'잠금 해제', trusted:'신뢰',
  device:'기기', user:'사용자', system:'시스템', framework:'프레임워크', internal:'내부', global:'공통', local:'로컬', remote:'원격', external:'외부',
  manager:'관리자', controller:'제어기', control:'제어', debug:'디버깅', debugger:'디버거', test:'시험', logging:'기록', log:'로그', stats:'통계', dump:'덤프',
  error:'오류', failure:'실패', failed:'실패', reason:'사유', retry:'재시도', reset:'초기화', clear:'비우기', remove:'제거', delete:'삭제', cleanup:'정리',
  initialization:'초기화', init:'초기', setup:'초기 설정', boot:'부팅', complete:'완료', completed:'완료', pending:'대기 중', running:'실행 중', ready:'준비',
  popup:'팝업', dialog:'대화상자', tip:'도움말', help:'도움말', notice:'안내', warning:'경고', badge:'배지', reminder:'리마인더', recommended:'추천', recommendation:'추천',
  text:'텍스트', language:'언어', locale:'언어·지역', region:'지역', country:'국가', carrier:'통신사', operator:'통신사', contact:'연락처', contacts:'연락처',
  message:'메시지', messages:'메시지', sms:'SMS', mms:'MMS', email:'이메일', account:'계정', name:'이름', number:'번호', id:'식별자', ids:'식별자', uuid:'식별자',
  uri:'URI', url:'URL', path:'경로', directory:'폴더', file:'파일', content:'콘텐츠', format:'형식', type:'유형', flags:'플래그', flag:'플래그', mask:'마스크',
  position:'위치', order:'순서', sort:'정렬', group:'그룹', option:'옵션', options:'옵션', choice:'선택', method:'방식', function:'기능', feature:'기능', features:'기능',
  notificationbar:'알림 바', statusbar:'상태 표시줄', status_bar:'상태 표시줄', quick:'빠른', shortcut:'바로가기', shortcuts:'바로가기', command:'명령',
  samsung:'삼성', sem:'삼성 확장', psm:'절전 모드', pms:'전원 관리', google:'Google', gms:'Google 서비스', omc:'지역·통신사 구성', csc:'지역·통신사 설정',
  ftu:'최초 사용 안내', oobe:'초기 사용 설정', suwoobe:'초기 사용 설정', suw:'초기 설정 마법사', animation:'애니메이션', animations:'애니메이션',
  reduce:'축소', reduced:'축소', increase:'증가', decrease:'감소', dim:'어둡게', dimming:'밝기 감소', blur:'흐림 효과', contrast:'대비', balance:'균형',
  enabled_by_policy:'정책에 의한 활성화', state_power:'전원 상태', daytime:'주간', night:'야간', sleep:'수면', wake:'깨우기', wakeup:'깨우기', idle:'유휴',
  charginginfo:'충전 정보', bluetoothsco:'블루투스 통화', earbuds:'이어버드', buds:'갤럭시 버즈', headphone:'헤드폰', headphones:'헤드폰', headset:'헤드셋',
  speaker:'스피커', microphone:'마이크', mic:'마이크', sensor:'센서', sensors:'센서', wearable:'웨어러블', wear:'웨어러블', watch:'워치', clock:'시계',
  refresh:'갱신', refresh_rate:'주사율', frame:'프레임', fps:'프레임률', hdr:'HDR', resolution:'해상도', brightness_mode:'밝기 모드',
}));

Object.assign(phrases, { white_list:'허용 목록', black_list:'차단 목록', master_mono:'모노 오디오', next_alarm:'다음 알람', unknown_sources:'알 수 없는 출처', mass_storage:'대용량 저장장치', job_scheduler:'작업 스케줄러', trust_agents:'신뢰 에이전트', bounce_keys:'반복 키 입력 방지', slow_keys:'느린 키 입력', game_launcher:'게임 런처', phone_play_store:'휴대전화 Play 스토어', freeform:'팝업 창', autohotspot:'자동 핫스팟', quickshare:'퀵 셰어', samsungflow:'삼성 플로우', relumino:'릴루미노', multistar:'멀티스타', fmm:'내 디바이스 찾기', cmc:'다른 기기 전화·문자 연동' });
Object.assign(words, { info:'정보', add:'추가', today:'오늘', schedule:'일정', ai:'AI', confirmed:'확인됨', air:'에어 기능', motion:'동작 감지', engine:'엔진', anykey:'아무 키', bridge:'연계', summary:'요약', characterset:'문자 집합', code:'코드', retention:'보관', day:'일', doorbell:'초인종', detector:'감지기', ear:'청각', shock:'충격', condition:'조건', easy:'쉬운 사용', switch:'전환', eth:'유선 네트워크', ethernet:'유선 네트워크', conn:'연결', game:'게임', games:'게임', interruption:'방해', effect:'효과', monitoring:'모니터링', aid:'보조', diagnosis:'진단', direction:'방향', revision:'보정', master:'전체', continuity:'기기 간 연속 사용', mydevice:'내 기기', activated:'활성화됨', activation:'활성화', denied:'거부됨', downloadable:'다운로드 가능', minder:'알림', ringer:'벨소리', streams:'오디오 스트림', affected:'적용 대상', merged:'통합', mute:'음소거', pause:'일시정지', overturn:'뒤집기', pick:'들기', up:'올리기', multi:'다중', focus:'초점', naver:'네이버', sports:'스포츠', need:'필요', dark:'어두운', formatted:'표시 형식', pass:'통과', through:'통과', phone:'휴대전화', reject:'거절', speed:'속도', preload:'사전 설치', install:'설치', history:'이력', proximity:'근접', recovery:'복구', action:'동작', radio:'무선 통신', eula:'이용 약관', agree:'동의', pp:'개인정보 처리방침', sec:'삼성 내부', select:'선택', send:'보내기', page:'페이지', gravity:'정렬 기준', change:'변경', split:'분할', view:'보기', nowbar:'나우 바', locales:'언어·지역 목록', tips:'도움말', trigger:'실행 조건', visualizer:'시각화', tty:'문자 전화', amp:'앰프', unknown:'미확인', voip:'인터넷 전화', translator:'번역기', restriction:'제한', bg:'백그라운드', anr:'앱 응답 없음', background:'백그라운드', assist:'어시스턴트', disclosure:'사용 알림', autofill:'자동완성', field:'입력란', classification:'분류', family:'가족', sharing:'공유', nearby:'주변', saved:'저장된', aware:'주변 인식', bonded:'페어링된', clientside:'클라이언트 측', period:'기간', advanced:'고급', run:'실행', blind:'색각 보정', countdown:'카운트다운', credential:'자격 증명', primary:'기본', direct:'직접', writing:'필기', toolbar:'도구 모음', community:'공동', finding:'찾기', main:'주요', offline:'오프라인', find:'찾기', tag:'태그', enhanced:'향상된', tracking:'추적', home:'홈', fast:'빠른', response:'응답', read:'읽음', tnc:'이용 조건', gamesdk:'게임 SDK', gemini:'Gemini', space:'공간', score:'점수', high:'높음', priority:'우선순위', immersive:'전체화면', confirmations:'확인 기록', toggle:'전환', plugin:'플러그인', known:'알려진', initialized:'초기화됨', manual:'수동', consents:'동의 항목', mount:'저장장치 연결', play:'재생', snd:'소리', autostart:'자동 시작', notify:'알림', prompt:'확인 요청', repository:'저장소', json:'JSON', digits:'자릿수', pin:'PIN', component:'구성요소', num:'개수', suggestions:'제안', accepted:'수락됨', onpremise:'자체 운영 환경', eligibility:'적용 대상 여부', pubkey:'공개 키', qs:'빠른 설정', tiles:'타일', grid:'격자', restart:'재시작', connectivity:'연결 기능', snoozed:'일시 미룬', provider:'제공자', ssl:'TLS 연결', session:'세션', cache:'캐시', hold:'길게 누르기', search:'검색', reversed:'반전됨', store:'스토어', demo:'데모', ambient:'대기 화면', docked:'거치됨', dock:'거치대', low:'낮음', bit:'비트', dev:'개발용', tilt:'기울이기', bright:'밝게', anomaly:'이상 징후', enhancement:'개선', autorun:'자동 실행', bug:'오류', report:'보고', burn:'잔상', set:'설정', cert:'인증서', metadata:'메타데이터', check:'확인', private:'비공개', ip:'IP', roundness:'둥근 정도', database:'데이터베이스', creation:'생성', buildid:'빌드 식별자', safety:'보호', emergency:'긴급', euicc:'eSIM', downloading:'다운로드 중', countries:'국가 목록', unsupported:'미지원', header:'제목 표시줄', has:'보유 여부', pay:'결제', tokens:'토큰', lid:'덮개', behavior:'동작', chg:'변경', capability:'지원 기능', capabilities:'지원 기능', obtain:'가져오기', body:'착용 상태', places:'장소', retail:'매장 시연', side:'측면', sqlite:'SQLite', compatibility:'호환성', subscription:'가입 회선', suggestion:'제안', responses:'응답', usb:'USB', quality:'품질', bearer:'통신 경로', transport:'전송 방식' });
Object.assign(words, { context:'상황', fence:'조건', not:'비활성', working:'동작', edgeclock:'엣지 시계', pos:'위치', forceinstall:'강제 설치', keyguard:'잠금 화면', slice:'요약 정보', payment:'결제', foreground:'전면 실행', guard:'보호', international:'국제', handled:'처리됨', chip:'칩', maxclient:'최대 연결 기기', customer:'고객', provision:'초기 구성', success:'성공', routine:'루틴', instances:'인스턴스', safe:'보안', broadcast:'방송', ap:'핫스팟', tile:'타일', clicked:'클릭됨' });
Object.assign(phrases, { switch_to_better_wifi:'더 좋은 Wi-Fi로 전환', switch_to_mobile_data:'모바일 데이터로 전환', on_screen:'화면 켜짐 상태', out_of_focus:'포커스 벗어남', not_working:'동작하지 않음', doublepress:'두 번 누르기', longpress:'길게 누르기' });
Object.assign(words, { to:'대상', in:'내부', for:'대상', is:'여부', by:'기준', when:'조건', with:'포함', and:'및', of:'관련', do:'수행', bt:'블루투스', menu:'메뉴', sysui:'시스템 UI', sco:'통화 오디오', roam:'로밍', dp:'논리 픽셀', active:'활성', task:'작업', cover:'커버 화면', changer:'변경기', android:'Android', earpiece:'수화부', access:'접근', index:'인덱스', preview:'미리보기', hovering:'펜 접근 감지', back:'뒤로', ui:'UI', pref:'선호 설정', temperature:'온도', turn:'전환', floating:'떠 있는 창', lte:'LTE', window:'창', profile:'프로필', constant:'상수', intent:'실행 요청', widget:'위젯', out:'외부', record:'기록', magnification:'확대', mhs:'모바일 핫스팟', displayed:'표시됨', snapshot:'스냅샷', screensaver:'화면 보호기', clockwork:'웨어러블 시계', detachment:'분리', scheduled:'예약됨', rampart:'Rampart', mcf:'MCF', ebs:'EBS', sip:'SIP', dc:'DC' });

const families = [
  [/fmm_/, '내 디바이스 찾기'], [/cmc_/, '다른 기기 전화·문자 연동'], [/autohotspot|nearby_sharing|quickshare/, '주변 기기 공유'],
  [/game|gamesdk|gemini/, '게임·서비스 기능'], [/ear_|hearing|relumino|bounce_keys|slow_keys|easy_/, '접근성·감각 보조'],
  [/aod|always_on_display/, 'AOD·잠금 화면 표시'], [/blue_light|night_display|color_temperature/, '화면 색온도·야간 조명'],
  [/accessibility|dalton|magnification|captioning/, '접근성 보조 기능'], [/csc_pref_camera|camera|shutter/, '카메라'],
  [/navigation|gesture|one_handed|any_screen/, '내비게이션·화면 제스처'], [/air_cmd|air_command|spen|stylus|pen_/, 'S펜·스타일러스'],
  [/(?:^|[_.:-])dex(?:$|[_.:-])|dexonpc|desktop|external_display/, 'DeX·외부 화면'], [/wifi|wlan|dhcp/, 'Wi-Fi 연결·검색'], [/bluetooth|ble_|buds/, '블루투스·주변 기기'],
  [/nfc|uwb/, '근거리 무선 기능'], [/telephon|mobile|cell_|sim|roam|network_mode/, '이동통신·SIM'], [/location|gps|gnss/, '위치 서비스'],
  [/private_dns|proxy|network|tether/, '네트워크'], [/vibrat|haptic|vib_/, '진동·촉각 피드백'], [/volume|audio|sound|ringtone|music/, '소리·음량'],
  [/call|dial|caller/, '전화·통화'], [/notification|noti_|zen_|badge/, '알림'], [/keyboard|input_method|ime_|keypad|spell/, '키보드·입력기'],
  [/tts_|speech|voice|assistant|bixby/, '음성·어시스턴트'], [/charging|battery|power|psm|pms|ltc_/, '전원·충전·절전'],
  [/display|screen|wallpaper|brightness|colortheme|font|edge_|lighting|theme/, '화면·표시'], [/animation|animator/, '애니메이션'],
  [/fingerprint|biometric|face_|lock|password|keyguard/, '잠금·인증'], [/knox|rampart|security|privacy|policy|mdm/, '기기 보안·관리'],
  [/backup|restore|scloud|smartswitch/, '백업·기기 이전'], [/fota|software_update|ota_|firmware/, '소프트웨어 업데이트'],
  [/app_|apps_|package|activity|process|cached/, '앱·프로세스 관리'], [/contact|phonebook/, '연락처'], [/sms|message|mms/, '메시지'],
  [/quickstar|systemui|sysui|status_bar/, '시스템 UI'], [/setup|provision|oobe|suw/, '초기 설정'], [/time|clock|date/, '시간·시계'],
  [/debug|log|stats|dump|test/, '진단·개발자 기능'], [/memory|ram|zram|cpu|gpu|performance/, '성능·메모리'],
];

const phraseRules = Object.entries(phrases).sort((a,b) => b[0].length - a[0].length).map(([phrase, text]) => [new RegExp(`(^|[_.:-])${phrase}(?=$|[_.:-])`, 'g'), text]);
function translateKey(key) {
  let source = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  const protectedWords = [];
  for (const [pattern, translated] of phraseRules) {
    source = source.replace(pattern, (_, boundary) => { protectedWords.push(translated); return `${boundary}§${protectedWords.length - 1}§`; });
  }
  let translatedCount = 0;
  const parts = source.split(/[_.:-]+/).filter(Boolean).map(part => {
    const protectedIndex = /^§(\d+)§$/.exec(part);
    if (protectedIndex) { translatedCount++; return protectedWords[Number(protectedIndex[1])]; }
    if (words[part]) { translatedCount++; return words[part]; }
    const numbered = /^([a-z]+)(\d+)$/.exec(part);
    if (numbered && words[numbered[1]]) { translatedCount++; return `${words[numbered[1]]} ${numbered[2]}`; }
    return part;
  });
  return { text: parts.join(' '), translatedCount };
}

function roleOf(key) {
  if (/backup|previous|prev_|_before_|restored/.test(key)) return '이전 값 또는 복원용 상태를 보관하는 항목으로 보입니다.';
  if (/version|buildid|_etag$/.test(key)) return '기능이나 구성 데이터의 버전을 구분하는 값으로 보입니다.';
  if (/(?:count|cnt)$|_count_|_cnt_/.test(key)) return '사용·처리 횟수를 기록하는 값으로 보입니다. 단순 켜기·끄기 값으로 해석하지 않습니다.';
  if (/timeout|interval|delay|duration/.test(key)) return '대기 시간·실행 간격·지속 시간을 조절하거나 기록하는 값으로 보입니다.';
  if (/timestamp|_date$|_time$/.test(key)) return '실행 시각 또는 예약 시간을 기록하는 값으로 보입니다. 기준 시각과 저장 단위는 미확인입니다.';
  if (/whitelist|allowlist|blacklist|blocklist|denylist|_list$|_packages$|_targets$/.test(key)) return '기능이 적용될 대상이나 허용·차단 대상을 나열한 목록으로 보입니다.';
  if (/_flags?$|_mask$/.test(key)) return '여러 상태나 옵션을 묶은 플래그 값으로 보입니다. 숫자를 단순 켜기·끄기로 해석하지 않습니다.';
  if (/_path$|_uri$|_url$/.test(key)) return '기능이 사용할 파일·리소스·네트워크 주소를 가리키는 값으로 보입니다.';
  if (/state|status|reason|failed|error/.test(key)) return '현재 상태나 처리 결과를 기록하는 내부 값으로 보입니다.';
  if (/supported|support|available|capabilit/.test(key)) return '기기가 해당 기능을 지원하는지 나타내는 내부 정보로 보입니다.';
  if (/enabled|enable|disabled|disable|_on$|_off$/.test(key)) return '기능의 사용 여부 또는 적용 상태를 나타내는 값으로 보입니다.';
  if (/color|opacity|transparency|brightness|size|width|height|scale/.test(key)) return '표시 모양·크기·색상·강도를 지정하는 값으로 보입니다.';
  if (/constants|parameters|config/.test(key)) return '여러 동작 조건이나 구성 매개변수를 저장하는 값으로 보입니다.';
  return '해당 기능의 동작 옵션이나 내부 상태를 저장하는 값으로 보입니다.';
}

function describeSetting(key, namespace, context) {
  const extension=context?getExtensionForFeature('device-code-help',context):getEnabledExtensions().find(row=>row.codeHelp);
  const catalog = (context?settingsForDevice(context):SETTINGS).find(item => item.key === key && item.namespace === namespace);
  if (catalog) return { title: catalog.title, description: catalog.description, descriptionLevel: 'described', descriptionLabel: '한글 설명', valueGuide: catalog.options ? catalog.options.map(option => `${option.value}: ${option.label}`).join(' · ') : `${catalog.min}~${catalog.max}${catalog.unit ? ` ${catalog.unit}` : ''}`, editable: true, category: catalog.category };
  const verified = VERIFIED_HELP[`${namespace}:${key}`] || SERVICE_HELP[`${namespace}:${key}`];
  if (verified) return { ...verified, descriptionLevel: 'verified', descriptionLabel: '공식 소스 확인', editable: false, category: null };
  if (extension?.codeHelp?.entries[`${namespace}:${key}`]) return extension.codeHelp.entries[`${namespace}:${key}`];
  const known = definitions[key]||extension?.definitions?.[key];
  if (known) return { ...known, descriptionLevel: 'described', descriptionLabel: '한글 설명', valueGuide: '', editable: false, category: null };
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  const translated = translateKey(key);
  const family = families.find(([pattern]) => pattern.test(normalized))?.[1];
  const understood = translated.translatedCount >= 2 || !!family;
  const title = /[가-힣]/.test(translated.text) ? translated.text : family ? `${family} · ${translated.text}` : `내부 설정 · ${key}`;
  const unit = /(?:_ms|_millis|_milliseconds)$/.test(normalized) ? ' 키 이름의 단위 표기는 밀리초(ms)입니다.' : /_seconds$/.test(normalized) ? ' 키 이름의 단위 표기는 초입니다.' : '';
  return {
    title, description: understood ? `이름 기준으로 ${family ? `${family}의 ` : ''}‘${translated.text}’ 관련 항목입니다. ${roleOf(normalized)}${unit}` : `${namespace.toUpperCase()} 영역에 등록된 제조사·앱 내부 항목입니다. ‘${key}’의 정확한 기능과 값 의미는 확인되지 않았습니다.`,
    descriptionLevel: understood ? 'inferred' : 'internal', descriptionLabel: understood ? '이름 기반 추정' : '내부 키 · 미확인', valueGuide: understood ? '정확한 값 형식과 효과는 제조사·앱 구현 확인이 필요합니다.' : '값의 의미 미확인', editable: false, category: null,
  };
}
const helpCache = new Map();
subscribeExtensions(()=>helpCache.clear());
export function settingHelp(key,namespace,context){
 const extension=context?getExtensionForFeature('device-code-help',context):getEnabledExtensions().find(row=>row.codeHelp);
 const cacheKey=JSON.stringify([namespace,key,context?.fingerprint||context?.manufacturer||'',extension?.id||'']);
 if(!helpCache.has(cacheKey)){
  if(helpCache.size>=4096)helpCache.delete(helpCache.keys().next().value);
  helpCache.set(cacheKey,Object.freeze({...describeSetting(key,namespace,context),...(extension?.codeHelp?.notes[namespace+':'+key]||{})}));
 }
 return helpCache.get(cacheKey);
}
