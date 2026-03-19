import { Stack, useRouter, useSegments } from "expo-router";
import { PaperProvider, MD3DarkTheme, MD3LightTheme } from "react-native-paper";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useEffect } from "react";
import { ActiveTeamProvider } from "../lib/activeTeamContext";
import { AuthProvider, useAuth } from "../lib/authContext";
import { setTokenRefreshCallback } from "../lib/api";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
});

// ---------------------------------------------------------------------------
// Route guard — runs inside AuthProvider so it can read auth state
// ---------------------------------------------------------------------------
function RouteGuard({ children }: { children: React.ReactNode }) {
  const { token, loading, _setToken } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // Wire the token refresh callback into authContext
  useEffect(() => {
    setTokenRefreshCallback(_setToken);
  }, [_setToken]);

  useEffect(() => {
    if (loading) return;

    const seg = segments[0] as string;
    const onAuthScreen = seg === "login" || seg === "register";

    if (!token && !onAuthScreen) {
      router.replace("/login" as any);
    } else if (token && onAuthScreen) {
      router.replace("/(tabs)");
    }
  }, [token, loading, segments, router]);

  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// Root layout
// ---------------------------------------------------------------------------
export default function RootLayout() {
  const colorScheme = useColorScheme();
  const theme = colorScheme === "dark" ? MD3DarkTheme : MD3LightTheme;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ActiveTeamProvider>
            <PaperProvider theme={theme}>
              <RouteGuard>
                <Stack screenOptions={{ headerShown: false }} />
              </RouteGuard>
            </PaperProvider>
          </ActiveTeamProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
