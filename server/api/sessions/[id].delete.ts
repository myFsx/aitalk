export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'session id is required' })
  }

  const session = await prisma.session.findUnique({ where: { id } })
  if (!session) {
    throw createError({ statusCode: 404, statusMessage: 'Session not found' })
  }

  await prisma.$transaction([
    prisma.message.deleteMany({ where: { sessionId: id } }),
    prisma.session.delete({ where: { id } }),
  ])

  return { ok: true, id }
})
