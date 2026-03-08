import React from "react";
import { View, StyleSheet } from "react-native";
import { ActivityIndicator, Text, Button } from "react-native-paper";

interface Props {
  loading: boolean;
  error: Error | null;
  onRetry?: () => void;
}

export function LoadingOrError({ loading, error, onRetry }: Props) {
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error.message}</Text>
        {onRetry && (
          <Button mode="contained" onPress={onRetry} style={styles.retryBtn}>
            Retry
          </Button>
        )}
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  errorText: {
    color: "#cf6679",
    textAlign: "center",
    marginBottom: 16,
  },
  retryBtn: {
    marginTop: 8,
  },
});
