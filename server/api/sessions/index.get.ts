export default defineEventHandler(async () => {
  const sessions = await prisma.session.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      messages: {
        where: { role: 'user' },
        orderBy: { createdAt: 'asc' },
        take: 1,
      },
      _count: {
        select: { messages: true },
      },
    },
  })

  return sessions
    .filter((s) => s._count.messages > 0)
    .map((s) => ({
      id: s.id,
      title: s.title !== '新会话' ? s.title : (s.messages[0]?.content.slice(0, 28) || '未命名会话'),
      createdAt: s.createdAt,
      messageCount: s._count.messages,
      preview: s.messages[0]?.content.slice(0, 48) || '',
    }))
})
