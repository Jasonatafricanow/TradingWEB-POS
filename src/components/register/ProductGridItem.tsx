import React, { memo, useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { Product } from '@/api';
import { Tag } from '@/components/ui';
import { formatPosMoney } from '@/i18n';
import type { Translator } from '@/i18n/core/catalog';
import type { Locale } from '@/i18n/core/locale';
import { colors, font, radius } from '@/theme';
import type { Currency } from '@/utils/money';

interface ProductGridItemProps {
  product: Product;
  columns: number;
  locale: Locale;
  currency: Currency;
  t: Translator;
  onPress: (product: Product) => void;
}

export const ProductGridItem = memo(function ProductGridItem({
  product,
  columns,
  locale,
  currency,
  t,
  onPress,
}: ProductGridItemProps) {
  const stock = useMemo(() => (
    product.hasVariants
      ? product.variants.reduce((sum, variant) => sum + (variant.stock ?? 0), 0)
      : product.stock
  ), [product]);

  return (
    <Pressable
      onPress={() => onPress(product)}
      style={({ pressed }) => ({
        flex: 1 / columns,
        margin: 4,
        backgroundColor: pressed ? colors.primarySoft : colors.card,
        borderRadius: radius.md,
        padding: 12,
        borderWidth: 1,
        borderColor: colors.border,
        minHeight: 96,
        justifyContent: 'space-between',
      })}
    >
      <Text numberOfLines={2} style={{ fontSize: font.sm, fontWeight: '600', color: colors.text }}>
        {product.name}
      </Text>
      <View>
        <Text style={{ fontSize: font.md, fontWeight: '700', color: colors.primary, marginTop: 6 }}>
          {product.priceCents !== null
            ? formatPosMoney(locale, product.priceCents, currency)
            : product.hasVariants
              ? t('catalog.multi_variant')
              : t('catalog.unpriced')}
        </Text>
        <View style={{ flexDirection: 'row', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
          {product.hasVariants && <Tag text={t('catalog.variant_count', { count: product.variants.length })} tone="primary" />}
          {stock !== null && stock <= 5 && (
            <Tag
              text={stock <= 0 ? t('catalog.out_of_stock') : t('catalog.stock_remaining', { count: stock })}
              tone={stock <= 0 ? 'danger' : 'warn'}
            />
          )}
        </View>
      </View>
    </Pressable>
  );
});
