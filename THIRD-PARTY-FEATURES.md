# Additional feature sources

- Tracker signatures: App Manager, GPL-3.0-or-later. Dataset derived from https://github.com/MuntashirAkon/AppManager/blob/master/app/src/main/res/values/trackers.xml . Attribution and source are embedded in data/tracker-signatures.json. The dataset retains GPL-3.0-or-later terms. License: https://www.gnu.org/licenses/gpl-3.0.html .
- Perfetto Trace Processor v58.2: official Windows binary, Apache-2.0. Source https://github.com/google/perfetto . Download provenance and SHA-256 are in vendor/perfetto/provenance.json.
- PCAPdroid: external Android application, GPL-3.0. Integration uses its documented public Intent API. No application installation, VPN consent, or capture is performed automatically. https://github.com/emanuele-f/PCAPdroid/blob/master/docs/app_api.md .
- scrcpy: existing bundled screen service, Apache-2.0. Independent virtual displays reuse the existing service protocol. https://github.com/Genymobile/scrcpy .
