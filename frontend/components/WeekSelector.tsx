import React from "react";
import { View, StyleSheet } from "react-native";
import { SegmentedButtons } from "react-native-paper";

interface Props {
  value: number;
  onChange: (week: number) => void;
}

export function WeekSelector({ value, onChange }: Props) {
  return (
    <View style={styles.container}>
      <SegmentedButtons
        value={String(value)}
        onValueChange={(v) => onChange(Number(v))}
        buttons={[
          { value: "21", label: "Week 21" },
          { value: "22", label: "Week 22" },
          { value: "23", label: "Week 23" },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginVertical: 12,
  },
});
