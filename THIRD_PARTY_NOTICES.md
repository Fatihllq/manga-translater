# Dağıtım bileşenleri

0.5.0 · 21 Ekim 2026. Tam lisans metinleri dağıtımın ilgili klasörlerindedir. Model ve font içerik özetleri derlemede doğrulanır; sürüm paketi ayrıca dosya envanteri taşır.

| Bileşen | Kullanım | Lisans ve paket konumu |
|---|---|---|
| ONNX Runtime Web 1.30.0 | CPU/WASM çıkarımı | MIT ve üçüncü taraf bildirimleri; `vendor/onnx/LICENSE.txt`, `ThirdPartyNotices.txt` |
| ogkalu comic-text-and-bubble-detector, revision 16e8a622 | INT8 yazı/balon tespiti | Apache-2.0; `vendor/detector/APACHE-2.0.txt`, `NOTICE.txt` |
| PaddleOCR PP-OCRv5 / RapidOCR 3.10.0 | Yerel detektör, EN/CJK/KO tanıyıcı ve sözlükler | Apache-2.0; `vendor/paddle/LICENSE.txt`, `LICENSE-RAPIDOCR.txt`, `NOTICE.txt`, `languages.json` |
| Tesseract.js 7.0.0 / Tesseract core | Korunan eski geliştirme/uyumluluk yolu; varsayılan OCR Paddle | Apache-2.0; `vendor/TESSERACT-JS-LICENSE.md`, `vendor/core/LICENSE` |
| İngilizce Tesseract traineddata | Korunan yerel 2 Ekim modeli; bu sürümde yeniden eğitilmedi | Apache-2.0; `vendor/lang/TESSDATA-LICENSE.txt`; yerel değişiklik kimliği `model-version.json` |
| fflate 0.8.3 | Yerel ZIP/CBZ açma ve ZIP oluşturma | MIT; `vendor/fflate-LICENSE.txt` |
| Noto Sans variable | Türkçe karakterleri kapsayan paketli font | SIL OFL 1.1; `assets/fonts/OFL.txt`, kaynak ve özet `font.json` |

Sade yazı tipi paketli Noto Sans kullanır. Kitap/çizgi roman seçenekleri cihazın mevcut Georgia/Comic ailesini kullanır; eksik karakterler için Noto Sans ve sistem fontları yedektir. Bu sistem fontları yeniden dağıtılmaz. Eklenti simgesi yerel olarak çizildi; üzerindeki harf Noto Sans ile oluşturuldu.

GPU modeli geliştirme klasöründe korunur ve standart dağıtımda bulunmaz. Kaynak görseller rakip eklentilerden kopyalanmadı. İnceleme paketleri, eğitim/veri kümeleri ve telifli test sayfaları mağaza ZIP'ine dahil edilmez.

Çeviri motoru Chrome tarafından sağlanır; Chrome'un dil paketleri eklenti ZIP'inde yeniden dağıtılmaz. Yayıncı, kendi ürün kodunun dağıtım haklarından ve kullanacağı mağaza materyallerinden sorumludur; bu envanter üçüncü taraf bileşen bildirimlerini korur.


## MI-GAN

Picsart AI Research MI-GAN-512 Places2 ONNX Pipeline v2, MIT model ve ağırlık lisansı. `vendor/inpainting/LICENSE.txt` ve `LICENSE-WEIGHTS.txt` paketlidir. Kaynak: https://github.com/Picsart-AI-Research/MI-GAN ; ağırlık SHA-256: `6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b`.
