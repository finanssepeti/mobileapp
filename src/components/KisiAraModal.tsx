import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppTheme } from "../theme/ThemeProvider";
import { createKisiAraModalStyles } from "./kisiAraModalStyles";
import {
  canUseKisiAraFirestore,
  getFollowersPeople,
  getFollowersPeopleQuick,
  getFollowingPeople,
  getFollowingPeopleQuick,
  getIncomingFollowRequests,
  getOutgoingFollowPendingMap,
  respondFollowRequest,
  sendFollowRequest,
  searchPeople,
  getBlockState,
  setBlockedUser,
  type FollowRequestItem,
  type KisiAraPerson,
} from "../lib/kisiAraFirestore";
import { SocialProfileModal } from "./SocialProfileModal";

type Props = {
  visible: boolean;
  onClose: () => void;
  onOpenCompose?: (person: KisiAraPerson) => void;
  initialTab?: "following" | "followers" | "notifications" | "results";
};

function getInitial(p: KisiAraPerson): string {
  const x = (p.username || p.displayName || p.email || "").replace(/^@/, "").trim();
  return x ? x[0]!.toLocaleUpperCase("tr-TR") : "?";
}

export function KisiAraModal({ visible, onClose, onOpenCompose, initialTab = "following" }: Props) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createKisiAraModalStyles(palette), [palette]);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"following" | "followers" | "notifications" | "results">("following");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [company, setCompany] = useState("");
  const [university, setUniversity] = useState("");
  const [city, setCity] = useState("");
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [items, setItems] = useState<KisiAraPerson[]>([]);
  const [followingItems, setFollowingItems] = useState<KisiAraPerson[]>([]);
  const [followerItems, setFollowerItems] = useState<KisiAraPerson[]>([]);
  const [requestItems, setRequestItems] = useState<FollowRequestItem[]>([]);
  const [followState, setFollowState] = useState<Record<string, boolean>>({});
  const [requestState, setRequestState] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState("");
  const [errorText, setErrorText] = useState("");
  const [selectedPerson, setSelectedPerson] = useState<KisiAraPerson | null>(null);
  const [blockedMap, setBlockedMap] = useState<Record<string, boolean>>({});

  const doSearch = () => {
    if (!canUseKisiAraFirestore()) {
      setItems([]);
      setErrorText("Kişi Ara şu an kullanılamıyor.");
      return;
    }
    let cancelled = false;
    setTab("results");
    setLoadingSearch(true);
    setErrorText("");
    void (async () => {
      try {
        const found = await searchPeople(search, { company, university, city });
        if (cancelled) return;
        setItems(found);
        const next: Record<string, boolean> = {};
        for (const p of followingItems) next[p.userId] = true;
        setFollowState(next);
      } catch {
        if (!cancelled) {
          setErrorText("Kişiler yüklenemedi.");
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoadingSearch(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  };

  useEffect(() => {
    if (!visible) return;
    if (!canUseKisiAraFirestore()) return;
    setErrorText("");
    let cancelled = false;

    void (async () => {
      try {
        const [quickFollow, quickFollowers] = await Promise.all([getFollowingPeopleQuick(), getFollowersPeopleQuick()]);
        if (cancelled) return;
        setFollowingItems(quickFollow);
        setFollowerItems(quickFollowers);
        setFollowState(Object.fromEntries(quickFollow.map((p) => [p.userId, true])));
        setTab(initialTab);
      } catch {
        if (!cancelled) {
          setFollowingItems([]);
          setFollowerItems([]);
        }
      }

      void Promise.all([
        getFollowingPeople().then((rows) => {
          if (cancelled) return;
          setFollowingItems(rows);
          setFollowState(Object.fromEntries(rows.map((p) => [p.userId, true])));
        }),
        getFollowersPeople().then((rows) => {
          if (cancelled) return;
          setFollowerItems(rows);
        }),
        Promise.all([getBlockState(), getIncomingFollowRequests(), getOutgoingFollowPendingMap()]).then(([blockState, reqRows, outgoingPending]) => {
          if (cancelled) return;
          setBlockedMap(Object.fromEntries(Array.from(blockState.iBlocked.values()).map((id) => [id, true])));
          setRequestItems(reqRows);
          setRequestState({
            ...Object.fromEntries(reqRows.map((r) => [r.fromUserId, true])),
            ...outgoingPending,
          });
        }),
      ]).catch(() => {
        if (!cancelled) {
          setRequestItems([]);
        }
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, initialTab]);

  useEffect(() => {
    const m: Record<string, boolean> = {};
    for (const p of followingItems) m[p.userId] = true;
    setFollowState((prev) => ({ ...prev, ...m }));
  }, [followingItems]);

  const shown = useMemo(() => {
    if (tab === "results") return items.slice(0, 250);
    if (tab === "following") return followingItems.slice(0, 250);
    if (tab === "followers") return followerItems.slice(0, 250);
    return [];
  }, [tab, items, followingItems, followerItems]);

  const onFollowPress = (p: KisiAraPerson) => {
    if (!p.userId || busyId) return;
    setBusyId(p.userId);
    setErrorText("");
    if (followState[p.userId]) {
      setBusyId("");
      return;
    }
    void sendFollowRequest(p)
      .then(() => {
        setRequestState((prev) => ({ ...prev, [p.userId]: true }));
      })
      .catch(() => {
        setErrorText("Takip isteği gönderilemedi.");
      })
      .finally(() => {
        setBusyId("");
      });
  };

  const onRequestAction = (req: FollowRequestItem, approve: boolean) => {
    if (busyId) return;
    setBusyId(req.fromUserId);
    setErrorText("");
    void respondFollowRequest(req, approve)
      .then(() => {
        setRequestItems((prev) => prev.filter((x) => x.fromUserId !== req.fromUserId));
      })
      .catch(() => {
        setErrorText("İstek işlemi tamamlanamadı.");
      })
      .finally(() => {
        setBusyId("");
      });
  };

  const onToggleBlock = (p: KisiAraPerson, nextBlocked: boolean) => {
    setBusyId(p.userId);
    setErrorText("");
    void setBlockedUser(p.userId, nextBlocked)
      .then(() => {
        setBlockedMap((prev) => ({ ...prev, [p.userId]: nextBlocked }));
        if (nextBlocked) {
          setItems((prev) => prev.filter((x) => x.userId !== p.userId));
          setFollowingItems((prev) => prev.filter((x) => x.userId !== p.userId));
          setFollowerItems((prev) => prev.filter((x) => x.userId !== p.userId));
          setRequestItems((prev) => prev.filter((x) => x.fromUserId !== p.userId));
        }
      })
      .catch(() => setErrorText("Engelleme işlemi tamamlanamadı."))
      .finally(() => setBusyId(""));
  };

  return (
    <Modal visible={visible} animationType="slide">
      <SafeAreaView style={styles.fullscreen}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Kişi Ara</Text>
            <View style={styles.headBtns}>
              <Pressable onPress={() => setAdvancedOpen(true)} style={styles.detailBtn}>
                <Text style={styles.detailBtnTxt}>Detaylı</Text>
              </Pressable>
              <Pressable onPress={onClose} style={styles.iconBtn}>
                <Text style={styles.closeTxt}>✕</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.searchRow}>
            <TextInput
              value={search}
              onChangeText={setSearch}
              style={[styles.search, styles.searchFlex]}
              placeholder="Kullanıcı Adı, Adı Soyadı veya E-mail"
              placeholderTextColor={palette.textMuted}
            />
            <Pressable style={styles.searchBtn} onPress={doSearch}>
              <Text style={styles.searchBtnTxt}>Ara</Text>
            </Pressable>
          </View>
          <Pressable onPress={() => setAdvancedOpen(true)}>
            <Text style={styles.advancedLink}>Detaylı Arama Yapmak ister misiniz?</Text>
          </Pressable>
          <View style={styles.tabsRow}>
            <Pressable style={[styles.tabBtn, tab === "following" && styles.tabBtnActive]} onPress={() => setTab("following")}>
              <Text style={styles.tabTxt}>Takip Edilen</Text>
            </Pressable>
            <Pressable style={[styles.tabBtn, tab === "followers" && styles.tabBtnActive]} onPress={() => setTab("followers")}>
              <Text style={styles.tabTxt}>Takipçi</Text>
            </Pressable>
            <Pressable style={[styles.tabBtn, tab === "notifications" && styles.tabBtnActive]} onPress={() => setTab("notifications")}>
              <Text style={styles.tabTxt}>Bildirimler</Text>
            </Pressable>
            <Pressable style={[styles.tabBtn, tab === "results" && styles.tabBtnActive]} onPress={() => setTab("results")}>
              <Text style={styles.tabTxt}>Arama Sonuçları</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
              {tab === "results" && loadingSearch ? (
                <View style={styles.searchLoadingBanner}>
                  <ActivityIndicator color={palette.accent} />
                  <Text style={styles.searchLoadingTxt}>Aranıyor…</Text>
                </View>
              ) : null}
              {tab !== "notifications"
                ? shown.map((p) => {
                const followed = !!followState[p.userId];
                const pending = !!requestState[p.userId] && !followed;
                return (
                  <Pressable key={p.userId} style={styles.row} onPress={() => setSelectedPerson(p)}>
                    <View style={styles.personTapArea}>
                      {p.photoUri ? (
                        <Image source={{ uri: p.photoUri }} style={styles.avatar} />
                      ) : (
                        <View style={styles.avatarFallback}>
                          <Text style={styles.avatarInitial}>{getInitial(p)}</Text>
                        </View>
                      )}
                      <View style={styles.meta}>
                        <Text style={styles.username}>{p.username}</Text>
                        {p.displayName ? <Text style={styles.detail}>{p.displayName}</Text> : null}
                        {p.email ? <Text style={styles.detail}>{p.email}</Text> : null}
                      </View>
                    </View>
                    <View style={styles.actions}>
                      <Pressable
                        onPress={() => onFollowPress(p)}
                        style={[styles.followBtn, followed && styles.followBtnOn, pending && styles.followBtnPending, busyId === p.userId && styles.disabled]}
                      >
                        <Text style={styles.followTxt}>
                          {followed ? "Takip Edilen" : pending ? "Beklemede" : "Takip Et"}
                        </Text>
                      </Pressable>
                      <Pressable onPress={() => onOpenCompose?.(p)} style={styles.msgBtn}>
                        <Text style={styles.msgTxt}>Mesaj</Text>
                      </Pressable>
                    </View>
                  </Pressable>
                );
              })
                : requestItems.map((r) => (
                  <View key={r.fromUserId} style={styles.row}>
                    {r.fromPhotoUri ? (
                      <Image source={{ uri: r.fromPhotoUri }} style={styles.avatar} />
                    ) : (
                      <View style={styles.avatarFallback}>
                        <Text style={styles.avatarInitial}>{(r.fromUsername || "@k").replace(/^@/, "").slice(0, 1).toUpperCase()}</Text>
                      </View>
                    )}
                    <View style={styles.meta}>
                      <Text style={styles.username}>{r.fromUsername}</Text>
                      <Text style={styles.detail}>Takip isteği gönderdi.</Text>
                    </View>
                    <View style={styles.actions}>
                      <Pressable style={[styles.followBtnOn, styles.actionBtn]} onPress={() => onRequestAction(r, true)}>
                        <Text style={styles.followTxt}>Onayla</Text>
                      </Pressable>
                      <Pressable style={[styles.rejectBtn, styles.actionBtn]} onPress={() => onRequestAction(r, false)}>
                        <Text style={styles.followTxt}>Reddet</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              {!(tab === "notifications" ? requestItems.length : shown.length) ? (
                <Text style={styles.empty}>
                  {tab === "following"
                    ? "Henüz kimseyi takip etmiyorsunuz. Arama ile kullanıcı ekleyebilirsiniz."
                    : tab === "followers"
                      ? "Henüz takipçi bulunmuyor."
                      : tab === "notifications"
                        ? "Şu an takip isteği bulunmuyor."
                        : "Arama sonucu bulunamadı."}
                </Text>
              ) : null}
            </ScrollView>
          {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
        </View>
      </SafeAreaView>
      <SocialProfileModal
        visible={!!selectedPerson}
        person={selectedPerson}
        followRequested={!!(selectedPerson && requestState[selectedPerson.userId] && !followState[selectedPerson.userId])}
        followed={!!(selectedPerson && followState[selectedPerson.userId])}
        blocked={!!(selectedPerson && blockedMap[selectedPerson.userId])}
        onClose={() => setSelectedPerson(null)}
        onMessage={(p) => onOpenCompose?.(p)}
        onFollow={(p) => onFollowPress(p)}
        onBlockToggle={(p, nextBlocked) => onToggleBlock(p, nextBlocked)}
      />
      <Modal visible={advancedOpen} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setAdvancedOpen(false)}>
          <SafeAreaView style={styles.advancedCard}>
            <View style={styles.header}>
              <Text style={styles.title}>Detaylı Arama</Text>
              <Pressable onPress={() => setAdvancedOpen(false)} style={styles.iconBtn}>
                <Text style={styles.closeTxt}>✕</Text>
              </Pressable>
            </View>
            <Text style={styles.fieldLabel}>Kurum / Firma</Text>
            <TextInput
              value={company}
              onChangeText={setCompany}
              style={styles.search}
              placeholder="Örn: ABC Ltd."
              placeholderTextColor={palette.textMuted}
            />
            <Text style={styles.fieldLabel}>Üniversite</Text>
            <TextInput
              value={university}
              onChangeText={setUniversity}
              style={styles.search}
              placeholder="Örn: İstanbul Üniversitesi"
              placeholderTextColor={palette.textMuted}
            />
            <Text style={styles.fieldLabel}>Şehir</Text>
            <TextInput
              value={city}
              onChangeText={setCity}
              style={styles.search}
              placeholder="Şehir seçin"
              placeholderTextColor={palette.textMuted}
            />
            <Pressable
              style={styles.advancedSearchBtn}
              onPress={() => {
                setAdvancedOpen(false);
                doSearch();
              }}
            >
              <Text style={styles.advancedSearchTxt}>Ara</Text>
            </Pressable>
          </SafeAreaView>
        </Pressable>
      </Modal>
    </Modal>
  );
}
