/**
 * Recipes API — thin delegate to the unified content API.
 *
 * GET    /api/recipes           — list all
 * GET    /api/recipes?id=xxx    — get single
 * POST   /api/recipes           — create { content, tags?, title?, cookTime?, servings? }
 * PUT    /api/recipes?id=xxx    — update
 * DELETE /api/recipes?id=xxx    — delete
 */

import { NextRequest } from 'next/server'
import { getContentType } from '@/lib/content-registry'
import { handleGet, handlePost, handlePut, handleDelete } from '@/lib/content-api'

const config = getContentType('recipes')!

export async function GET(req: NextRequest) { return handleGet(req, config) }
export async function POST(req: NextRequest) { return handlePost(req, config) }
export async function PUT(req: NextRequest) { return handlePut(req, config) }
export async function DELETE(req: NextRequest) { return handleDelete(req, config) }
