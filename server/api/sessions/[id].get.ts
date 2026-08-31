export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'session id is required' })
  }

  const session = await prisma.session.findUnique({
    where: { id },
    include: {
      messages: {
        where: {
          role: { in: ['user', 'assistant'] },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!session) {
    throw createError({ statusCode: 404, statusMessage: 'Session not found' })
  }

  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    messages: session.messages.map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
      createdAt: m.createdAt,
    })),
  }
})
