// ============================================================================
// BRAVOMART - PUBLIC PRODUCT VALIDATION SCHEMAS
// ============================================================================

import { z } from 'zod';

/**
 * Validates storefront product list query parameters.
 * Uses z.coerce.number() to transform URL string params into integers cleanly.
 */
export const productListQuerySchema = z.object({
  // Allows optional category strings or empty strings without throwing validation errors
  category: z.string().trim().optional(),
  
  // Search keyword query parameter for cross-field keyword search
  search: z.string().trim().optional(),
  
  // Coerced integer page number (defaults to 1)
  page: z.coerce.number().int().positive().default(1),
  
  // Coerced integer page size limit (defaults to 20, max 50)
  limit: z.coerce.number().int().positive().max(50).default(20),
});

export type ProductListQuery = z.infer<typeof productListQuerySchema>;

/**
 * Validates single product ID path parameter.
 */
export const productIdParamsSchema = z.object({
  id: z.string().uuid({ message: 'A valid product id is required.' }),
});

export type ProductIdParams = z.infer<typeof productIdParamsSchema>;