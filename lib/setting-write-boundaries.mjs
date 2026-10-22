// Minimal retained write boundaries, not executable manufacturer features or
// firmware evidence. Removing an optional extension must not erase a restriction
// already established for that manufacturer. No build, device ID or raw dump is
// needed to keep this boundary; an exact, explicitly revalidated profile may lift it.
const samsung=[
 ['secure','night_display_activated','inactive-path','system:blue_light_filter'],
 ['secure','night_display_auto_mode','unsupported','system:blue_light_filter'],
 ['secure','night_display_color_temperature','unsupported','system:blue_light_filter'],
 ['secure','night_display_custom_start_time','unsupported','system:blue_light_filter'],
 ['secure','night_display_custom_end_time','unsupported','system:blue_light_filter'],
 ['secure','night_display_last_activated_time','unsupported','system:blue_light_filter'],
 ['secure','double_tap_to_wake','inactive-path','system:double_tab_to_wake_up'],
 ['system','aod_charging_mode','managed-state','system:charging_info_always'],
 ['system','super_fast_charging','inactive-path','system:adaptive_fast_charging'],
];
export const SETTING_WRITE_BOUNDARIES=Object.freeze(samsung.map(([namespace,key,kind,alternative])=>Object.freeze({manufacturer:'samsung',namespace,key,kind,alternative})));
export function settingManufacturer(context){
 if(!context)return '';
 if(typeof context==='string')return context.includes('/')?context.split('/')[0].trim().toLowerCase():'';
 return String(context?.manufacturer||settingManufacturer(context?.fingerprint)||'').trim().toLowerCase();
}
export function retainedSettingBoundary(namespace,key,context){
 const manufacturer=settingManufacturer(context);
 return SETTING_WRITE_BOUNDARIES.find(row=>row.namespace===namespace&&row.key===key&&row.manufacturer===manufacturer)||null;
}
export function retainedSettingNeedsReview(namespace,key,context){
 const manufacturer=settingManufacturer(context);
 return SETTING_WRITE_BOUNDARIES.some(row=>row.namespace===namespace&&row.key===key&&(!manufacturer||row.manufacturer===manufacturer));
}
