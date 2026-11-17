// ============================================================================
// BRAVOMART - AI PRODUCT CATALOG & LISTING SERVICE
// ============================================================================

import { Type } from '@google/genai';
import { genAI, GEMINI_MODEL } from '../config/genai.js';
import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { findCategoryByName } from './category.service.js';
import { invalidateProductCaches } from './product.service.js';
import { persistImageBuffer, ensurePlaceholderImage } from './upload.service.js';
import { toProductResponse, type ProductResponse } from '../utils/serializers.js';
import { aiGeneratedListingSchema, PRODUCT_CATEGORIES, type AiGeneratedListing } from '../schemas/aiProduct.schema.js';
import type { AccessTokenPayload } from '../types/jwt.types.js';

// Select only basic, necessary vendor fields for listing payloads
const VENDOR_SUMMARY_SELECT = { id: true, shopName: true, shopAddress: true } as const;

// System instruction dictating how the AI processes raw vendor inputs into clean listings
const SYSTEM_INSTRUCTION = `You are BravoMart's cataloguing assistant. Given a vendor's short product
description (and optionally a photo), write a clean, honest e-commerce listing.

Rules:
- "title" is a concise, buyer-facing product name (max ~12 words). No ALL CAPS, no emojis.
- "description" is 2-4 sentences written for an online storefront, and naturally works in a few
  relevant SEO keywords a shopper might search for. Do not invent facts the vendor did not provide
  and that are not visible in the photo — no fake certifications, no fabricated specifications.
- "price" is a plain number in Nigerian Naira, with no currency symbol or thousands separators,
  taken from what the vendor stated. If no price was given, provide a reasonable market estimate
  and say in the description that the price is an estimate.
- "category" must be exactly one of: ${PRODUCT_CATEGORIES.join(', ')}.
- "tags" is 3-8 short, lowercase search keywords with no duplicates.
- "inventory" is the stock count if the vendor mentioned one, otherwise default to 1.`;

// JSON schema enforced on the Gemini AI API call output
const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: 'Buyer-facing product title.' },
    description: { type: Type.STRING, description: 'SEO-aware e-commerce description, 2-4 sentences.' },
    price: { type: Type.NUMBER, description: 'Price in Naira as a plain number.' },
    category: { type: Type.STRING, enum: [...PRODUCT_CATEGORIES] },
    tags: { type: Type.ARRAY, items: { type: Type.STRING }, description: '3-8 lowercase search keywords.' },
    inventory: { type: Type.INTEGER, description: 'Units in stock; default to 1 if not mentioned.' },
  },
  required: ['title', 'description', 'price', 'category', 'tags'],
} as const;

interface ImageInput {
  buffer: Buffer;
  mimeType: string;
}

interface GenerateListingInput {
  prompt: string;
  image?: ImageInput;
}

/**
 * Invokes Gemini models to generate structured e-commerce product listings.
 * Employs a multi-model fallback chain supporting active 3.x Flash models.
 */
export async function generateListingFromPrompt(input: GenerateListingInput): Promise<AiGeneratedListing> {
  const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];

  if (input.image) {
    parts.push({
      inlineData: {
        mimeType: input.image.mimeType,
        data: input.image.buffer.toString('base64'),
      },
    });
  }

  const modelsToTry = Array.from(
    new Set([
      GEMINI_MODEL,
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
    ])
  );

  let rawText = '';
  let lastError: unknown;

  for (const targetModel of modelsToTry) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await genAI.models.generateContent({
          model: targetModel,
          contents: [{ role: 'user', parts }],
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
          },
        });

        rawText = response.text ?? '';
        if (rawText) break;
      } catch (error: any) {
        lastError = error;
        const status = error?.status || error?.code;
        const is503 = status === 503 || String(error?.message).includes('UNAVAILABLE');
        const is429 = status === 429 || String(error?.message).includes('RESOURCE_EXHAUSTED');

        if (is429) {
          console.warn(`[AI Listing Service] Model ${targetModel} hit quota limit (429). Advancing to next fallback...`);
          break;
        }

        if (is503 && attempt < 2) {
          console.warn(`[AI Listing Service] Model ${targetModel} returned 503 capacity spike. Retrying in 1000ms...`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }

        console.warn(`[AI Listing Service] Model ${targetModel} encountered error:`, error?.message || error);
        break;
      }
    }

    if (rawText) break;
  }

  if (!rawText) {
    console.error('=== GEMINI API ALL MODELS EXHAUSTED LOG ===', lastError);
    throw new AppError('The AI listing service is currently experiencing high demand or quota limits. Please try again shortly.', 503);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    throw new AppError('The AI returned a response that was not valid JSON.', 502);
  }

  const validation = aiGeneratedListingSchema.safeParse(parsedJson);
  if (!validation.success) {
    throw new AppError('The AI response did not match the expected product shape.', 502, validation.error.issues);
  }

  return validation.data;
}

/**
 * Generates an e-commerce studio photo using Gemini native image generation
 * (Nano Banana models) when no initial image is uploaded by the vendor.
 */
export async function generateAiProductImage(title: string, description: string): Promise<string> {
  const imagePrompt = `Professional e-commerce product photo of ${title}. Description: ${description}. Clean white background, studio lighting, high resolution product shot.`;

  const imageModels = [
    'gemini-nano-banana-2.1',
    'gemini-3.1-flash-lite-image',
    'gemini-3.1-flash-image',
  ];

  for (const modelName of imageModels) {
    try {
      const response = await genAI.models.generateContent({
        model: modelName,
        contents: imagePrompt,
        config: {
          responseModalities: ['IMAGE'],
          imageConfig: {
            aspectRatio: '1:1',
          },
        },
      });

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const imagePart = parts.find((part) => part.inlineData?.data);

      if (!imagePart?.inlineData?.data) {
        throw new Error(`No image bytes returned from ${modelName}.`);
      }

      const mimeType = imagePart.inlineData.mimeType || 'image/png';
      const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
      const stored = await persistImageBuffer(imageBuffer, mimeType, 'products');
      return stored.url;
    } catch (error) {
      console.warn(
        `[AI Image Generation] Model ${modelName} failed:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  console.error('=== AI IMAGE GENERATION WARNING: All image models failed, using placeholder ===');
  return await ensurePlaceholderImage('products');
}

interface CreateAiProductInput {
  prompt: string;
  vendorId?: string;
  weightKg: number;
  image?: ImageInput;
  requestingUser: AccessTokenPayload;
}

/**
 * Orchestrates full product creation: AI listing generation, image upload/generation, and DB persistence.
 */
export async function createAiGeneratedProduct(input: CreateAiProductInput): Promise<ProductResponse> {
  const vendorId = await resolveTargetVendorId(input.requestingUser, input.vendorId);
  const listing = await generateListingFromPrompt({ prompt: input.prompt, image: input.image });
  const category = await findCategoryByName(listing.category);

  let imageUrl: string;
  if (input.image) {
    const stored = await persistImageBuffer(input.image.buffer, input.image.mimeType, 'products');
    imageUrl = stored.url;
  } else {
    imageUrl = await generateAiProductImage(listing.title, listing.description);
  }

  const product = await prisma.product.create({
    data: {
      title: listing.title,
      description: listing.description,
      price: listing.price,
      weightKg: input.weightKg,
      inventory: listing.inventory,
      tags: listing.tags,
      imageUrl,
      isAiGenerated: true,
      categoryId: category.id,
      vendorId,
    },
    include: {
      category: true,
      vendor: {
        select: VENDOR_SUMMARY_SELECT,
      },
    },
  });

  await invalidateProductCaches();

  return toProductResponse(product);
}

/**
 * Helper function validating permissions and resolving target vendor ID.
 */
async function resolveTargetVendorId(user: AccessTokenPayload, requestedVendorId?: string): Promise<string> {
  if (user.role === 'VENDOR') {
    if (!user.vendorProfileId) {
      throw new AppError('This vendor account has no linked shop profile.', 400);
    }
    return user.vendorProfileId;
  }

  if (!requestedVendorId) {
    throw new AppError('vendorId is required when an admin creates a listing on behalf of a vendor.', 400);
  }

  const vendorProfile = await prisma.vendorProfile.findUnique({ where: { id: requestedVendorId } });
  if (!vendorProfile) {
    throw new AppError('No vendor exists with that vendorId.', 404);
  }

  return vendorProfile.id;
}