import {createExtensionFeatureProxy,registeredImplementation} from './extension-feature-proxy.mjs';
export const GPS_PERMISSION='android.permission.ACCESS_FINE_LOCATION';
export const GPS_SENSITIVE_BIT=0x100;
export const parseGpsFlags=(...args)=>registeredImplementation('gps-indicator').parseGpsFlags(...args);
export const createGpsIndicatorStore=(...args)=>registeredImplementation('gps-indicator').createGpsIndicatorStore(...args);
export const createGpsIndicator=args=>createExtensionFeatureProxy('gps-indicator','createGpsIndicator',args);
