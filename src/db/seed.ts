import { db } from '../infra/db.js';
import { erpProductsTable, erpSalesTable, apiKeysTable } from './schema.js';
import { hashApiKey } from '../infra/crypto.js';
import { env } from '../config/env.js';
import { logger } from '../infra/logger.js';

export async function seedDemoData() {
  logger.info('🌱 Seeding demo ERP products, sales data, and admin key...');

  try {
    // 1. Seed Products
    const products = [
      { id: 'prod_1', sku: 'AAPL-MBP14', name: 'MacBook Pro 14" M3', description: 'Apple M3 Pro, 18GB RAM, 512GB SSD', stockQty: 42, price: '1999.00', category: 'Laptops' },
      { id: 'prod_2', sku: 'AAPL-IP15P', name: 'iPhone 15 Pro Max', description: 'Natural Titanium 256GB', stockQty: 85, price: '1199.00', category: 'Phones' },
      { id: 'prod_3', sku: 'SONY-WH5', name: 'Sony WH-1000XM5 Headphones', description: 'Noise Cancelling Wireless', stockQty: 120, price: '399.00', category: 'Audio' },
      { id: 'prod_4', sku: 'DELL-XPS15', name: 'Dell XPS 15 Laptop', description: 'Intel i9, 32GB RAM, OLED Display', stockQty: 18, price: '1899.00', category: 'Laptops' },
      { id: 'prod_5', sku: 'LOGI-MX3', name: 'Logitech MX Master 3S Mouse', description: 'Ergonomic Wireless Mouse', stockQty: 310, price: '99.00', category: 'Accessories' }
    ];

    for (const p of products) {
      await db.insert(erpProductsTable).values(p).onConflictDoNothing();
    }

    // 2. Seed Sales Orders
    const today = new Date();
    const sales = [
      { id: 'sale_1', orderNumber: 'ORD-2026-101', itemName: 'MacBook Pro 14" M3', sku: 'AAPL-MBP14', quantity: 2, totalAmount: '3998.00', saleDate: today, customerPhone: '14155552671' },
      { id: 'sale_2', orderNumber: 'ORD-2026-102', itemName: 'iPhone 15 Pro Max', sku: 'AAPL-IP15P', quantity: 3, totalAmount: '3597.00', saleDate: today, customerPhone: '14155558832' },
      { id: 'sale_3', orderNumber: 'ORD-2026-103', itemName: 'Sony WH-1000XM5 Headphones', sku: 'SONY-WH5', quantity: 5, totalAmount: '1995.00', saleDate: today, customerPhone: '14155554491' }
    ];

    for (const s of sales) {
      await db.insert(erpSalesTable).values(s).onConflictDoNothing();
    }

    // 3. Seed Default Admin Key
    const keyHash = hashApiKey(env.ADMIN_API_KEY);
    await db.insert(apiKeysTable).values({
      id: 'key_admin_default',
      name: 'Default Hackathon Admin',
      prefix: env.ADMIN_API_KEY.substring(0, 16),
      keyHash,
      scopes: ['*'],
      sessionIds: ['*'],
      rateLimitRpm: 120
    }).onConflictDoNothing();

    logger.info('✅ Database seeded with ERP items, sales, and admin credentials');
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Seeding completed with note (database might not be running locally)');
  }
}

if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  seedDemoData().then(() => process.exit(0));
}
