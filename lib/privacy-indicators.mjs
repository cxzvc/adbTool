import {createExtensionFeatureProxy,registeredImplementation} from './extension-feature-proxy.mjs';
export const parsePrivacyConfigList=(...args)=>registeredImplementation('privacy-indicators').parsePrivacyConfigList(...args);
export const createPrivacyIndicators=args=>createExtensionFeatureProxy('privacy-indicators','createPrivacyIndicators',args);
