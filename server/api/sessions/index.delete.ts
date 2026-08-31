export default defineEventHandler(async () => {
  await prisma.$transaction([
    prisma.message.deleteMany({}),
    prisma.session.deleteMany({}),
  ])

  return { ok: true }
})
