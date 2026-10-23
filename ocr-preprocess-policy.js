// 0.4.2 candidate: frozen development rule. OFF after independent quality vetoes.
// Only an empty prepared result may retry the original crop once.
export const OCR_PREPROCESS_POLICY=Object.freeze({
  "version": "ocr-preparation-v2-20261010",
  "enabled": false,
  "modelVersion": "eng-manga-20261002-yeni-veri",
  "polarityProfile": {
    "difference": 32,
    "dominance": 0.8
  },
  "guard": "d32-r80",
  "routes": {
    "dark": {
      "recipe": "invert-p10-t0",
      "retryOriginal": true
    },
    "color": {
      "recipe": "channel-p10-t2",
      "retryOriginal": true
    }
  },
  "acceptance": {
    "status": "failed_quality_and_open_native_speed",
    "speedMaxMedianIncreasePercent": 7,
    "nativeExtensionIpcRequired": true,
    "defaultEnabled": false,
    "qualityFailures": [
      "yeah_diagnostic",
      "independent_group_20_percent_and_ci",
      "balloon_compatibility_regression",
      "covered_word_error_regression"
    ],
    "coverageLimitation": "26 strictly dark fields plus 4 light-blue fields; 30 strictly dark required",
    "independentControlRetuned": false,
    "frozenExperimentalPolicySha256": "125930e16bfcab0fc15261811aa6fb3a1dd995ee07a6c2bafd99cb99180dfcfb"
  },
  "selectionFrozenAt": "2026-10-10T10:31:54.339306+00:00",
  "developmentSha256": "b5c02a1866fa97c94592d92db8224fc6b4bb394fef777f4b8bcd94ee8f7cda1a",
  "controlManifestSha256": "26ded00807f7cc233bca0cbec4b2d64269848f66765ca3918473f60ba22760d5"
});
