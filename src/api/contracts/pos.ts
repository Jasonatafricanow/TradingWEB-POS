export interface PosApiErrorBody {
  error: { code: string; message: string; retryable: boolean; details?: unknown };
}

export interface PosCheckoutRequestV1 {
  idempotency_key: string;
  store_id: string;
  currency: string;
  staff_id: string;
  customer_id: string | null;
  note: string | null;
  fulfillment: {
    method: 'in_store' | 'pickup' | 'ship';
    contact_name?: string;
    phone?: string;
    address?: string;
    pickup_at?: string;
  };
  items: {
    product_id: string;
    variant_id: string | null;
    quantity: number;
    line_discount: string;
  }[];
  order_discount: string;
  pricing_preview: { subtotal: string; discount: string; tax: string; total: string };
  pricing_version: string;
  payments: {
    method: string;
    label: string;
    amount: string;
    reference: string | null;
  }[];
}

export interface PosOrderDto {
  id: string;
  order_no: string;
  created_at: string;
  source: 'pos';
  status: string;
  financial_status: string;
  fulfillment_status: string;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  total: string;
  refunded_total: string;
  items: {
    id: string;
    product_id: string;
    variant_id: string | null;
    name: string;
    sku: string | null;
    quantity: number;
    unit_price: string;
    line_discount: string;
    delivery_method: string;
  }[];
  payments: {
    method: string;
    label: string;
    amount: string;
    reference: string | null;
  }[];
}

/** TradingWEB master@073a305 的实际 bootstrap 契约。 */
export interface PosBootstrapDto {
  contract_version: 'pos-v1';
  store: { id: string; name: string };
  currency: string;
  tax_rate: string;
  promotions: unknown[];
  pricing_version: string;
  payment_methods: { code: string; label: string; type: string }[];
  operator_session_ttl_seconds: number;
  approval_ttl_seconds: number;
}

export interface PosOperatorSessionDto {
  token: string;
  operator: {
    accountUserId: string;
    staffId: string;
    storeId: string;
    deviceId: string;
    permissions: string[];
  };
  expiresAt: string;
}
