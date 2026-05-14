import { registerRootComponent } from "expo";
import { LogBox } from "react-native";
import App from "./App";

/* Expo Go Android’da uzak push yok — başka kod yolu tetiklerse bile LogBox şeridi gösterme */
if (__DEV__) {
  LogBox.ignoreLogs([
    "expo-notifications: Android Push notifications (remote notifications) functionality provided by expo-notifications was removed",
  ]);
}

registerRootComponent(App);
