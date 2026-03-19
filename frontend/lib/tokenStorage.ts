/**
 * Platform-agnostic token storage.
 * - Web: localStorage (survives page refresh)
 * - Native: expo-secure-store (encrypted on device)
 */

import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const KEY = "access_token";

async function set(value: string): Promise<void> {
  if (Platform.OS === "web") {
    localStorage.setItem(KEY, value);
  } else {
    await SecureStore.setItemAsync(KEY, value);
  }
}

async function get(): Promise<string | null> {
  if (Platform.OS === "web") {
    return localStorage.getItem(KEY);
  } else {
    return SecureStore.getItemAsync(KEY);
  }
}

async function remove(): Promise<void> {
  if (Platform.OS === "web") {
    localStorage.removeItem(KEY);
  } else {
    await SecureStore.deleteItemAsync(KEY);
  }
}

export const tokenStorage = { set, get, remove };
