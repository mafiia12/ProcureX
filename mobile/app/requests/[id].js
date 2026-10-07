import { useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import ActionsPlaceholder from '../../components/ActionsPlaceholder';
import Card from '../../components/Card';
import ErrorBanner from '../../components/ErrorBanner';
import InfoRow from '../../components/InfoRow';
import Screen from '../../components/Screen';
import SectionTitle from '../../components/SectionTitle';
import SkeletonLoader from '../../components/SkeletonLoader';
import StatusBadge from '../../components/StatusBadge';
import { COLORS, FONT, SPACING } from '../../constants/theme';
import useApiData from '../../hooks/useApiData';
import { requestsAPI } from '../../services/api';
import {
  formatCount,
  formatDate,
  formatDateTime,
  formatQuantity,
  statusLabel,
} from '../../utils/formatters';

// Shape: GET /api/internal/incoming-purchase-requests/{id} → incoming_requests._detail
function ItemRow({ item, last }) {
  return (
    <View style={[styles.item, last && styles.itemLast]}>
      <View style={styles.itemTop}>
        <Text style={styles.itemName}>{item.product_name || '—'}</Text>
        <Text style={styles.itemQty}>
          {formatQuantity(item.quantity)} {item.unit || ''}
        </Text>
      </View>
      {item.preferred_brand || item.specifications ? (
        <Text style={styles.itemSpec} numberOfLines={3}>
          {[item.preferred_brand, item.specifications].filter(Boolean).join(' · ')}
        </Text>
      ) : null}
      <View style={styles.itemBottom}>
        <StatusBadge kind="item" value={item.review_status} small />
        {item.review_reason ? (
          <Text style={styles.itemReason} numberOfLines={2}>
            {item.review_reason}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function Timeline({ history }) {
  return (
    <View>
      {history.map((entry, index) => {
        const last = index === history.length - 1;
        return (
          <View key={entry.id || index} style={styles.tlRow}>
            <View style={styles.tlRail}>
              <View style={[styles.tlDot, last && styles.tlDotCurrent]} />
              {!last ? <View style={styles.tlLine} /> : null}
            </View>
            <View style={styles.tlBody}>
              <Text style={styles.tlTitle}>
                {entry.from_status
                  ? `${statusLabel('request', entry.from_status)} ← ${statusLabel('request', entry.to_status)}`
                  : statusLabel('request', entry.to_status)}
              </Text>
              <Text style={styles.tlMeta}>
                {[formatDateTime(entry.created_at), entry.changed_by].filter(Boolean).join(' · ')}
              </Text>
              {entry.note ? <Text style={styles.tlNote}>{entry.note}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

export default function RequestDetailScreen() {
  const { id } = useLocalSearchParams();
  const fetchRequest = useCallback(async () => (await requestsAPI.get(id)).data, [id]);
  const { data: request, loading, refreshing, error, refresh } = useApiData(fetchRequest, 'خطأ في تحميل الطلب');

  const items = request?.items || [];
  const history = request?.status_history || [];
  const notes = request?.internal_notes || [];

  return (
    <Screen title={request?.request_number || 'طلب شراء'} subtitle="تفاصيل طلب الشراء" back>
      {loading ? (
        <SkeletonLoader variant="detail" count={4} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={COLORS.text} />}
        >
          <ErrorBanner message={error} onRetry={refresh} />
          {request ? (
            <>
              <View style={styles.badges}>
                <StatusBadge kind="request" value={request.status} />
                <StatusBadge kind="priority" value={request.priority} />
              </View>

              <Card>
                <InfoRow label="المشروع" value={request.project_name} />
                <InfoRow label="العميل" value={request.customer_name || request.company_name} />
                <InfoRow label="مقدم الطلب" value={request.requester_name} />
                <InfoRow label="الهاتف" value={request.phone_number || request.whatsapp_number} />
                <InfoRow label="موقع التسليم" value={request.delivery_location || request.project_location} />
                <InfoRow label="تاريخ التسليم المطلوب" value={formatDate(request.required_delivery_date)} />
                <InfoRow label="تاريخ الطلب" value={formatDateTime(request.created_at)} />
                <InfoRow label="الموظف المسؤول" value={request.assigned_employee} />
                <InfoRow
                  label="أمر الشراء الداخلي"
                  value={request.converted_document?.document_number}
                  last
                />
              </Card>

              {request.notes ? (
                <>
                  <SectionTitle title="ملاحظات الطلب" />
                  <Card>
                    <Text style={styles.paragraph}>{request.notes}</Text>
                  </Card>
                </>
              ) : null}

              <SectionTitle title="البنود" hint={formatCount(items.length)} />
              <Card>
                {items.length ? (
                  items.map((item, index) => (
                    <ItemRow key={item.id} item={item} last={index === items.length - 1} />
                  ))
                ) : (
                  <Text style={styles.empty}>لا توجد بنود</Text>
                )}
              </Card>

              {history.length ? (
                <>
                  <SectionTitle title="سجل الحالة" />
                  <Card>
                    <Timeline history={history} />
                  </Card>
                </>
              ) : null}

              {notes.length ? (
                <>
                  <SectionTitle title="ملاحظات داخلية" hint={formatCount(notes.length)} />
                  {notes.map((note) => (
                    <Card key={note.id}>
                      <Text style={styles.paragraph}>{note.note}</Text>
                      <Text style={styles.tlMeta}>
                        {[note.author, formatDateTime(note.created_at)].filter(Boolean).join(' · ')}
                      </Text>
                    </Card>
                  ))}
                </>
              ) : null}

              {/* PHASE 2: request actions (review / assign / convert) go here. */}
              <ActionsPlaceholder />
            </>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: SPACING.md, paddingBottom: SPACING.xl },
  badges: { flexDirection: 'row-reverse', gap: SPACING.sm, marginBottom: SPACING.sm + SPACING.xs },
  paragraph: { color: COLORS.textSecondary, textAlign: 'right', lineHeight: 22 },
  empty: { color: COLORS.muted, textAlign: 'center', paddingVertical: SPACING.sm },
  item: {
    paddingVertical: SPACING.sm + 2,
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemLast: { borderBottomWidth: 0 },
  itemTop: { flexDirection: 'row-reverse', justifyContent: 'space-between', gap: SPACING.sm },
  itemName: { flex: 1, color: COLORS.text, fontWeight: '600', fontSize: FONT.md, textAlign: 'right' },
  itemQty: { color: COLORS.text, fontWeight: '700', fontSize: FONT.md },
  itemSpec: { color: COLORS.muted, fontSize: FONT.sm + 1, textAlign: 'right', marginTop: SPACING.xxs },
  itemBottom: { flexDirection: 'row-reverse', alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.xs + 2 },
  itemReason: { flex: 1, color: COLORS.warning, fontSize: FONT.sm, textAlign: 'right' },
  tlRow: { flexDirection: 'row-reverse' },
  tlRail: { width: 20, alignItems: 'center' },
  tlDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.border, marginTop: 5 },
  tlDotCurrent: { backgroundColor: COLORS.accent },
  tlLine: { flex: 1, width: 2, backgroundColor: COLORS.border, marginVertical: 2 },
  tlBody: { flex: 1, paddingBottom: SPACING.md, paddingRight: SPACING.sm },
  tlTitle: { color: COLORS.text, fontWeight: '600', textAlign: 'right' },
  tlMeta: { color: COLORS.muted, fontSize: FONT.sm, textAlign: 'right', marginTop: SPACING.xxs },
  tlNote: { color: COLORS.textSecondary, fontSize: FONT.sm + 1, textAlign: 'right', marginTop: SPACING.xs },
});
