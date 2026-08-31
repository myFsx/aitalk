import { ASSISTANT_SYSTEM_PROMPT } from '../utils/assistant-system'
import { CHAT_TOOLS, runTool, type ToolCall } from '../utils/tools'

interface ChatRequestBody {
  sessionId?: string
  message?: string
}

interface DeepSeekStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string
    }
  }>
}

interface DeepSeekErrorBody {
  error?: {
    message?: string
  }
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

interface DeepSeekChatResponse {
  choices?: Array<{
    message?: {
      role?: string
      content?: string | null
      tool_calls?: ToolCall[]
    }
    finish_reason?: string
  }>
}

async function callDeepSeek(options: {
  baseUrl: string
  apiKey: string
  messages: ChatMessage[]
  stream: boolean
  tools?: typeof CHAT_TOOLS
  toolChoice?: 'auto' | 'none'
}): Promise<Response> {
  const body: Record<string, unknown> = {
    model: 'deepseek-chat',
    messages: options.messages,
    stream: options.stream,
  }

  if (options.tools) {
    body.tools = options.tools
    body.tool_choice = options.toolChoice || 'auto'
  }

  return fetch(`${options.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify(body),
  })
}

async function readUpstreamError(res: Response): Promise<string> {
  if (res.status === 401) return 'AI API Key 无效，请检查配置'
  if (res.status === 429) return '请求过于频繁，请稍后再试'
  try {
    const body = await res.json() as DeepSeekErrorBody
    if (body.error?.message) return body.error.message
  } catch {
    // ignore
  }
  return 'AI 服务暂时不可用，请稍后再试'
}

export default defineEventHandler(async (event) => {
  const body = await readBody<ChatRequestBody>(event)
  const message = body.message?.trim()

  if (!message) {
    throw createError({ statusCode: 400, statusMessage: 'message is required' })
  }

  const { aiApiKey, aiBaseUrl } = useRuntimeConfig()

  if (!aiApiKey) {
    throw createError({ statusCode: 500, statusMessage: 'AI API key not configured' })
  }

  let sessionId = body.sessionId
  const titleFromMessage = message.length > 28 ? `${message.slice(0, 28)}…` : message

  if (!sessionId) {
    const session = await prisma.session.create({
      data: { title: titleFromMessage },
    })
    sessionId = session.id
  } else {
    const session = await prisma.session.findUnique({ where: { id: sessionId } })
    if (!session) {
      throw createError({ statusCode: 404, statusMessage: 'Session not found' })
    }
    if (session.title === '新会话') {
      await prisma.session.update({
        where: { id: sessionId },
        data: { title: titleFromMessage },
      })
    }
  }

  await prisma.message.create({
    data: {
      role: 'user',
      content: message,
      sessionId,
    },
  })

  const recentMessages = await prisma.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  const history = recentMessages
    .reverse()
    .filter((item) => item.role === 'user' || item.role === 'assistant')
    .map((item) => ({
      role: item.role as 'user' | 'assistant',
      content: item.content,
    }))

  const baseUrl = (aiBaseUrl || 'https://api.deepseek.com').replace(/\/$/, '')

  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const toSse = (payload: Record<string, unknown>) =>
    encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(toSse({ type: 'session', sessionId }))

      try {
        const workingMessages: ChatMessage[] = [
          { role: 'system', content: ASSISTANT_SYSTEM_PROMPT },
          ...history,
        ]

        // ========== 阶段 A：非流式，判断要不要调工具 ==========
        const firstRes = await callDeepSeek({
          baseUrl,
          apiKey: aiApiKey,
          messages: workingMessages,
          stream: false,
          tools: CHAT_TOOLS,
          toolChoice: 'auto',
        })

        if (!firstRes.ok) {
          controller.enqueue(toSse({
            type: 'error',
            message: await readUpstreamError(firstRes),
          }))
          return
        }

        const firstJson = await firstRes.json() as DeepSeekChatResponse
        const firstMessage = firstJson.choices?.[0]?.message
        const toolCalls = firstMessage?.tool_calls || []

        // 无工具：直接伪流式输出首轮文本
        if (toolCalls.length === 0) {
          const fullText = firstMessage?.content?.trim() || '我暂时没有合适的回答，请换个问法试试。'
          const chunkSize = 8
          for (let i = 0; i < fullText.length; i += chunkSize) {
            controller.enqueue(toSse({
              type: 'token',
              content: fullText.slice(i, i + chunkSize),
            }))
          }

          const assistantMessage = await prisma.message.create({
            data: { role: 'assistant', content: fullText, sessionId },
          })
          controller.enqueue(toSse({
            type: 'done',
            sessionId,
            messageId: assistantMessage.id,
          }))
          return
        }

        // ========== 执行工具 ==========
        const usedTools = toolCalls.map((c) => c.function.name)
        controller.enqueue(toSse({ type: 'tools', names: usedTools }))

        workingMessages.push({
          role: 'assistant',
          content: firstMessage?.content ?? null,
          tool_calls: toolCalls,
        })

        for (const call of toolCalls) {
          const result = await runTool(call.function.name, call.function.arguments)
          workingMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: result,
          })
        }

        // ========== 阶段 B：带着工具结果流式回答 ==========
        const upstream = await callDeepSeek({
          baseUrl,
          apiKey: aiApiKey,
          messages: workingMessages,
          stream: true,
          tools: CHAT_TOOLS,
          toolChoice: 'none',
        })

        if (!upstream.ok) {
          controller.enqueue(toSse({
            type: 'error',
            message: await readUpstreamError(upstream),
          }))
          return
        }

        if (!upstream.body) {
          controller.enqueue(toSse({
            type: 'error',
            message: 'AI 服务未返回流数据',
          }))
          return
        }

        const reader = upstream.body.getReader()
        let fullText = ''
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || !trimmed.startsWith('data:')) continue

            const data = trimmed.slice(5).trim()
            if (data === '[DONE]') continue

            let token = ''
            try {
              const json = JSON.parse(data) as DeepSeekStreamChunk
              token = json.choices?.[0]?.delta?.content ?? ''
            } catch {
              continue
            }

            if (!token) continue
            fullText += token
            controller.enqueue(toSse({ type: 'token', content: token }))
          }
        }

        const assistantMessage = await prisma.message.create({
          data: { role: 'assistant', content: fullText, sessionId },
        })

        controller.enqueue(toSse({
          type: 'done',
          sessionId,
          messageId: assistantMessage.id,
        }))
      } catch {
        controller.enqueue(toSse({
          type: 'error',
          message: 'AI 服务暂时不可用，请稍后再试',
        }))
      } finally {
        controller.close()
      }
    },
  })

  return sendStream(event, stream)
})
