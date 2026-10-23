# Manga Çevirmeni gizlilik açıklaması

Güncelleme: 23 Ekim 2026 · Sürüm 0.6.3

Manga Çevirmeni ücretsiz bir masaüstü Chrome eklentisidir. Hesap, API anahtarı, abonelik, reklam ve kullanım analitiği içermez. Eklentinin OCR veya çeviri sunucusu yoktur.

## Görseller ve çeviri

Seçtiğin manga görseli cihazında işlenir. Yazı algılama ve Paddle OCR modelleri eklenti paketindedir. Çeviri Chrome'un cihaz üzerinde çalışan Translator API'sini kullanır. Eklenti görselleri, okunan metinleri veya çevirileri harici OCR/çeviri hizmetlerine göndermez.

Chrome, ilk kullanımda gerekli çeviri motorunu ve dil paketlerini kendi bileşen hizmetinden indirebilir. Bu indirme Chrome tarafından yönetilir. Destek cihaz, Chrome sürümü ve dil çiftine göre değişir. Dil paketleri hazırlandıktan sonra yerel dosyalar internet bağlantısı olmadan işlenebilir. Çevrimiçi bir sitedeki yeni görselleri edinmek için siteye bağlantı gerekir.

## Cihazında saklananlar

- Okuma geçmişi: görsel içerik özeti, sayfa/görsel adresleri, dil ve model kimlikleri, yazı alanları, OCR metinleri, çeviriler ve işlem durumu.
- Düzenlemeler: elle değiştirdiğin metinler, seçimler, biçim ve sınırlı dolgu işlemleri. Bunlar otomatik geçmiş temizliğinden ayrı korunur.
- Tercihler: kaynak/hedef dil, seri adı, seri sözlüğü, onayladığın ifadeler ve görünüm ayarları.
- Yalnız **Doğru metni onayla** gibi açık onay işlemleriyle oluşturulan eğitim kayıtları: küçük seçili görsel, kaynak metin, dil ve ilgili sayfa bilgileri. Otomatik okuma sonuçları eğitim etiketi oluşturmaz ve eklenti kendi başına model eğitmez.

Bu kayıtlar Chrome profilindeki yerel IndexedDB'dedir; eklentinin bir sunucusuna veya senkronizasyon hizmetine yüklenmez. Otomatik okuma önbelleği yaklaşık 64 MiB ile sınırlıdır ve eski otomatik kayıtlar temizlenebilir. Kullanıcı düzeltmeleri ayrı tutulur; tarayıcının kullanılabilir depolama alanına tabidir. Kaydetme başarısızsa arayüz hata gösterir.

Dinamik okuyucularda bütün bölümü görünür sayfayı kaydırmadan hazırlamak için aynı sitede görünmeyen geçici bir okuyucu açılabilir; ek sekme açılmaz. Bu okuyucudaki geçici blob/canvas görsellerinin özgün kopyaları sitenin kökenine ait yerel CacheStorage'da oturuma özel saklanır. Bu alan 64 MiB okuma geçmişi sınırından ayrıdır ve tarayıcı kotasına tabidir. Sonraki hazırlıkta veya sayfa kapanışında silinir; tarayıcı beklenmedik biçimde kapanırsa kalıntılar kalabilir. Bu geçici alana çeviriler veya temizlenmiş piksel yamaları yazılmaz. Site verilerini temizlemek bu kopyaları da kaldırır.

## Kontrol ve yedekleme

“Otomatik geçmişi temizle” otomatik sonuçları siler, kullanıcı düzeltmelerini korur. “Okuma yedeği” okuma/düzenleme/ayar kayıtlarını JSON olarak dışa aktarır; eski eğitim yedeği ayrı çalışır. Yedekler çevirdiğin metinleri ve sayfa adreslerini içerebilir. Dosyalar yalnız seçtiğin indirme konumuna yazılır. Chrome'un eklenti/site verisi yönetiminden eklentinin bütün yerel verilerini silebilirsin.

PNG, ZIP ve CBZ dosyaları cihazında açılır veya oluşturulur. Yerel içe aktarma bu dosyaları bir sunucuya yüklemez.

## İzinler

Farklı manga okuyucularında logoyu otomatik göstermek için **HTTP/HTTPS sitelerine erişim** tanımlıdır. Sayfalardaki görsel/canvas boyutları, okuyucu kapsayıcıları, manga metaverisi ve bölüm gezinme işaretleri yerel olarak incelenir; iframe okuyucularının varlığı aynı sekmeye bildirilir. Bu algılama sırasında OCR veya çeviri başlatılmaz, sayfa içeriği harici bir hizmete gönderilmez. Kapak/katalog ve sıradan fotoğraf sayfaları elenir; alışılmadık yapılar yanlış algılanabilir.

Logoya basınca eklenti kökenindeki küçük gömülü arayüz aynı bölüm çevirisini çalıştırır. Ayarlar ve okuma kayıtları mevcut eklenti IndexedDB'sini kullanır; siteye ayrı bir kalıcı çeviri veritabanı eklenmez. Yan panel yalnız araç çubuğu simgesiyle açılır. Chrome'un site erişimi ayarları otomatik logonun hangi sitelerde çalışacağını sınırlar.

- **activeTab:** eklenti simgesine bastığın sekmedeki manga görselini okumak ve çeviri katmanını göstermek.
- **scripting:** aynı sekmede seçim, görsel keşfi ve yerel gösterim araçlarını çalıştırmak.
- **sidePanel:** araç çubuğu simgesinden ayar ve düzenleme panelini açmak.
- **Site erişimi:** okuyucuyu algılamak, bölüm görsellerini asıl kaynaklarından okumak ve iframe içeriğinde çeviriyi göstermek. Chrome erişimi kısıtlanmış bir köken için gerekirse izin istenir.

Kod, WASM, OCR modelleri ve Noto Sans fontu paket içinde bulunur. Uzaktan çalıştırılabilir kod indirilmez. Paket içindeki kaynak/lisans bağlantıları çalışma sırasında hizmet çağrısı değildir.

Chrome Translator hakkında: [Chrome'un resmî açıklaması](https://developer.chrome.com/docs/ai/translator-api).


0.6.0: MI-GAN zemin temizlemesi cihazda, paketli ONNX modeliyle çalışır. Görseller herhangi bir temizleme sunucusuna yüklenmez. Temizlenen piksel yamaları bellekte türetilir; okuma geçmişine gömülmez.
