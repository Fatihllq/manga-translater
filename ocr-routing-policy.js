// Validation did not pass: automatic routing remains disabled.
export const OCR_ROUTING_POLICY = Object.freeze({
  "profile": "strict",
  "routes": {
    "word": {
      "enabled": false,
      "primary": "8",
      "retry": null
    },
    "line": {
      "enabled": false,
      "primary": "7",
      "retry": null
    }
  },
  "version": "ocr-shape-v1-20261009",
  "enabled": false,
  "modelVersion": "eng-manga-20261002-yeni-veri",
  "acceptance": {
    "quality": "insufficient_routed_validation_coverage",
    "realChromeSpeed": "not_verified_language_pack_unavailable"
  },
  "reason": "No layout route has 20 validation fields; production remains block 6.",
  "parameterStrategy": "explicit_setParameters_per_job"
});
