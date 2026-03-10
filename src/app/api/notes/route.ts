/**
 * Notes API — thin delegate to the unified content API.
 *
 * GET    /api/notes           — list all
 * GET    /api/notes?id=xxx    — get single
 * POST   /api/notes           — create { content, tags?, color? }
 * PUT    /api/notes?id=xxx    — update
 * DELETE /api/notes?id=xxx    — delete
 */

import { NextRequest } from 'next/server'
import { getContentType } from '@/lib/content-registry'
import { handleGet, handlePost, handlePut, handleDelete } from '@/lib/content-api'

const config = getContentType('notes')!

export async function GET(req: NextRequest) { return handleGet(req, config) }
export async function POST(req: NextRequest) { return handlePost(req, config) }
export async function PUT(req: NextRequest) { return handlePut(req, config) }
export async function DELETE(req: NextRequest) { return handleDelete(req, config) }
