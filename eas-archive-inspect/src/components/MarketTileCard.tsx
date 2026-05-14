import React, { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useAppTheme } from "../theme/ThemeProvider";
import { createMarketTileStyles } from "./marketTileCardStyles";

function ChartGlyph({ size = 15, stroke }: { size?: number; stroke: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M4 19h16M4 15l4-4 4 3 8-9"
        fill="none"
        stroke={stroke}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export type MarketTileCardProps = {
  title: string;
  value: string;
  changeText: string;
  positive: boolean;
  showAdd: boolean;
  showChart: boolean;
  onAdd: () => void;
  onChart: () => void;
  /** Ana sayfa gibi tek ekrana sığdırma için daha sıkı düzen */
  compact?: boolean;
  /** TEFAS vb.: kod altında kısa açıklama (ana sayfa compact kutularında kullanılmaz). */
  subtitle?: string;
  /** Piyasalar ızgarasında satırdaki en yüksek kartla aynı yüksekliği doldurur. */
  expandInGrid?: boolean;
};

export function MarketTileCard({
  title,
  value,
  changeText,
  positive,
  showAdd,
  showChart,
  onAdd,
  onChart,
  compact,
  subtitle,
  expandInGrid,
}: MarketTileCardProps) {
  const { palette, isLight } = useAppTheme();
  const styles = useMemo(() => createMarketTileStyles(palette, isLight), [palette, isLight]);
  const c = !!compact;
  const chartStroke = isLight ? palette.textMuted : "#e2e8f0";

  return (
    <View
      style={[
        styles.card,
        c && styles.cardCompact,
        subtitle && !c && styles.cardWithSubtitle,
        !c && expandInGrid ? styles.cardExpandInGrid : null,
      ]}
    >
      <View style={[styles.cardTopRow, c && styles.cardTopRowCompact]}>
        <Text
          style={[styles.cardTitle, styles.cardTitleFlex, c && styles.cardTitleCompact]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.82}
        >
          {title}
        </Text>
        {showAdd ? (
          <Pressable
            style={[styles.addFabInner, c && styles.addFabInnerCompact]}
            onPress={onAdd}
            hitSlop={6}
            accessibilityLabel="Yatırım ekle"
          >
            <Text style={[styles.addFabText, c && styles.addFabTextCompact]}>+</Text>
          </Pressable>
        ) : null}
      </View>
      {subtitle && !c ? (
        <Text style={styles.cardSubtitle} numberOfLines={2}>
          {subtitle}
        </Text>
      ) : null}
      <Text
        style={[styles.cardValue, c && styles.cardValueCompact, subtitle && !c ? styles.cardValueAfterSubtitle : null]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.72}
      >
        {value}
      </Text>
      <View style={[styles.cardBottomRow, c && styles.cardBottomRowCompact]}>
        <Text style={[styles.cardChange, c && styles.cardChangeCompact, positive ? styles.up : styles.down]} numberOfLines={1}>
          {changeText}
        </Text>
        {showChart ? (
          <Pressable style={[styles.chartFabInner, c && styles.chartFabInnerCompact]} onPress={onChart} hitSlop={6} accessibilityLabel="Grafik">
            <ChartGlyph size={c ? 15 : 16} stroke={chartStroke} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
