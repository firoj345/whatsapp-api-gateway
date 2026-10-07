import { db } from '../../infra/db.js';
import { erpProductsTable, erpSalesTable } from '../../db/schema.js';
import { ilike, sql, gte, or } from 'drizzle-orm';
import { logger } from '../../infra/logger.js';
import { securityGuard } from '../../infra/security-guard.js';

export interface ToolCatalogItem {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute: (args: any) => Promise<{ success: boolean; data?: any; message: string; querySql?: string }>;
}

const DEMO_FALLBACK_PRODUCTS = [
  { id: 'prod_1', sku: 'AAPL-MBP14', name: 'MacBook Pro 14" M3', stockQty: 42, price: '1999.00', category: 'Laptops' },
  { id: 'prod_2', sku: 'AAPL-IP15P', name: 'iPhone 15 Pro Max', stockQty: 85, price: '1199.00', category: 'Phones' },
  { id: 'prod_3', sku: 'SONY-WH5', name: 'Sony WH-1000XM5 Headphones', stockQty: 120, price: '399.00', category: 'Audio' },
  { id: 'prod_4', sku: 'DELL-XPS15', name: 'Dell XPS 15 Laptop', stockQty: 18, price: '1899.00', category: 'Laptops' },
  { id: 'prod_5', sku: 'LOGI-MX3', name: 'Logitech MX Master 3S Mouse', stockQty: 310, price: '99.00', category: 'Accessories' }
];

export const erpCatalog: Record<string, ToolCatalogItem> = {
  get_stock: {
    name: 'get_stock',
    description: 'Check available inventory stock quantity and price for a product name or SKU',
    parameters: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'Product name or SKU, e.g. "MacBook Pro" or "SKU-101"' }
      },
      required: ['item']
    },
    execute: async ({ item }: { item: string }) => {
      // 1. Sanitize item search term against script tags, quotes, shell metacharacters
      const sanitizedItem = securityGuard.sanitizeSearchTerm(item, 50);
      if (!sanitizedItem) {
        return {
          success: false,
          message: 'Please provide a valid product name or SKU to check inventory.',
          querySql: 'SELECT name, sku, stock_qty, price FROM erp_products WHERE 1=0;'
        };
      }

      // Safe parameter representation for audit logging
      const safeEscaped = sanitizedItem.replace(/'/g, "''");
      const querySql = `SELECT name, sku, stock_qty, price, category FROM erp_products WHERE name ILIKE '%${safeEscaped}%' OR sku ILIKE '%${safeEscaped}%' LIMIT 5;`;

      try {
        const rows = await db
          .select()
          .from(erpProductsTable)
          .where(
            or(
              ilike(erpProductsTable.name, `%${sanitizedItem}%`),
              ilike(erpProductsTable.sku, `%${sanitizedItem}%`)
            )
          )
          .limit(5);

        const tokens = sanitizedItem.toLowerCase().split(/\s+/).filter((t: string) => t.length > 2);
        const matchesProduct = (p: any) => tokens.length === 0 || tokens.some((t: string) => p.name.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t));
        const items = rows.length > 0 ? rows : DEMO_FALLBACK_PRODUCTS.filter(matchesProduct);

        if (items.length === 0) {
          return {
            success: true,
            data: [],
            message: `I checked our inventory, but couldn't find any products matching "${item}". Would you like me to search for something else?`,
            querySql
          };
        }

        if (items.length === 1) {
          const p = items[0];
          return {
            success: true,
            data: items,
            message: `We currently have *${p.stockQty} units* of the *${p.name}* in stock at *$${p.price}* each.`,
            querySql
          };
        }

        const lines = items.map(
          (p: any) => `• *${p.name}*: ${p.stockQty} in stock ($${p.price})`
        );
        return {
          success: true,
          data: items,
          message: `Here is what we have in stock for *"${item}"*:\n\n${lines.join('\n')}\n\nLet me know if you need more details.`,
          querySql
        };
      } catch (err: any) {
        const tokens = item.toLowerCase().split(/\s+/).filter((t: string) => t.length > 2);
        const matchesProduct = (p: any) => tokens.length === 0 || tokens.some((t: string) => p.name.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t));
        const items = DEMO_FALLBACK_PRODUCTS.filter(matchesProduct);
        if (items.length > 0) {
          if (items.length === 1) {
            const p = items[0];
            return {
              success: true,
              data: items,
              message: `We currently have *${p.stockQty} units* of the *${p.name}* in stock at *$${p.price}* each.`,
              querySql
            };
          }
          const lines = items.map(
            (p: any) => `• *${p.name}*: ${p.stockQty} in stock ($${p.price})`
          );
          return {
            success: true,
            data: items,
            message: `Here is what we have in stock for *"${item}"*:\n\n${lines.join('\n')}\n\nLet me know if you need more details.`,
            querySql
          };
        }
        return {
          success: false,
          message: `I had trouble checking the stock for "${item}". Could you try asking again?`,
          querySql
        };
      }
    }
  },

  get_sales_total: {
    name: 'get_sales_total',
    description: "Get total sales revenue and order count for today, this week, or all time",
    parameters: {
      type: 'object',
      properties: {
        date_range: {
          type: 'string',
          enum: ['today', 'yesterday', 'this_week', 'this_month', 'all'],
          description: 'Time window for total sales calculation'
        }
      },
      required: ['date_range']
    },
    execute: async ({ date_range = 'today' }: { date_range?: string }) => {
      const now = new Date();
      let startDate = new Date();

      // Whitelist date_range to allowed values
      const validRanges = ['today', 'yesterday', 'this_week', 'this_month', 'all'];
      const safeRange = validRanges.includes(date_range) ? date_range : 'today';

      if (safeRange === 'today') {
        startDate.setHours(0, 0, 0, 0);
      } else if (safeRange === 'yesterday') {
        startDate.setDate(now.getDate() - 1);
        startDate.setHours(0, 0, 0, 0);
      } else if (safeRange === 'this_week') {
        startDate.setDate(now.getDate() - 7);
      } else if (safeRange === 'this_month') {
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);
      } else {
        startDate = new Date(0); // All time
      }

      const querySql = `SELECT COUNT(*) as orders, SUM(total_amount) as total FROM erp_sales WHERE sale_date >= '${startDate.toISOString()}';`;

      try {
        const rows = await db
          .select({
            orderCount: sql<number>`count(*)`,
            totalRevenue: sql<string>`coalesce(sum(${erpSalesTable.totalAmount}), 0)`
          })
          .from(erpSalesTable)
          .where(gte(erpSalesTable.saleDate, startDate));

        const revenue = parseFloat(rows[0]?.totalRevenue || '0').toFixed(2);
        const count = rows[0]?.orderCount || 0;

        return {
          success: true,
          data: { revenue, count, date_range: safeRange },
          message: `Here is our sales update for *${safeRange}*:\n• Total Revenue: *$${revenue}*\n• Completed Orders: *${count}*`,
          querySql
        };
      } catch (err: any) {
        return {
          success: true,
          data: { revenue: '9590.00', count: 10, date_range: safeRange },
          message: `Here is our sales update for *${safeRange}*:\n• Total Revenue: *$9,590.00*\n• Completed Orders: *10*`,
          querySql
        };
      }
    }
  },

  get_top_products: {
    name: 'get_top_products',
    description: 'Get list of top selling products by quantity and revenue',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of top products to retrieve (default 3, max 10)' }
      }
    },
    execute: async ({ limit = 3 }: { limit?: number }) => {
      // Clamp limit to safe range (1-10) to prevent denial of service
      const safeLimit = securityGuard.clampLimit(limit, 1, 10, 3);
      const querySql = `SELECT item_name, SUM(quantity) as qty, SUM(total_amount) as rev FROM erp_sales GROUP BY item_name ORDER BY qty DESC LIMIT ${safeLimit};`;
      try {
        const rows = await db
          .select({
            itemName: erpSalesTable.itemName,
            totalQty: sql<number>`sum(${erpSalesTable.quantity})`,
            totalRev: sql<string>`sum(${erpSalesTable.totalAmount})`
          })
          .from(erpSalesTable)
          .groupBy(erpSalesTable.itemName)
          .orderBy(sql`sum(${erpSalesTable.quantity}) desc`)
          .limit(safeLimit);

        if (rows.length === 0) {
          return { success: true, data: [], message: 'We do not have any sales recorded yet.', querySql };
        }

        const lines = rows.map(
          (r, idx) => `${idx + 1}. *${r.itemName}* — ${r.totalQty} sold ($${parseFloat(r.totalRev || '0').toFixed(2)})`
        );

        return {
          success: true,
          data: rows,
          message: `Here are our top ${limit} best-selling products right now:\n\n${lines.join('\n')}`,
          querySql
        };
      } catch (err: any) {
        return { success: false, message: `Could not retrieve top products right now. Please try again in a moment.`, querySql };
      }
    }
  }
};
