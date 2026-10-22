import {registeredImplementation} from './extension-feature-proxy.mjs';
export const createGpsIndicatorRuntime=(...args)=>registeredImplementation('gps-indicator').createGpsIndicatorRuntime(...args);
