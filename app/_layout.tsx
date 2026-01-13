import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import "react-native-get-random-values";

import { Amplify } from "aws-amplify";
import { amplifyConfig } from "../src/amplifyConfig";

import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { getCurrentUser } from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";
import { Stack, router, useRootNavigationState, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { useColorScheme } from "@/hooks/use-color-scheme";

Amplify.configure(amplifyConfig);

export const unstable_settings = {
  anchor: "(tabs)",
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  // null = checking, true = signed in, false = signed out
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null);

  const segments = useSegments();
  const navState = useRootNavigationState();

  // 1) Check auth once on app start
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await getCurrentUser();
        if (!cancelled) setIsAuthed(true);
      } catch {
        if (!cancelled) setIsAuthed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 2) Listen for sign-in / sign-out events
  useEffect(() => {
    const unsub = Hub.listen("auth", ({ payload }) => {
      if (payload.event === "signedIn") setIsAuthed(true);
      if (payload.event === "signedOut") setIsAuthed(false);
    });
    return () => unsub();
  }, []);

  // 3) Redirect once navigation is ready and auth state known
  useEffect(() => {
    if (!navState?.key) return;
    if (isAuthed === null) return;

    const inAuthRoute = segments[0] === "sign-in";

    if (!isAuthed && !inAuthRoute) router.replace("/sign-in");
    if (isAuthed && inAuthRoute) router.replace("/(tabs)");
  }, [navState?.key, isAuthed, segments]);

  // Optional: show a tiny loader while checking auth to avoid flicker
  if (isAuthed === null) {
    return (
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator />
        </View>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: "modal", title: "Modal" }} />
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
