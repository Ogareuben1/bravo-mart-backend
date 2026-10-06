// ============================================================================
// BRAVOMART - PUBLIC PRODUCT CATALOG & SEARCH SERVICE
// ============================================================================

import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { getOrSetCache, invalidateCache, invalidateCachePattern } from './cache.service.js';
import { toProductResponse, type ProductResponse } from '../utils/serializers.js';
import type { ProductListQuery } from '../schemas/product.schema.js';

// Cache expiration constants
const PRODUCT_LIST_TTL_SECONDS = 60;
const PRODUCT_DETAIL_TTL_SECONDS = 120;
const PRODUCT_LIST_CACHE_PREFIX = 'products:list';
const PRODUCT_DETAIL_CACHE_PREFIX = 'products:detail';

// Minimal vendor fields included with public product payloads
const VENDOR_SUMMARY_SELECT = { id: true, shopName: true, shopAddress: true } as const;

export interface ProductListResult {
  items: ProductResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Lists products for the storefront homepage, marketplace, and category views.
 * Supports case-insensitive category matching across both category name and slug.
 */
export async function listProducts(query: ProductListQuery): Promise<ProductListResult> {
  const { category, page = 1, limit = 10, search } = query;

  // Normalize category query parameter for consistent cache key generation
  const categoryFilter = category?.trim() || 'all';
  const searchFilter = search?.trim() || 'none';

  // Construct a deterministic cache key encoding all active filters and pagination parameters
  const cacheKey = `${PRODUCT_LIST_CACHE_PREFIX}:${categoryFilter.toLowerCase()}:${searchFilter.toLowerCase()}:${page}:${limit}`;

  return getOrSetCache(cacheKey, PRODUCT_LIST_TTL_SECONDS, async () => {
    // Build Prisma filter conditions array dynamically
    const whereConditions: Array<Record<string, unknown>> = [];

    // 1. Category Filtering: Matches against category name or slug case-insensitively
    if (category && category.trim() !== '' && category.trim().toLowerCase() !== 'all') {
      const cleanCategory = category.trim();
      whereConditions.push({
        category: {
          OR: [
            { name: { equals: cleanCategory, mode: 'insensitive' } },
            { slug: { equals: cleanCategory.toLowerCase(), mode: 'insensitive' } },
          ],
        },
      });
    }

    // 2. Search Query Filtering: Searches across product title, description, and tags array
    if (search && search.trim() !== '') {
      const cleanSearch = search.trim();
      whereConditions.push({
        OR: [
          { title: { contains: cleanSearch, mode: 'insensitive' } },
          { description: { contains: cleanSearch, mode: 'insensitive' } },
          { tags: { has: cleanSearch.toLowerCase() } },
        ],
      });
    }

    // Combine all active conditions with AND logic
    const where = whereConditions.length > 0 ? { AND: whereConditions } : {};

    // Execute product fetch and total count queries concurrently using Promise.all
    // Replacing $transaction prevents database connection pool exhaustion and transaction timeouts
    const [rows, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          category: true,
          vendor: { select: VENDOR_SUMMARY_SELECT },
        },
        orderBy: { createdAt: 'desc' }, // Show newest products first
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.product.count({ where }),
    ]);

    // Convert Prisma Decimal pricing and weights to JS numbers prior to caching in Redis
    const items = rows.map(toProductResponse);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  });
}

/**
 * Fetches a single product record by unique ID for detailed view pages.
 */
export async function getProductById(id: string): Promise<ProductResponse> {
  const cacheKey = `${PRODUCT_DETAIL_CACHE_PREFIX}:${id}`;

  return getOrSetCache(cacheKey, PRODUCT_DETAIL_TTL_SECONDS, async () => {
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        vendor: { select: VENDOR_SUMMARY_SELECT },
      },
    });

    if (!product) {
      throw new AppError('Product not found.', 404);
    }

    return toProductResponse(product);
  });
}

/**
 * Flushes product listing caches across Redis whenever new items are created or modified.
 */
export async function invalidateProductCaches(productId?: string): Promise<void> {
  // Purge all product list cache entries matching prefix
  await invalidateCachePattern(`${PRODUCT_LIST_CACHE_PREFIX}:*`);

  // Optionally purge single product detail cache if an ID is provided
  if (productId) {
    await invalidateCache(`${PRODUCT_DETAIL_CACHE_PREFIX}:${productId}`);
  }
}