/**
 * finanssepeti.net — menü başlıkları ve tam açıklama metinleri.
 * Misyon / Vizyon / Bize Ulaşın: canlı ana sayfadaki `menuContents` ile eşleştirildi (https://finanssepeti.net/).
 */

export type SiteMenuEntry = {
  /** Uygulama içi yönlendirme için sabit kimlik */
  id: string;
  /** Menüde görünen başlık + açıklama: tam cümleler, kısaltma yok */
  text: string;
  /** Varsa satıra basınca harici bağlantı (mailto:, https://) */
  openUrl?: string;
};

/** Bize Ulaşın altında sitedeki gibi simge + harici URL (finanssepeti.net). */
export type SiteMenuSocialLink = {
  id: string;
  url: string;
  platform: "x" | "instagram" | "youtube";
};

export type SiteMenuSection = {
  id: string;
  /** Menü grubu başlığı (sitedeki gibi) */
  title: string;
  items: SiteMenuEntry[];
  /** Örn. X / Instagram / YouTube simgeleri */
  socialLinks?: SiteMenuSocialLink[];
};

/** Alt çubukta ve iletişim bölümünde kullanılan sabit sosyal bağlantılar (finanssepeti.net). */
export const SITE_MENU_SOCIAL_LINKS: SiteMenuSocialLink[] = [
  { id: "sosyal_x", url: "https://x.com/finanssepetinet", platform: "x" },
  { id: "sosyal_ig", url: "https://instagram.com/finanssepetinet", platform: "instagram" },
  { id: "sosyal_yt", url: "https://youtube.com/@FinansSepeti", platform: "youtube" },
];

/**
 * Sitedeki menü hiyerarşisi: her `items[].text` tek parça tam metin olabilir (başlık: açıklama biçiminde).
 */
export const SITE_MENU_SECTIONS: SiteMenuSection[] = [
  {
    id: "krediler",
    title: "Krediler",
    items: [
      {
        id: "kredi_hesaplama",
        text:
          "Kredi Hesaplama Modülü: İhtiyaç kredisi, taşıt kredisi ve konut kredisi için tutar, vade ve faiz oranına göre aylık taksit ve toplam geri ödeme tutarını hesaplayabilir; ihtiyaç halinde ödeme tablosu oluşturup planınızı çıktı alabilirsiniz.",
      },
      {
        id: "kullandigim_krediler",
        text:
          "Kullandığım Krediler: Banka ve finans kuruluşlarındaki mevcut kredilerinizi tek ekranda listeleyebilir; kalan anapara, vade tarihleri ve ödeme geçmişinizi takip edebilirsiniz.",
      },
    ],
  },
  {
    id: "kiyasla",
    title: "Kıyasla",
    items: [
      {
        id: "kiyasla_aciklama",
        text:
          "Ürün Karşılaştırma: Daha önce edindiğiniz konut, taşıt, arsa ve benzeri varlıklara ilişkin peşinat tutarları ile ödeme tarihlerini; kredi kullandıysanız taksit tutarlarını ve vadelerini kayda alarak, aynı nakit çıkışının bugünkü piyasa koşullarında farklı yatırım araçlarına yönlendirilmiş olsaydı ortaya çıkabilecek getiri, risk ve alternatif senaryoları tek ekranda karşılaştırabilirsiniz. Böylece geçmiş satın alma ve borçlanma kararlarınızı güncel verilerle yeniden değerlendirmenize yardımcı olur.",
      },
    ],
  },
  {
    id: "dusenler_yukselenler",
    title: "Düşenler ve Yükselenler",
    items: [
      {
        id: "dusenler_aciklama",
        text:
          "Piyasalar görünümünde Nasdaq endeks bileşenleri, pay senetleri (borsa), kripto para çiftleri ve emtia ürünleri; haftalık, aylık, üç aylık, altı aylık ve bir yıllık zaman dilimlerinde yüzdesel getiri veya kayıplarına göre sıralanır. Her dilimde en güçlü yükseliş ve en belirgin düşüş gösteren enstrümanları liste halinde inceleyerek kısa ve orta vadeli göreceli performansı tek bakışta izleyebilirsiniz.",
      },
    ],
  },
  {
    id: "analiz",
    title: "Analiz",
    items: [
      {
        id: "analiz_aciklama",
        text:
          "Analiz ve grafik ekranlarında yer alan alım–satım sinyal robotu, seçtiğiniz enstrümanlar için kurallara dayalı uyarılar üretir. Telegram botunu bağladığınızda bu sinyaller anlık olarak hesabınıza iletilir; böylece grafik başında olmasanız bile önemli uyarıları kaçırmadan takip edebilirsiniz.",
      },
    ],
  },
  {
    id: "yatirim_ekle",
    title: "Yatırım Ekle",
    items: [
      {
        id: "yatirim_ekle_aciklama",
        text:
          "Yatırım Ekle: Ana sayfa ve Piyasalar bölümündeki ürün kartlarında bulunan artı (+) işaretine dokunarak satın aldığınız veya izlemek istediğiniz enstrümanların tutar, işlem ve tarih bilgilerini kaydedebilir; portföyünüzü güncel ve tutarlı biçimde tutabilirsiniz.",
      },
    ],
  },
  {
    id: "cuzdanim",
    title: "Cüzdanım",
    items: [
      {
        id: "cuzdanim_aciklama",
        text:
          "Cüzdanım: Gelir ve gider kayıtlarınızı düzenleyerek nakit akışınızı şeffaf biçimde izleyebilir; döneme göre özetlenen EBITDA görünümü ile işletmenize benzer karlılık tablosunu takip edebilirsiniz. Portföyüm ile yatırım pozisyonlarınızın güncel özetine ulaşırken; profil bilgilerinizi düzenleyebilir, diğer kullanıcılara mesaj gönderebilir, haber ve içeriklere yorum yazabilir, forum başlıklarında tartışmalara katılarak toplulukla etkileşimi tek çatı altında yönetebilirsiniz.",
      },
    ],
  },
  {
    id: "profil",
    title: "Profil İşlemleri",
    items: [
      {
        id: "profilim",
        text:
          "Profilim: Ad, soyad, iletişim bilgileri, profil fotoğrafı ve hesap güvenliği ayarlarınızı buradan güncelleyebilir; hesabınızla ilgili özet bilgilere ulaşabilirsiniz.",
      },
      {
        id: "ana_sayfam",
        text:
          "Ana Sayfam: Kişisel ana sayfanızın düzenini, gösterilecek modülleri ve öncelik sırasını seçerek size özel bir giriş ekranı oluşturabilirsiniz.",
      },
      {
        id: "kisi_ara",
        text:
          "Kişi Ara: Platform üzerindeki kullanıcılar arasında isim veya kullanıcı adına göre arama yapabilir; bulduğunuz kişilerin profillerine gidebilir veya takip isteği gönderebilirsiniz.",
      },
      {
        id: "bildirimler",
        text:
          "Bildirimler: Mesaj, etiket, yorum, beğeni ve sistem duyuruları gibi tüm bildirimlerinizi tek listede okuyabilir; okunmamışları işaretleyebilir veya sessize alabilirsiniz.",
      },
      {
        id: "mesajlarim",
        text:
          "Mesajlarım: Diğer kullanıcılarla olan özel mesajlaşmalarınızı konuşma bazında görüntüleyebilir; yeni mesaj yazabilir veya geçmişi arşivleyebilirsiniz.",
      },
    ],
  },
  {
    id: "icerik",
    title: "İçerik Yönetimi",
    items: [
      {
        id: "yorum_yaz",
        text:
          "Yorum Yaz: Haber, analiz veya forum başlıkları altında görüşünüzü paylaşabilir; kurallara uygun, yapıcı yorumlarınızla topluluğa katkıda bulunabilirsiniz.",
      },
      {
        id: "yorumlarim",
        text:
          "Yorumlarım: Yayınladığınız tüm yorumları tarih ve konu bazında listeleyebilir; düzenleme veya silme işlemlerini buradan yapabilirsiniz.",
      },
      {
        id: "begendiklerim",
        text:
          "Beğendiklerim: Beğendiğiniz içerikleri daha sonra tekrar okumak üzere kaydedebilir; liste üzerinden doğrudan ilgili sayfaya dönebilirsiniz.",
      },
      {
        id: "favorilerim",
        text:
          "Favorilerim: Sık kullandığınız sayfaları, hesaplamaları veya raporları favorilere ekleyerek ana menüden hızlı erişim sağlayabilirsiniz.",
      },
      {
        id: "fotograflarim",
        text:
          "Fotoğraflarım: Profilinizde ve paylaşımlarınızda kullanacağınız görselleri yükleyebilir; albüm oluşturup düzenleyebilirsiniz.",
      },
      {
        id: "videolarim",
        text:
          "Videolarım: Yüklediğiniz veya paylaştığınız video içeriklerini burada yönetebilir; gizlilik ve yayınlama tercihlerinizi ayarlayabilirsiniz.",
      },
    ],
  },
  {
    id: "kariyer_yayin",
    title: "Kariyer ve Yayın",
    items: [
      {
        id: "kariyerim",
        text:
          "Kariyerim: İş ilanları, özgeçmiş ve başvuru durumlarınızı takip edebilir; kurumsal iş birlikleri ve etkinlik davetlerini bu bölümden yönetebilirsiniz.",
      },
    ],
  },
  {
    id: "ayarlar",
    title: "Ayarlar",
    items: [
      {
        id: "profil_gizliligi",
        text:
          "Profil Gizliliği: Profilinizi kimlerin görebileceğini, mesaj ve arama izinlerinizi ve veri paylaşım tercihlerinizi ayrıntılı olarak yapılandırabilirsiniz.",
      },
      {
        id: "sifre_degistir",
        text:
          "Şifre Değiştir: Mevcut şifrenizi doğruladıktan sonra yeni ve güçlü bir şifre belirleyebilir; oturum açık cihazlardan çıkış seçeneklerini kullanabilirsiniz.",
      },
      {
        id: "dil_secenekleri",
        text:
          "Dil Seçenekleri: Arayüz dilini Türkçe, İngilizce veya sitede sunulan diğer dillerden biri olarak seçebilir; tercihiniz hesabınıza kaydedilir.",
      },
      {
        id: "site_gorunumu",
        text:
          "Site Görünümü: Açık veya koyu tema, yazı boyutu ve liste yoğunluğu gibi görsel tercihleri buradan değiştirerek okuma deneyiminizi kişiselleştirebilirsiniz.",
      },
    ],
  },
  {
    id: "misyon",
    title: "Misyon",
    items: [
      {
        id: "misyon_metin",
        text:
          "Misyonumuz, bireysel kullanıcıların finansal kararlarını veriye dayalı ve bilinçli bir şekilde alabilmeleri için gerekli araçları, canlı piyasa verilerini ve sosyal öğrenme ortamını tek bir çatı altında sunmaktır. Teknik analiz, portföy takibi, harcama yönetimi ve kredi planlaması gibi günlük finansal ihtiyaçları kolaylaştırarak; her kullanıcının kendi finansal hedeflerine ulaşmasına destek olacak güvenilir, sade ve profesyonel bir platform sunmak temel misyonumuzdur.",
      },
    ],
  },
  {
    id: "vizyon",
    title: "Vizyon",
    items: [
      {
        id: "vizyon_metin",
        text:
          "Finanssepeti.net olarak vizyonumuz, Türkiye'de bireysel yatırımcının finansal okuryazarlığını güçlendiren ve tüm piyasa verilerini tek bir platformda buluşturan, güvenilir ve erişilebilir bir dijital finans ekosisteminin öncü markası olmaktır. Kullanıcılarımızın piyasa takibinden portföy yönetimine, sosyal etkileşimden bütçe planlamasına kadar tüm finansal ihtiyaçlarını karşılayan; şeffaf, güncel ve kullanıcı odaklı bir hizmet anlayışıyla sektörde fark yaratmayı hedefliyoruz.",
      },
    ],
  },
  {
    id: "bize_ulasin",
    title: "Bize Ulaşın",
    items: [
      {
        id: "iletisim_eposta",
        text:
          "E-posta: info@finanssepeti.net | finanssepeti.net@gmail.com",
        openUrl: "mailto:info@finanssepeti.net",
      },
    ],
  },
];
