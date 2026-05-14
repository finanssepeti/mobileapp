import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

type Props = {
  room: string;
  serverURL: string;
  displayName: string;
  onClose: () => void;
  onUnavailable: (message: string) => void;
};

type JitsiMeetingProps = {
  room: string;
  serverURL?: string;
  userInfo?: { displayName?: string };
  config?: Record<string, unknown>;
  flags?: Record<string, unknown>;
  eventListeners?: Record<string, (...args: unknown[]) => void>;
  style?: object;
};

let NativeJitsiMeeting: React.ComponentType<JitsiMeetingProps> | null = null;
try {
  const sdk = require("@jitsi/react-native-sdk");
  NativeJitsiMeeting = sdk?.JitsiMeeting ?? null;
} catch {
  NativeJitsiMeeting = null;
}

export function JitsiNativeMeeting({ room, serverURL, displayName, onClose, onUnavailable }: Props) {
  const styles = useMemo(
    () =>
      StyleSheet.create({
        unavailableWrap: {
          flex: 1,
          backgroundColor: "#0b1220",
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 20,
        },
        unavailableTitle: { color: "#f8fafc", fontSize: 16, fontWeight: "800", marginBottom: 8 },
        unavailableBody: { color: "#cbd5e1", fontSize: 13, textAlign: "center", lineHeight: 19, marginBottom: 14 },
        unavailableBtn: {
          borderRadius: 10,
          backgroundColor: "#2563eb",
          paddingHorizontal: 14,
          paddingVertical: 10,
        },
        unavailableBtnTxt: { color: "#fff", fontSize: 13, fontWeight: "800" },
      }),
    [],
  );

  if (!NativeJitsiMeeting) {
    return (
      <View style={styles.unavailableWrap}>
        <Text style={styles.unavailableTitle}>Native Jitsi bu derlemede yok</Text>
        <Text style={styles.unavailableBody}>
          Expo Go native Jitsi SDK acamaz. Dev build ile acildiginda tarayiciya gitmeden uygulama icinde calisir.
        </Text>
        <Pressable
          style={styles.unavailableBtn}
          onPress={() => onUnavailable("Native Jitsi bu derlemede bulunamadi. Expo Go yerine dev build kullanin.")}
        >
          <Text style={styles.unavailableBtnTxt}>WebView moduna don</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <NativeJitsiMeeting
      room={room}
      serverURL={serverURL}
      userInfo={{ displayName }}
      config={{
        prejoinConfig: { enabled: false },
        startWithAudioMuted: false,
        startWithVideoMuted: false,
      }}
      flags={{
        "call-integration.enabled": true,
        "invite.enabled": true,
        "pip.enabled": true,
      }}
      eventListeners={{
        onReadyToClose: onClose,
      }}
      style={{ flex: 1 }}
    />
  );
}
