import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { Button, HelperText, Text, TextInput, useTheme } from "react-native-paper";
import { useRouter } from "expo-router";
import { useAuth } from "../lib/authContext";

export default function RegisterScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { register } = useAuth();

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRegister = async () => {
    if (!email.trim() || !username.trim() || !password) return;
    setError(null);
    setLoading(true);
    try {
      await register(email.trim(), username.trim(), password);
      // RouteGuard handles redirect after successful register+login
    } catch (e: any) {
      setError(e.message ?? "Registration failed.");
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = email.trim().length > 0 && username.trim().length >= 3 && password.length >= 8;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.root, { backgroundColor: theme.colors.background }]}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Fantasy Playoff</Text>
        <Text style={styles.subtitle}>Create your account</Text>

        <TextInput
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          mode="outlined"
          style={styles.input}
          disabled={loading}
        />

        <TextInput
          label="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          mode="outlined"
          style={styles.input}
          disabled={loading}
        />
        <HelperText type="info" visible={username.length > 0 && username.length < 3}>
          At least 3 characters
        </HelperText>

        <TextInput
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          mode="outlined"
          style={styles.input}
          disabled={loading}
          right={
            <TextInput.Icon
              icon={showPassword ? "eye-off" : "eye"}
              onPress={() => setShowPassword((v) => !v)}
            />
          }
        />
        <HelperText type="info" visible={password.length > 0 && password.length < 8}>
          At least 8 characters
        </HelperText>

        {error && <HelperText type="error" visible>{error}</HelperText>}

        <Button
          mode="contained"
          onPress={handleRegister}
          loading={loading}
          disabled={loading || !canSubmit}
          style={styles.btn}
          contentStyle={styles.btnContent}
        >
          Create Account
        </Button>

        <Button
          mode="text"
          onPress={() => router.replace("/login" as any)}
          disabled={loading}
          style={styles.switchBtn}
        >
          Already have an account? Sign In
        </Button>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 400,
  },
  title: {
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -0.5,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 14,
    color: "#888",
    marginBottom: 20,
  },
  input: {
    marginBottom: 2,
  },
  btn: {
    marginTop: 12,
    borderRadius: 10,
  },
  btnContent: {
    paddingVertical: 4,
  },
  switchBtn: {
    marginTop: 4,
  },
});
