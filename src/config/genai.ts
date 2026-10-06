import { GoogleGenAI } from '@google/genai';
import { env } from './env.js';

/**
 * ============================================================================
 * BRAVOMART - GOOGLE GEMINI AI CONFIGURATION
 * ============================================================================
 *
 * This module instantiates and exports the central Google GenAI client instance.
 * By configuring it once here, we ensure consistent authentication and configuration
 * across all AI-driven features (cataloging, text parsing, image generation, and trust scores).
 */

// 1. Validate that the API key exists before attempting to initialize the client.
if (!env.GEMINI_API_KEY) {
  throw new Error(
    'CRITICAL ERROR: GEMINI_API_KEY is missing from environment variables. ' +
    'Please verify your .env file or deployment settings.'
  );
}

/**
 * Singleton instance of the official `@google/genai` SDK.
 * Reads the API key directly from the validated environment configuration (`env.GEMINI_API_KEY`).
 * This instance will be reused for all upstream calls (e.g., in `aiProduct.service.ts`).
 */
export const genAI = new GoogleGenAI({
  apiKey: env.GEMINI_API_KEY,
});

/**
 * Primary Gemini Model Name.
 *
 * Defaults to 'gemini-1.5-flash' if `env.GEMINI_MODEL` is undefined or set to an invalid model.
 * - 'gemini-1.5-flash': Recommended fast, multimodal model for high-throughput listing generation and JSON structuring.
 * - 'gemini-2.0-flash': Next-gen flash model for extra speed and high accuracy.
 */
// Explicitly set to gemini-3.8-flash
export const GEMINI_MODEL = 'gemini-3.8-flash';