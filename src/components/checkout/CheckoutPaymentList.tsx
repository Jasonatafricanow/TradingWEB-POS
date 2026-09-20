import React from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import type { Customer, Payment } from '@/api';
import { Card } from '@/components/ui';
import { useI18n } from '@/i18n';
import { colors, font } from '@/theme';
import { formatCents } from '@/utils/money';

export type CheckoutPayment = Payment & { changeCents?: number };

export function CheckoutCustomerCard({ customer }: { customer: Customer | null }) {
  const { t } = useI18n();
  if (!customer) return null;

  return (
    <Card>
      <Text testID="checkout-customer" style={{ color: colors.text, fontSize: font.md, fontWeight: '600' }}>
        {t('cart.customer_selected', { name: customer.name })}
      </Text>
      {customer.phone ? (
        <Text style={{ color: colors.sub, fontSize: font.sm, marginTop: 4 }}>{customer.phone}</Text>
      ) : null}
    </Card>
  );
}

export function CheckoutPaymentList({
  payments,
  symbol,
  onRemove,
}: {
  payments: CheckoutPayment[];
  symbol: string;
  onRemove: (index: number) => void;
}) {
  const { t } = useI18n();
  if (payments.length === 0) return null;

  const confirmRemove = (payment: CheckoutPayment, index: number) => {
    Alert.alert(
      t('checkout.remove_payment_title'),
      t('checkout.remove_payment_body', {
        label: payment.label,
        amount: formatCents(payment.amountCents, symbol),
      }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('cart.remove'), style: 'destructive', onPress: () => onRemove(index) },
      ],
    );
  };

  return (
    <Card>
      {payments.map((payment, index) => (
        <View key={`${payment.method}-${index}`} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 }}>
          <Text style={{ color: colors.text, fontSize: font.md }}>
            {payment.ref
              ? t('checkout.payment_label_with_ref', { label: payment.label, ref: payment.ref })
              : payment.label}
          </Text>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <Text style={{ fontWeight: '700', color: colors.text }}>{formatCents(payment.amountCents, symbol)}</Text>
            <Pressable
              testID={`remove-payment-${index}`}
              accessibilityRole="button"
              accessibilityLabel={t('checkout.remove_payment_accessibility', { label: payment.label })}
              onPress={() => confirmRemove(payment, index)}
              hitSlop={8}
            >
              <Text style={{ color: colors.danger }}>{t('cart.remove')}</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </Card>
  );
}
