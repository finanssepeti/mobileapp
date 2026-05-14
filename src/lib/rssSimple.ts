/** Basit RSS 2.0 ayrıştırma (bağımlılık yok). */

export type RssItem = { title: string; link: string; /** ms; yoksa 0 */ publishedAt: number };

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripCdata(s: string): string {
  const t = s.trim();
  const m = t.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return (m ? m[1] : t).trim();
}

function firstTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  if (!m) return "";
  const inner = m[1].trim();
  return decodeXmlEntities(stripCdata(inner).replace(/<[^>]+>/g, "")).trim();
}

/** pubDate / dc:date — en yeni üstte (yeniden eskiye). */
function parseItemDate(block: string): number {
  let raw = firstTag(block, "pubDate");
  if (!raw) {
    const m = block.match(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i);
    if (m) raw = decodeXmlEntities(stripCdata(m[1].replace(/<[^>]+>/g, ""))).trim();
  }
  if (!raw) return 0;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? 0 : t;
}

/** BigPara vb. göreli `<link>/haberler/...</link>` → tam URL (RSS istek URL’sine göre). */
function absoluteItemLink(raw: string, feedSourceUrl?: string): string {
  const link = raw.trim();
  if (!link) return "";
  if (/^https?:\/\//i.test(link)) return link;
  if (!feedSourceUrl) return "";
  try {
    return new URL(link, feedSourceUrl).href;
  } catch {
    return "";
  }
}

export function parseRssItems(xml: string, maxItems = 35, feedSourceUrl?: string): RssItem[] {
  const rows: { item: RssItem; order: number }[] = [];
  const re = /<item[\s\S]*?<\/item>/gi;
  let m: RegExpExecArray | null;
  let order = 0;
  while ((m = re.exec(xml)) !== null) {
    const block = m[0];
    const title = firstTag(block, "title");
    let link = firstTag(block, "link");
    if (!link) {
      const guid = block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
      if (guid) link = stripCdata(guid[1].replace(/<[^>]+>/g, "")).trim();
    }
    const publishedAt = parseItemDate(block);
    const abs = absoluteItemLink(link, feedSourceUrl);
    if (title && abs) {
      rows.push({ item: { title, link: abs, publishedAt }, order });
      order += 1;
      if (rows.length >= maxItems) break;
    }
  }
  rows.sort((a, b) => {
    if (b.item.publishedAt !== a.item.publishedAt) return b.item.publishedAt - a.item.publishedAt;
    return a.order - b.order;
  });
  return rows.map((r) => r.item);
}
