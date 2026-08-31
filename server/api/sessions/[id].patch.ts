interface RenameBody {
  title?: string
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'session id is required' })
  }

  const body = await readBody<RenameBody>(event)
  const title = body.title?.trim()

  if (!title) {
    throw createError({ statusCode: 400, statusMessage: 'title is required' })
  }

  if (title.length > 40) {
    throw createError({ statusCode: 400, statusMessage: '标题最多 40 个字' })
  }

  const session = await prisma.session.findUnique({ where: { id } })
  if (!session) {
    throw createError({ statusCode: 404, statusMessage: 'Session not found' })
  }

  const updated = await prisma.session.update({
    where: { id },
    data: { title },
  })

  return {
    id: updated.id,
    title: updated.title,
  }
})
