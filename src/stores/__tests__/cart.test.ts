import { describe, it, expect, beforeEach } from 'vitest';
import { useCart, cartItemCount } from '../cart';
import type { ExchangeContext, HeldCart, CartLine } from '../cart';
import type { Product, ProductVariant, Customer } from '@/api/types';
import type { CartDiscount, LineDiscount } from '@/utils/money';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let customIdCounter = 0;

function makeVariant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: 'variant-100',
    productId: 'product-1',
    sku: 'VAR-SKU',
    barcode: null,
    priceCents: 2500,
    option1: 'Red',
    option2: 'L',
    option3: null,
    stock: 10,
    ...overrides,
  };
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product-1',
    name: 'Test Product',
    priceCents: 1000,
    type: 'physical',
    image: null,
    isActive: true,
    deliveryMethods: ['in_store'],
    hasVariants: false,
    variants: [],
    sku: 'PROD-SKU',
    barcode: null,
    stock: 20,
    ...overrides,
  };
}

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'customer-42',
    name: 'Test Customer',
    email: 'test@example.com',
    phone: '1234567890',
    ordersCount: 3,
    ...overrides,
  };
}

function makeExchangeContext(overrides: Partial<ExchangeContext> = {}): ExchangeContext {
  return {
    orderId: 'ord-1',
    orderNumber: 'ORD-001',
    creditCents: 5000,
    restock: true,
    items: [
      {
        productId: 'product-1',
        variantId: null,
        name: 'Returned Widget',
        variantLabel: null,
        sku: 'W-001',
        unitPriceCents: 5000,
        qty: 1,
      },
    ],
    ...overrides,
  };
}

function makeHeldCart(overrides: Partial<HeldCart> = {}): HeldCart {
  return {
    id: `h${Date.now()}${++customIdCounter}`,
    name: 'Held cart',
    at: Date.now(),
    lines: [
      {
        key: 'pproduct-10:0',
        productId: 'product-10',
        variantId: null,
        name: 'Held Item',
        variantLabel: null,
        sku: null,
        unitPriceCents: 500,
        qty: 2,
        custom: false,
        discount: null,
      },
    ],
    discount: null,
    note: '',
    customer: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  useCart.setState({
    lines: [],
    discount: null,
    note: '',
    customer: null,
    holds: [],
    exchange: null,
  });
  customIdCounter = 0;
});

// ==========================================================================
// addProduct
// ==========================================================================
describe('addProduct', () => {
  it('adds a product without variant', () => {
    const p = makeProduct();
    const result = useCart.getState().addProduct(p, null);

    expect(result).toBe(true);
    const lines = useCart.getState().lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      key: 'pproduct-1:0',
      productId: 'product-1',
      variantId: null,
      name: 'Test Product',
      unitPriceCents: 1000,
      qty: 1,
      custom: false,
    });
  });

  it('adds a product with variant using variant price', () => {
    const p = makeProduct({ id: 'product-2', hasVariants: true });
    const v = makeVariant({ id: 'variant-200', productId: 'product-2', priceCents: 3500 });
    const result = useCart.getState().addProduct(p, v);

    expect(result).toBe(true);
    const lines = useCart.getState().lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      key: 'pproduct-2:variant-200',
      variantId: 'variant-200',
      unitPriceCents: 3500,
    });
  });

  it('increments qty when adding duplicate product+variant', () => {
    const p = makeProduct();
    useCart.getState().addProduct(p, null);
    useCart.getState().addProduct(p, null);

    const lines = useCart.getState().lines;
    expect(lines).toHaveLength(1);
    expect(lines[0].qty).toBe(2);
  });

  it('returns false and adds nothing when product price is null', () => {
    const p = makeProduct({ priceCents: null });
    const result = useCart.getState().addProduct(p, null);

    expect(result).toBe(false);
    expect(useCart.getState().lines).toHaveLength(0);
  });

  it('returns false when variant price is null', () => {
    const p = makeProduct({ priceCents: 1000 });
    const v = makeVariant({ priceCents: null });
    const result = useCart.getState().addProduct(p, v);

    expect(result).toBe(false);
    expect(useCart.getState().lines).toHaveLength(0);
  });
});

// ==========================================================================
// addCustom
// ==========================================================================
describe('addCustom', () => {
  it('adds a custom line item', () => {
    useCart.getState().addCustom('Gift Wrap', 300);

    const lines = useCart.getState().lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      productId: 'local-product-custom',
      variantId: null,
      name: 'Gift Wrap',
      unitPriceCents: 300,
      qty: 1,
      custom: true,
    });
    expect(lines[0].key).toMatch(/^c\d+/);
  });

  it('adds multiple custom items with unique keys', () => {
    useCart.getState().addCustom('A', 100);
    useCart.getState().addCustom('B', 200);

    const lines = useCart.getState().lines;
    expect(lines).toHaveLength(2);
    expect(lines[0].key).not.toBe(lines[1].key);
  });
});

// ==========================================================================
// setQty
// ==========================================================================
describe('setQty', () => {
  it('updates the qty of an existing line', () => {
    const p = makeProduct();
    useCart.getState().addProduct(p, null);
    useCart.getState().setQty('pproduct-1:0', 5);

    expect(useCart.getState().lines[0].qty).toBe(5);
  });

  it('removes the line when qty is set to 0', () => {
    const p = makeProduct();
    useCart.getState().addProduct(p, null);
    useCart.getState().setQty('pproduct-1:0', 0);

    expect(useCart.getState().lines).toHaveLength(0);
  });

  it('removes the line when qty is set to a negative number', () => {
    const p = makeProduct();
    useCart.getState().addProduct(p, null);
    useCart.getState().setQty('pproduct-1:0', -1);

    expect(useCart.getState().lines).toHaveLength(0);
  });
});

// ==========================================================================
// removeLine
// ==========================================================================
describe('removeLine', () => {
  it('removes a specific line by key', () => {
    useCart.getState().addProduct(makeProduct({ id: 'product-1' }), null);
    useCart.getState().addProduct(makeProduct({ id: 'product-2' }), null);

    useCart.getState().removeLine('pproduct-1:0');

    const lines = useCart.getState().lines;
    expect(lines).toHaveLength(1);
    expect(lines[0].key).toBe('pproduct-2:0');
  });

  it('is a no-op when key does not exist', () => {
    useCart.getState().addProduct(makeProduct(), null);
    useCart.getState().removeLine('nonexistent');

    expect(useCart.getState().lines).toHaveLength(1);
  });
});

// ==========================================================================
// setDiscount / setLineDiscount
// ==========================================================================
describe('setDiscount', () => {
  it('applies a cart-level percent discount', () => {
    const disc: CartDiscount = { type: 'percent', value: 10 };
    useCart.getState().setDiscount(disc);

    expect(useCart.getState().discount).toEqual(disc);
  });

  it('applies a cart-level amount discount', () => {
    const disc: CartDiscount = { type: 'amount', value: 500 };
    useCart.getState().setDiscount(disc);

    expect(useCart.getState().discount).toEqual(disc);
  });

  it('clears discount when set to null', () => {
    useCart.getState().setDiscount({ type: 'percent', value: 10 });
    useCart.getState().setDiscount(null);

    expect(useCart.getState().discount).toBeNull();
  });
});

describe('setLineDiscount', () => {
  it('applies a line-level discount to a specific line', () => {
    useCart.getState().addProduct(makeProduct(), null);
    const ld: LineDiscount = { type: 'percent', value: 15 };
    useCart.getState().setLineDiscount('pproduct-1:0', ld);

    expect(useCart.getState().lines[0].discount).toEqual(ld);
  });

  it('clears a line-level discount when set to null', () => {
    useCart.getState().addProduct(makeProduct(), null);
    useCart.getState().setLineDiscount('pproduct-1:0', { type: 'amount', value: 100 });
    useCart.getState().setLineDiscount('pproduct-1:0', null);

    expect(useCart.getState().lines[0].discount).toBeNull();
  });
});

// ==========================================================================
// setNote / setCustomer
// ==========================================================================
describe('setNote', () => {
  it('sets the cart note', () => {
    useCart.getState().setNote('Rush order');
    expect(useCart.getState().note).toBe('Rush order');
  });
});

describe('setCustomer', () => {
  it('sets the customer', () => {
    const c = makeCustomer();
    useCart.getState().setCustomer(c);

    expect(useCart.getState().customer).toEqual(c);
  });

  it('clears the customer when set to null', () => {
    useCart.getState().setCustomer(makeCustomer());
    useCart.getState().setCustomer(null);

    expect(useCart.getState().customer).toBeNull();
  });
});

// ==========================================================================
// Exchange guards
// ==========================================================================
describe('Exchange guards', () => {
  it('startExchange sets exchange context with refunded=false', () => {
    const ctx = makeExchangeContext();
    useCart.getState().startExchange(ctx);

    const ex = useCart.getState().exchange;
    expect(ex).not.toBeNull();
    expect(ex!.orderId).toBe('ord-1');
    expect(ex!.refunded).toBe(false);
  });

  it('markExchangeRefunded sets refunded=true', () => {
    useCart.getState().startExchange(makeExchangeContext());
    useCart.getState().markExchangeRefunded();

    expect(useCart.getState().exchange!.refunded).toBe(true);
  });

  it('markExchangeRefunded is a no-op when no exchange is active', () => {
    useCart.getState().markExchangeRefunded();
    expect(useCart.getState().exchange).toBeNull();
  });

  it('cancelExchange clears exchange when NOT refunded', () => {
    useCart.getState().startExchange(makeExchangeContext());
    useCart.getState().cancelExchange();

    expect(useCart.getState().exchange).toBeNull();
  });

  it('cancelExchange is a NO-OP when refunded=true (critical guard)', () => {
    useCart.getState().startExchange(makeExchangeContext());
    useCart.getState().markExchangeRefunded();
    useCart.getState().cancelExchange();

    // Exchange must still be present — refund already happened, can't silently cancel
    expect(useCart.getState().exchange).not.toBeNull();
    expect(useCart.getState().exchange!.refunded).toBe(true);
  });

  it('clear() also clears exchange', () => {
    useCart.getState().startExchange(makeExchangeContext());
    useCart.getState().addProduct(makeProduct(), null);
    useCart.getState().setNote('note');
    useCart.getState().clear();

    const s = useCart.getState();
    expect(s.exchange).toBeNull();
    expect(s.lines).toHaveLength(0);
    expect(s.note).toBe('');
    expect(s.discount).toBeNull();
    expect(s.customer).toBeNull();
  });
});

// ==========================================================================
// Hold / Resume guards
// ==========================================================================
describe('Hold / Resume guards', () => {
  it('holdCurrent saves current cart to holds and clears cart', () => {
    useCart.getState().addProduct(makeProduct(), null);
    useCart.getState().setNote('hold me');
    useCart.getState().holdCurrent('Table 1');

    const s = useCart.getState();
    expect(s.lines).toHaveLength(0);
    expect(s.note).toBe('');
    expect(s.holds).toHaveLength(1);
    expect(s.holds[0].name).toBe('Table 1');
    expect(s.holds[0].lines).toHaveLength(1);
    expect(s.holds[0].note).toBe('hold me');
  });

  it('holdCurrent is a NO-OP when cart is empty', () => {
    useCart.getState().holdCurrent('Empty');

    expect(useCart.getState().holds).toHaveLength(0);
  });

  it('holdCurrent is a NO-OP when in exchange mode', () => {
    useCart.getState().addProduct(makeProduct(), null);
    useCart.getState().startExchange(makeExchangeContext());
    useCart.getState().holdCurrent('Exchange hold');

    expect(useCart.getState().holds).toHaveLength(0);
    // Cart lines should remain untouched
    expect(useCart.getState().lines).toHaveLength(1);
  });

  it('resumeHold restores held cart and removes from holds', () => {
    const held = makeHeldCart({ id: 'h-resume', name: 'Resume me', note: 'hi' });
    useCart.setState({ holds: [held] });

    useCart.getState().resumeHold('h-resume');

    const s = useCart.getState();
    expect(s.lines).toEqual(held.lines);
    expect(s.note).toBe('hi');
    expect(s.holds).toHaveLength(0);
  });

  it('resumeHold is a NO-OP when cart already has items', () => {
    const held = makeHeldCart({ id: 'h-blocked' });
    useCart.setState({ holds: [held] });
    useCart.getState().addProduct(makeProduct(), null);

    useCart.getState().resumeHold('h-blocked');

    // Hold should still be in holds list
    expect(useCart.getState().holds).toHaveLength(1);
  });

  it('resumeHold is a NO-OP when in exchange mode', () => {
    const held = makeHeldCart({ id: 'h-ex' });
    useCart.setState({ holds: [held] });
    useCart.getState().startExchange(makeExchangeContext());

    useCart.getState().resumeHold('h-ex');

    expect(useCart.getState().holds).toHaveLength(1);
  });

  it('resumeHold is a NO-OP when hold id does not exist', () => {
    useCart.getState().resumeHold('nonexistent');

    expect(useCart.getState().lines).toHaveLength(0);
  });

  it('deleteHold removes a held cart', () => {
    const h1 = makeHeldCart({ id: 'h-del1' });
    const h2 = makeHeldCart({ id: 'h-del2' });
    useCart.setState({ holds: [h1, h2] });

    useCart.getState().deleteHold('h-del1');

    const holds = useCart.getState().holds;
    expect(holds).toHaveLength(1);
    expect(holds[0].id).toBe('h-del2');
  });
});

// ==========================================================================
// cartItemCount
// ==========================================================================
describe('cartItemCount', () => {
  it('returns 0 for empty lines', () => {
    expect(cartItemCount([])).toBe(0);
  });

  it('sums quantities across all lines', () => {
    const lines: CartLine[] = [
      {
        key: 'a', productId: 'product-1', variantId: null, name: 'A',
        variantLabel: null, sku: null, unitPriceCents: 100, qty: 3,
        custom: false, discount: null,
      },
      {
        key: 'b', productId: 'product-2', variantId: null, name: 'B',
        variantLabel: null, sku: null, unitPriceCents: 200, qty: 7,
        custom: false, discount: null,
      },
    ];
    expect(cartItemCount(lines)).toBe(10);
  });

  it('counts single line correctly', () => {
    const lines: CartLine[] = [
      {
        key: 'x', productId: 'product-5', variantId: null, name: 'X',
        variantLabel: null, sku: null, unitPriceCents: 500, qty: 1,
        custom: false, discount: null,
      },
    ];
    expect(cartItemCount(lines)).toBe(1);
  });
});
