import React, { Suspense, lazy, useEffect, useState } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { RootStackParamList } from "./src/navigation/types";
import { LoginScreen } from "./src/screens/LoginScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { ResetPasswordScreen } from "./src/screens/ResetPasswordScreen";
import { isLoggedIn } from "./src/lib/authSession";
import { ensureFirestoreAuthReady, isFirebaseConfigured } from "./src/lib/firebaseClient";
import { AppThemeProvider, useAppTheme } from "./src/theme/ThemeProvider";
import { initPushNotificationRuntime } from "./src/lib/pushNotifications";

const PrivacyScreen = lazy(async () => {
  const m = await import("./src/screens/PrivacyScreen");
  return { default: m.PrivacyScreen };
});
const AnalizlerScreen = lazy(async () => {
  const m = await import("./src/screens/AnalizlerScreen");
  return { default: m.AnalizlerScreen };
});

const Stack = createNativeStackNavigator<RootStackParamList>();

function ThemedBootScreen() {
  const { palette } = useAppTheme();
  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: palette.background,
      }}
    >
      <ActivityIndicator size="large" color={palette.accent} />
      <Text style={{ marginTop: 16, color: palette.textMuted, fontSize: 14 }}>Yükleniyor…</Text>
    </View>
  );
}

function ThemedSuspenseFallback() {
  const { palette } = useAppTheme();
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: palette.background }}>
      <ActivityIndicator size="large" color={palette.accent} />
    </View>
  );
}

function ThemedStatusBar() {
  const { isLight } = useAppTheme();
  return <StatusBar style={isLight ? "dark" : "light"} />;
}

function AppNavigator({ initialRoute }: { initialRoute: "Login" | "Home" }) {
  return (
    <>
      <ThemedStatusBar />
      <Suspense fallback={<ThemedSuspenseFallback />}>
        <Stack.Navigator
          initialRouteName={initialRoute}
          screenOptions={{
            headerShown: false,
            animation: "default",
          }}
        >
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Privacy" component={PrivacyScreen} />
          <Stack.Screen name="Analizler" component={AnalizlerScreen} />
        </Stack.Navigator>
      </Suspense>
    </>
  );
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [initialRoute, setInitialRoute] = useState<"Login" | "Home">("Login");
  const [firebaseDevBanner, setFirebaseDevBanner] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const bootTimeoutMs = 8000;
    void (async () => {
      const result = await Promise.race([
        isLoggedIn().then((loggedIn) => ({ kind: "ok" as const, loggedIn })),
        new Promise<{ kind: "timeout" }>((resolve) =>
          setTimeout(() => resolve({ kind: "timeout" }), bootTimeoutMs),
        ),
      ]);
      if (!alive) return;
      if (result.kind === "ok" && result.loggedIn) setInitialRoute("Home");
      if (result.kind === "timeout" && __DEV__) {
        console.warn("[App] Oturum okuması zaman aşımı; Login ekranına geçiliyor.");
      }
      setBooting(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    initPushNotificationRuntime();
  }, []);

  useEffect(() => {
    if (booting) return;
    if (!isFirebaseConfigured()) {
      const msg =
        "Geliştirme: EXPO_PUBLIC_FIREBASE_API_KEY / PROJECT_ID yok — mesaj ve yorum Firebase’e gitmez (.env).";
      if (__DEV__) {
        setFirebaseDevBanner(msg);
        console.warn("[App]", msg);
      }
      return;
    }
    void ensureFirestoreAuthReady()
      .then(() => setFirebaseDevBanner(null))
      .catch((e) => {
        const text = e instanceof Error ? e.message : String(e);
        console.warn("[App] Firebase anonim oturum:", text);
        if (__DEV__) setFirebaseDevBanner(text);
      });
  }, [booting]);

  return (
    <SafeAreaProvider>
      <AppThemeProvider>
        {booting ? (
          <ThemedBootScreen />
        ) : (
          <View style={{ flex: 1 }}>
            <NavigationContainer>
              <AppNavigator initialRoute={initialRoute} />
            </NavigationContainer>
            {__DEV__ && firebaseDevBanner ? (
              <View
                pointerEvents="none"
                style={{
                  position: "absolute",
                  left: 8,
                  right: 8,
                  top: 48,
                  padding: 10,
                  borderRadius: 8,
                  backgroundColor: "rgba(176,0,32,0.92)",
                  zIndex: 9999,
                }}
              >
                <Text style={{ color: "#fff", fontSize: 12 }}>{firebaseDevBanner}</Text>
              </View>
            ) : null}
          </View>
        )}
      </AppThemeProvider>
    </SafeAreaProvider>
  );
}
