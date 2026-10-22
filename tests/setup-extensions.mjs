import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {configureExtensions} from '../lib/extensions.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
// Test-only opt-in. Production defaults are configured separately and remain core-only.
if(process.env.ADB_DESK_TEST_CORE_ONLY!=='1'&&existsSync(new URL('../extensions/samsung/index.mjs',import.meta.url)))await configureExtensions({root,enabled:['samsung']});
