/**
 * 1) onSocialNotificationCreated — socialNotifications
 * 2) onChatMessageCreated — doğrudan `messages` koleksiyonu (DM push, çift yol yok)
 * Deploy: firebase deploy --only functions
 */
const functions = require("firebase-functions");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const ANDROID_CHANNEL_ID = "finansepeti_default";

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function postExpoBatches(messages) {
  if (!messages.length) return;
  for (const batch of chunk(messages, 99)) {
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch),
      });
      const text = await res.text();
      if (!res.ok) {
        functions.logger.error("expo_push_http_error", res.status, text);
      } else {
        try {
          const json = JSON.parse(text);
          const errors = (json.data || []).filter((x) => x.status === "error");
          if (errors.length) functions.logger.warn("expo_push_partial_error", errors);
        } catch {
          /* noop */
        }
      }
    } catch (e) {
      functions.logger.error("expo_push_fetch_failed", e);
    }
  }
}

async function loadExpoMessagesForUser(toUserId, title, body, dataExtra = {}) {
  const devicesSnap = await admin
    .firestore()
    .collection("userPushTokens")
    .doc(toUserId)
    .collection("devices")
    .get();

  if (devicesSnap.empty) {
    functions.logger.info("push: no devices", { toUserId });
    return [];
  }

  const messages = [];
  for (const doc of devicesSnap.docs) {
    const token = doc.data().expoPushToken;
    if (!token || typeof token !== "string") continue;
    messages.push({
      to: token,
      title,
      body,
      sound: "default",
      priority: "high",
      channelId: ANDROID_CHANNEL_ID,
      data: dataExtra,
    });
  }
  return messages;
}

function buildSocialNotificationText(data) {
  const from = String(data.fromUsername || "FinansSepeti").trim() || "FinansSepeti";
  const type = String(data.type || "");
  let title = "FinansSepeti";
  let body = "Yeni bildirim";
  if (type === "comment_mention") {
    title = from;
    body = data.topic ? `Sizi etiketledi · ${data.topic}` : "Sizi bir yorumda etiketledi.";
  } else if (type === "comment_like") {
    title = from;
    body = "Yorumunuzu beğendi.";
  } else if (type === "comment_favorite") {
    title = from;
    body = "Yorumunuzu favorilere ekledi.";
  } else if (type === "comment_reply") {
    title = from;
    body = data.topic
      ? `Yorumunuza yanıt verdi · ${data.topic}`
      : `Yorumunuza yanıt: ${String(data.textPreview || "").slice(0, 100)}`;
  } else if (type === "follow_request") {
    title = from;
    body = "Takip isteği gönderdi.";
  } else if (type === "follow_accepted") {
    title = from;
    body = "Takip isteğinizi kabul etti.";
  } else {
    title = from;
    const prev = String(data.textPreview || "").slice(0, 120);
    body = prev || body;
  }
  return { title, body };
}

exports.onSocialNotificationCreated = functions.firestore
  .document("socialNotifications/{notifId}")
  .onCreate(async (snap) => {
    const data = snap.data() || {};
    const toUserId = data.toUserId;
    if (!toUserId || typeof toUserId !== "string") return null;

    const fromUserId = data.fromUserId;
    if (fromUserId && fromUserId === toUserId) return null;

    const { title, body } = buildSocialNotificationText(data);
    const messages = await loadExpoMessagesForUser(toUserId, title, body, {
      type: String(data.type || ""),
      notificationId: snap.id,
    });

    if (!messages.length) return null;
    await postExpoBatches(messages);
    return null;
  });

/** Özel mesaj (web/mobil `messages` koleksiyonu) — ayrı tetikleyici, etiket bildirimiyle çakışmaz */
exports.onChatMessageCreated = functions.firestore.document("messages/{msgId}").onCreate(async (snap) => {
  const d = snap.data() || {};
  const toUserId = d.toUserId;
  const fromUserId = d.fromUserId;
  if (!toUserId || typeof toUserId !== "string" || !fromUserId || fromUserId === toUserId) return null;

  const preview = String(d.text || "").trim().slice(0, 140);
  const body = preview || (d.imageUrl ? "[Fotoğraf]" : d.videoUrl ? "[Video]" : d.audioUrl ? "[Ses]" : "Yeni mesaj");
  const title = "Yeni mesaj";
  const messages = await loadExpoMessagesForUser(toUserId, title, body, {
    type: "dm",
    messageId: snap.id,
  });
  if (!messages.length) return null;
  await postExpoBatches(messages);
  return null;
});
