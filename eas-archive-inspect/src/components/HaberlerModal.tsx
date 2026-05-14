import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppTheme } from "../theme/ThemeProvider";
import { t } from "../lib/i18n";
import { createHaberlerModalStyles, type HaberlerModalStyles } from "./haberlerModalStyles";
import { loadHaberConfig } from "../lib/haberConfig";
import type { HaberConfigData, GazeteKaynak, TvKaynak } from "../lib/haberConfigData";
import { parseRssItems, type RssItem } from "../lib/rssSimple";
import { HaberWebViewModal } from "./HaberWebViewModal";
import { youtubeInAppUrl } from "../lib/youtubeInAppUrl";

type Props = { visible: boolean; onClose: () => void };

type TabKey = "ulusal_g" | "global_g" | "ulusal_tv" | "global_tv";

type RssState = { loading: boolean; items?: RssItem[]; error?: string };

const RSS_TTL_MS = 5 * 60 * 1000;
/** Önbellek anahtarı (ayrıştırıcı değişince artır — boş BigPara vb. eski cache’i at). */
const RSS_MEM_PREFIX = "abs1:";
const rssMemory: Record<string, { at: number; items: RssItem[] }> = {};

export function HaberlerModal({ visible, onClose }: Props) {
  const { palette, lang } = useAppTheme();
  const styles = useMemo(() => createHaberlerModalStyles(palette), [palette]);
  const [tab, setTab] = useState<TabKey>("ulusal_g");
  const [config, setConfig] = useState<HaberConfigData | null>(null);
  const [rssMap, setRssMap] = useState<Record<string, RssState>>({});
  const [reader, setReader] = useState<{ uri: string; title: string } | null>(null);

  useEffect(() => {
    if (!visible) return;
    void (async () => {
      const c = await loadHaberConfig();
      setConfig(c);
    })();
  }, [visible]);

  const fetchRssFor = useCallback((id: string, rssUrl: string) => {
    const memKey = RSS_MEM_PREFIX + id;
    const cached = rssMemory[memKey];
    if (cached && Date.now() - cached.at < RSS_TTL_MS) {
      setRssMap((p) => ({ ...p, [id]: { loading: false, items: cached.items } }));
      return;
    }
    setRssMap((p) => ({ ...p, [id]: { loading: true } }));
    void (async () => {
      try {
        const r = await fetch(rssUrl, {
          headers: {
            Accept: "application/rss+xml, application/xml, text/xml, */*",
            "User-Agent": "FinansepetiMobile/1.0",
          },
        });
        if (!r.ok) throw new Error(String(r.status));
        const text = await r.text();
        const items = parseRssItems(text, 35, rssUrl);
        rssMemory[memKey] = { at: Date.now(), items };
        setRssMap((p) => ({ ...p, [id]: { loading: false, items } }));
      } catch {
        setRssMap((p) => ({ ...p, [id]: { loading: false, error: t(lang, "news_load_failed") } }));
      }
    })();
  }, [lang]);

  const gazeteList: GazeteKaynak[] = useMemo(() => {
    if (!config) return [];
    return tab === "ulusal_g" ? config.ulusalGazete : tab === "global_g" ? config.globalGazete : [];
  }, [config, tab]);

  const tvList: TvKaynak[] = useMemo(() => {
    if (!config) return [];
    return tab === "ulusal_tv" ? config.ulusalTv : tab === "global_tv" ? config.globalTv : [];
  }, [config, tab]);

  useEffect(() => {
    if (!visible || !config) return;
    if (tab === "ulusal_g") for (const s of config.ulusalGazete) fetchRssFor(s.id, s.rssUrl);
    if (tab === "global_g") for (const s of config.globalGazete) fetchRssFor(s.id, s.rssUrl);
  }, [visible, config, tab, fetchRssFor]);

  const tabs: { key: TabKey; label: string }[] = useMemo(
    () => [
      { key: "ulusal_g" as const, label: t(lang, "news_tab_national_paper") },
      { key: "global_g" as const, label: t(lang, "news_tab_global_paper") },
      { key: "ulusal_tv" as const, label: t(lang, "news_tab_national_tv") },
      { key: "global_tv" as const, label: t(lang, "news_tab_global_tv") },
    ],
    [lang],
  );

  return (
    <>
      <Modal visible={visible && !reader} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
        <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
          <View style={styles.header}>
            <Pressable onPress={onClose} style={styles.closeHit}>
              <Text style={styles.closeText}>{t(lang, "close")}</Text>
            </Pressable>
            <Text style={styles.headerTitle}>{t(lang, "news")}</Text>
            <View style={styles.closeHit} />
          </View>

          <View style={styles.tabGrid}>
            <View style={styles.tabGridRow}>
              {tabs.slice(0, 2).map((row) => (
                <Pressable
                  key={row.key}
                  style={[styles.tabCell, tab === row.key && styles.tabCellOn]}
                  onPress={() => setTab(row.key)}
                >
                  <Text style={[styles.tabCellText, tab === row.key && styles.tabCellTextOn]} numberOfLines={2}>
                    {row.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.tabGridRow}>
              {tabs.slice(2, 4).map((row) => (
                <Pressable
                  key={row.key}
                  style={[styles.tabCell, tab === row.key && styles.tabCellOn]}
                  onPress={() => setTab(row.key)}
                >
                  <Text style={[styles.tabCellText, tab === row.key && styles.tabCellTextOn]} numberOfLines={2}>
                    {row.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
            {!config ? (
              <ActivityIndicator size="large" color={palette.accent} style={{ marginTop: 24 }} />
            ) : tab === "ulusal_g" || tab === "global_g" ? (
              gazeteList.map((src) => (
                <View key={src.id} style={styles.block}>
                  <Text style={styles.sourceTitle}>{src.ad}</Text>
                  <RssBlock
                    id={src.id}
                    styles={styles}
                    accent={palette.accent}
                    state={rssMap[src.id]}
                    onOpenArticle={(uri, title) => setReader({ uri, title })}
                  />
                </View>
              ))
            ) : (
              <View style={styles.tvFullGrid}>
                {tab === "ulusal_tv" ? (
                  <>
                    <View style={styles.tvFullRow}>
                      {tvList.slice(0, 3).map((ch) => (
                        <Pressable
                          key={ch.id}
                          style={styles.tvFullCell}
                          onPress={() => setReader({ uri: youtubeInAppUrl(ch.webUrl), title: ch.ad })}
                        >
                          <Text style={styles.tvFullCellText} numberOfLines={2}>
                            {ch.ad}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    <View style={styles.tvFullRow}>
                      {tvList.slice(3, 6).map((ch) => (
                        <Pressable
                          key={ch.id}
                          style={styles.tvFullCell}
                          onPress={() => setReader({ uri: youtubeInAppUrl(ch.webUrl), title: ch.ad })}
                        >
                          <Text style={styles.tvFullCellText} numberOfLines={2}>
                            {ch.ad}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </>
                ) : (
                  <>
                    <View style={styles.tvFullRow}>
                      {tvList.slice(0, 3).map((ch) => (
                        <Pressable
                          key={ch.id}
                          style={styles.tvFullCell}
                          onPress={() => setReader({ uri: youtubeInAppUrl(ch.webUrl), title: ch.ad })}
                        >
                          <Text style={styles.tvFullCellText} numberOfLines={2}>
                            {ch.ad}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    <View style={[styles.tvFullRow, styles.tvGlobalBottomRow]}>
                      {tvList.slice(3, 5).map((ch) => (
                        <Pressable
                          key={ch.id}
                          style={styles.tvFullCell}
                          onPress={() => setReader({ uri: youtubeInAppUrl(ch.webUrl), title: ch.ad })}
                        >
                          <Text style={styles.tvFullCellText} numberOfLines={2}>
                            {ch.ad}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </>
                )}
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <HaberWebViewModal
        visible={!!reader}
        uri={reader?.uri ?? ""}
        title={reader?.title}
        onClose={() => setReader(null)}
      />
    </>
  );
}

function RssBlock({
  id,
  styles,
  accent,
  state,
  onOpenArticle,
}: {
  id: string;
  styles: HaberlerModalStyles;
  accent: string;
  state?: RssState;
  onOpenArticle: (uri: string, title: string) => void;
}) {
  if (!state || state.loading) {
    return (
      <View style={styles.rssLoading}>
        <ActivityIndicator color={accent} />
      </View>
    );
  }
  if (state.error) {
    return <Text style={styles.rssError}>{state.error}</Text>;
  }
  const items = state.items ?? [];
  if (!items.length) {
    return <Text style={styles.rssError}>Haber bulunamadı</Text>;
  }
  return (
    <View style={styles.rssList}>
      {items.map((it, idx) => (
        <Pressable
          key={`${id}-${idx}`}
          style={styles.articleRow}
          onPress={() => onOpenArticle(it.link, it.title)}
        >
          <View style={styles.articleTextCol}>
            <Text style={styles.articleTitle} numberOfLines={3}>
              {it.title}
            </Text>
            {it.publishedAt > 0 ? (
              <Text style={styles.articleMeta}>
                {new Date(it.publishedAt).toLocaleString("tr-TR", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>
            ) : null}
          </View>
          <Text style={styles.articleChevron}>›</Text>
        </Pressable>
      ))}
    </View>
  );
}
