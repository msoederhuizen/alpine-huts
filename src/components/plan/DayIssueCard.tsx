/**
 * One day whose targets couldn't be met: orange day badge, then a plain sentence
 * naming the day, then the specific reasons.
 *
 * Shared deliberately. The fallback notice and the alternatives carousel used to
 * render this markup separately, and they drifted the moment one of them gained
 * the "Day N" heading — the badge alone reads fine if you built the feature, but
 * a bare orange "3" doesn't tell a new user it means day 3.
 */
import { StyleSheet, Text, View } from 'react-native';

import { COLORS, RADIUS } from '../../constants/theme';
import type { DayCompromise } from '../../utils/planRoute';

export function DayIssueCard({ compromise }: { compromise: DayCompromise }) {
  return (
    <View style={styles.dayCard}>
      <View style={styles.dayBadge}>
        <Text style={styles.dayBadgeText}>{compromise.day}</Text>
      </View>
      <View style={styles.dayIssueList}>
        <Text style={styles.dayIssueHeading}>
          Day {compromise.day} doesn’t meet your target
        </Text>
        {compromise.issues.map((issue, i) => (
          <View key={i} style={styles.dayIssueRow}>
            <View style={styles.dayIssueBullet} />
            <Text style={styles.dayIssueText}>{issue}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dayCard: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.md,
    padding: 12,
    marginBottom: 8,
  },
  dayBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.trail,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayBadgeText: { color: 'white', fontWeight: '700', fontSize: 13 },
  dayIssueList: { flex: 1, gap: 5 },
  dayIssueRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  // A small bullet dot, nudged down to sit on the text's first line rather
  // than centred against the whole (possibly wrapped) block.
  dayIssueBullet: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#b5651d',
    marginTop: 6,
  },
  dayIssueText: { flex: 1, fontSize: 13, color: '#555', lineHeight: 18 },
  dayIssueHeading: {
    fontSize: 13.5,
    fontWeight: '700',
    color: COLORS.ink,
    marginBottom: 5,
  },
});
