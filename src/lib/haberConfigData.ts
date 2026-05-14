/**
 * Varsayılan haber / TV kaynakları.
 * finansepeti.net’teki güncel listeyle eşlemek için bu dosyayı veya Firestore `app_config/haberler` belgesini kullanın.
 */

export type GazeteKaynak = { id: string; ad: string; rssUrl: string };
export type TvKaynak = { id: string; ad: string; /** Uygulama içi WebView’da açılır */ webUrl: string };

export type HaberConfigData = {
  ulusalGazete: GazeteKaynak[];
  globalGazete: GazeteKaynak[];
  ulusalTv: TvKaynak[];
  globalTv: TvKaynak[];
};

/** RSS + YouTube canlı / yayın bağlantıları (site ile birebir değilse burayı veya Firestore’u güncelleyin). */
export const DEFAULT_HABER_CONFIG: HaberConfigData = {
  ulusalGazete: [
    { id: "bigpara", ad: "BigPara", rssUrl: "https://bigpara.hurriyet.com.tr/rss" },
    { id: "hurriyet_ekonomi", ad: "Hürriyet Ekonomi", rssUrl: "https://www.hurriyet.com.tr/rss/ekonomi" },
    { id: "milliyet_ekonomi", ad: "Milliyet Ekonomi", rssUrl: "https://www.milliyet.com.tr/rss/rssNew/ekonomiRss.xml" },
    { id: "hurriyet", ad: "Hürriyet", rssUrl: "https://www.hurriyet.com.tr/rss/gundem" },
    { id: "milliyet", ad: "Milliyet", rssUrl: "https://www.milliyet.com.tr/rss/rssNew/gundemRss.xml" },
    { id: "ntv", ad: "NTV", rssUrl: "https://www.ntv.com.tr/gundem.rss" },
    { id: "aa", ad: "Anadolu Ajansı", rssUrl: "https://www.aa.com.tr/tr/rss/default?cat=guncel" },
  ],
  globalGazete: [
    { id: "bbc", ad: "BBC News", rssUrl: "https://feeds.bbci.co.uk/news/world/rss.xml" },
    { id: "reuters", ad: "Reuters World", rssUrl: "https://feeds.reuters.com/Reuters/worldNews" },
    { id: "guardian", ad: "The Guardian World", rssUrl: "https://www.theguardian.com/world/rss" },
    { id: "dw", ad: "DW", rssUrl: "https://rss.dw.com/rdf/rss-en-world" },
  ],
  ulusalTv: [
    { id: "trt", ad: "TRT Haber", webUrl: "https://www.youtube.com/@trthaber" },
    { id: "ntv", ad: "NTV", webUrl: "https://www.youtube.com/live/pqq5c6k70kk?si=IF-hh6D5ZdFtZcLK" },
    { id: "cnnturk", ad: "CNN TÜRK", webUrl: "https://www.youtube.com/@cnnturk" },
    { id: "cnbce", ad: "CNBC-e", webUrl: "https://www.youtube.com/live/aZ3ycSbSYBA?si=L8rKbrnj0tMDDIe6" },
    { id: "apara", ad: "A Para", webUrl: "https://www.youtube.com/watch?v=6-Q8v_e-M2g" },
    { id: "bloomberght", ad: "Bloomberg HT", webUrl: "https://www.youtube.com/watch?v=hHSmBJk6w0c" },
  ],
  globalTv: [
    { id: "bbc", ad: "BBC News", webUrl: "https://www.youtube.com/@BBCNews" },
    { id: "reuters", ad: "Reuters", webUrl: "https://www.youtube.com/watch?v=W-BdMMpQa-o" },
    { id: "cnn", ad: "CNN", webUrl: "https://www.youtube.com/@CNN" },
    { id: "aljazeera", ad: "Al Jazeera English", webUrl: "https://www.youtube.com/@aljazeeraenglish" },
    { id: "bloomberg", ad: "Bloomberg Business", webUrl: "https://www.youtube.com/watch?v=iEpJwprxDdk" },
  ],
};
