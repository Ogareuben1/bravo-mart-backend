// ============================================================================
// BRAVOMART - PUBLIC PRODUCT CATALOG CONTROLLER
// ============================================================================

import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import * as productService from '../services/product.service.js';
import type { ProductListQuery, ProductIdParams } from '../schemas/product.schema.js';

/**
 * GET /api/products
 * Fetches products for the public storefront (homepage, marketplace, search, categories).
 */
export const getProducts = asyncHandler(async (req: Request, res: Response) => {
  // Read validated parameters from req.validated.query (populated by validation middleware)
  // Fall back to raw query parameters if req.validated is unpopulated
  const rawQuery = (req.validated?.query || req.query) as Partial<ProductListQuery>;

  // Ensure default fallback values for pagination and search filters
  const query: ProductListQuery = {
    page: rawQuery.page ? Number(rawQuery.page) : 1,
    limit: rawQuery.limit ? Number(rawQuery.limit) : 10,
    category: rawQuery.category,
    search: rawQuery.search,
  };

  // Fetch items and metadata from the product service
  const result = await productService.listProducts(query);

  // Send standardized API response back to frontend
  sendSuccess(res, 200, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
    totalPages: result.totalPages,
  });
});

/**
 * GET /api/products/:id
 * Fetches single product details by unique product ID.
 */
export const getProductById = asyncHandler(async (req: Request, res: Response) => {
  // Extract and validate product ID from route params
  const { id } = (req.validated?.params || req.params) as ProductIdParams;

  // Retrieve product record
  const product = await productService.getProductById(id);

  // Return product object
  sendSuccess(res, 200, product);
});