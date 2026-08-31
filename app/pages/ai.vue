<script setup lang="ts">
interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface SessionItem {
  id: string
  title: string
  createdAt: string
  messageCount: number
  preview: string
}

const question = ref('')
const sessionId = ref<string | null>(null)
const messages = ref<ChatMessage[]>([])
const loading = ref(false)
const error = ref('')
const listRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)

const historyOpen = ref(false)
const historyLoading = ref(false)
const historyError = ref('')
const sessions = ref<SessionItem[]>([])
const openingSessionId = ref<string | null>(null)
const renamingId = ref<string | null>(null)
const renameDraft = ref('')
const historyBusy = ref(false)

let msgSeq = 0
function nextId(prefix: string) {
  msgSeq += 1
  return `${prefix}-${Date.now()}-${msgSeq}`
}

async function scrollToBottom() {
  await nextTick()
  const el = listRef.value
  if (el) el.scrollTop = el.scrollHeight
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    askAi()
  }
}

function formatTime(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
}

async function refreshSessions() {
  sessions.value = await $fetch<SessionItem[]>('/api/sessions')
}

async function openHistory() {
  historyOpen.value = true
  historyError.value = ''
  historyLoading.value = true
  renamingId.value = null
  try {
    await refreshSessions()
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string }; message?: string }
    historyError.value = err.data?.statusMessage || err.message || '加载历史失败'
    sessions.value = []
  } finally {
    historyLoading.value = false
  }
}

function closeHistory() {
  historyOpen.value = false
  renamingId.value = null
  renameDraft.value = ''
}

async function openSession(id: string) {
  if (loading.value || openingSessionId.value || historyBusy.value || renamingId.value) return
  openingSessionId.value = id
  historyError.value = ''
  try {
    const data = await $fetch<{
      id: string
      messages: ChatMessage[]
    }>(`/api/sessions/${id}`)

    sessionId.value = data.id
    messages.value = data.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
    }))
    error.value = ''
    question.value = ''
    historyOpen.value = false
    await scrollToBottom()
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string }; message?: string }
    historyError.value = err.data?.statusMessage || err.message || '打开会话失败'
  } finally {
    openingSessionId.value = null
  }
}

function startRename(item: SessionItem, e: Event) {
  e.stopPropagation()
  if (historyBusy.value) return
  renamingId.value = item.id
  renameDraft.value = item.title
}

function cancelRename(e?: Event) {
  e?.stopPropagation()
  renamingId.value = null
  renameDraft.value = ''
}

async function saveRename(id: string, e?: Event) {
  e?.stopPropagation()
  const title = renameDraft.value.trim()
  if (!title || historyBusy.value) return

  historyBusy.value = true
  historyError.value = ''
  try {
    const updated = await $fetch<{ id: string; title: string }>(`/api/sessions/${id}`, {
      method: 'PATCH',
      body: { title },
    })
    const target = sessions.value.find((s) => s.id === id)
    if (target) target.title = updated.title
    renamingId.value = null
    renameDraft.value = ''
  } catch (err: unknown) {
    const e2 = err as { data?: { statusMessage?: string }; message?: string }
    historyError.value = e2.data?.statusMessage || e2.message || '重命名失败'
  } finally {
    historyBusy.value = false
  }
}

async function deleteSession(id: string, e: Event) {
  e.stopPropagation()
  if (historyBusy.value) return
  if (!confirm('确定删除这条历史会话？')) return

  historyBusy.value = true
  historyError.value = ''
  try {
    await $fetch(`/api/sessions/${id}`, { method: 'DELETE' })
    sessions.value = sessions.value.filter((s) => s.id !== id)
    if (sessionId.value === id) {
      clearChat()
    }
    if (renamingId.value === id) {
      renamingId.value = null
      renameDraft.value = ''
    }
  } catch (err: unknown) {
    const e2 = err as { data?: { statusMessage?: string }; message?: string }
    historyError.value = e2.data?.statusMessage || e2.message || '删除失败'
  } finally {
    historyBusy.value = false
  }
}

async function clearAllSessions() {
  if (historyBusy.value || sessions.value.length === 0) return
  if (!confirm('确定清空全部历史会话？此操作不可恢复。')) return

  historyBusy.value = true
  historyError.value = ''
  try {
    await $fetch('/api/sessions', { method: 'DELETE' })
    sessions.value = []
    clearChat()
    renamingId.value = null
    renameDraft.value = ''
  } catch (err: unknown) {
    const e2 = err as { data?: { statusMessage?: string }; message?: string }
    historyError.value = e2.data?.statusMessage || e2.message || '清空失败'
  } finally {
    historyBusy.value = false
  }
}

async function askAi() {
  const message = question.value.trim()
  if (!message || loading.value) return

  loading.value = true
  error.value = ''
  question.value = ''

  messages.value.push({
    id: nextId('user'),
    role: 'user',
    content: message,
  })

  const assistantId = nextId('assistant')
  messages.value.push({
    id: assistantId,
    role: 'assistant',
    content: '',
  })
  await scrollToBottom()

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        ...(sessionId.value ? { sessionId: sessionId.value } : {}),
      }),
    })

    if (!response.ok) {
      let msg = '请求失败'
      try {
        const errBody = await response.json()
        msg = errBody.statusMessage || errBody.message || msg
      } catch {
        // ignore
      }
      throw new Error(msg)
    }

    if (!response.body) {
      throw new Error('没有收到流数据')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
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
        let event: {
          type?: string
          content?: string
          sessionId?: string
          message?: string
          names?: string[]
        }
        try {
          event = JSON.parse(data)
        } catch {
          continue
        }

        if (event.type === 'session' && event.sessionId) {
          sessionId.value = event.sessionId
        } else if (event.type === 'tools' && event.names?.length) {
          const target = messages.value.find((m) => m.id === assistantId)
          if (target && !target.content) {
            const label = event.names
              .map((n) => (n === 'get_weather' ? '天气' : n === 'search_faq' ? 'FAQ' : n))
              .join('、')
            target.content = `正在查询：${label}…\n`
            await scrollToBottom()
          }
        } else if (event.type === 'token' && event.content) {
          const target = messages.value.find((m) => m.id === assistantId)
          if (target) {
            if (target.content.startsWith('正在查询：')) {
              target.content = ''
            }
            target.content += event.content
            await scrollToBottom()
          }
        } else if (event.type === 'error') {
          error.value = event.message || 'AI 出错了'
        } else if (event.type === 'done') {
          if (event.sessionId) {
            sessionId.value = event.sessionId
          }
        }
      }
    }

    const target = messages.value.find((m) => m.id === assistantId)
    if (target && !target.content && error.value) {
      target.content = error.value
    } else if (target && !target.content) {
      target.content = '（没有收到回复）'
    }
  } catch (e: unknown) {
    const err = e as { message?: string }
    error.value = err.message || '请求失败'
    const target = messages.value.find((m) => m.id === assistantId)
    if (target) {
      target.content = error.value
    }
  } finally {
    loading.value = false
    await nextTick()
    inputRef.value?.focus()
  }
}

function clearChat() {
  if (loading.value) return
  messages.value = []
  sessionId.value = null
  error.value = ''
  question.value = ''
}
</script>

<template>
  <div class="stage">
    <div class="phone">
      <div class="phone-notch" aria-hidden="true" />

      <header class="chat-header">
        <div class="header-main">
          <p class="brand">智能客服</p>
          <p class="status">
            {{ sessionId ? '会话已连接 · 天气 / FAQ 工具' : '新会话 · 可问天气或售后 FAQ' }}
          </p>
        </div>
        <div class="header-actions">
          <button type="button" class="header-btn" :disabled="loading" @click="openHistory">
            历史
          </button>
          <button
            type="button"
            class="header-btn"
            :disabled="loading || messages.length === 0"
            @click="clearChat"
          >
            清空
          </button>
        </div>
      </header>

      <div ref="listRef" class="chat-list" role="log" aria-live="polite">
        <div v-if="messages.length === 0" class="empty">
          <p class="empty-title">有什么想问的？</p>
          <p class="empty-hint">试试：北京今天天气怎么样？ / 七天无理由怎么退货？</p>
        </div>

        <div
          v-for="msg in messages"
          :key="msg.id"
          class="row"
          :class="msg.role === 'user' ? 'row-user' : 'row-ai'"
        >
          <div
            v-if="msg.role === 'assistant'"
            class="avatar avatar-ai"
            aria-hidden="true"
          >
            AI
          </div>

          <div
            class="bubble"
            :class="[
              msg.role === 'user' ? 'bubble-user' : 'bubble-ai',
              msg.role === 'assistant' && !msg.content && loading ? 'bubble-typing' : '',
            ]"
          >
            <template v-if="msg.role === 'assistant' && !msg.content && loading">
              <span class="dot" /><span class="dot" /><span class="dot" />
            </template>
            <template v-else>
              {{ msg.content }}
              <span
                v-if="msg.role === 'assistant' && loading && msg === messages[messages.length - 1] && msg.content"
                class="cursor"
              />
            </template>
          </div>

          <div
            v-if="msg.role === 'user'"
            class="avatar avatar-user"
            aria-hidden="true"
          >
            我
          </div>
        </div>
      </div>

      <footer class="composer">
        <textarea
          ref="inputRef"
          v-model="question"
          rows="1"
          placeholder="输入消息…"
          :disabled="loading"
          @keydown="onKeydown"
        />
        <button
          type="button"
          class="send-btn"
          :disabled="loading || !question.trim()"
          @click="askAi"
        >
          {{ loading ? '…' : '发送' }}
        </button>
      </footer>

      <div v-if="historyOpen" class="history-mask" @click="closeHistory" />
      <aside class="history-panel" :class="{ open: historyOpen }" aria-label="历史问答">
        <div class="history-head">
          <div>
            <p class="history-title">历史问答</p>
            <p class="history-sub">点击一条可继续该会话</p>
          </div>
          <button type="button" class="header-btn dark" @click="closeHistory">关闭</button>
        </div>

        <div class="history-body">
          <p v-if="historyLoading" class="history-state">加载中…</p>
          <p v-else-if="historyError" class="history-state error">{{ historyError }}</p>
          <p v-else-if="sessions.length === 0" class="history-state">暂无历史记录</p>

          <div
            v-for="item in sessions"
            :key="item.id"
            class="history-item"
            :class="{ active: item.id === sessionId, renaming: renamingId === item.id }"
          >
            <button
              type="button"
              class="history-main"
              :disabled="!!openingSessionId || historyBusy"
              @click="openSession(item.id)"
            >
              <div class="history-item-top">
                <template v-if="renamingId === item.id">
                  <input
                    v-model="renameDraft"
                    class="rename-input"
                    maxlength="40"
                    @click.stop
                    @keydown.enter.prevent="saveRename(item.id)"
                    @keydown.esc.prevent="cancelRename()"
                  >
                </template>
                <span v-else class="history-item-title">{{ item.title }}</span>
                <span class="history-item-time">{{ formatTime(item.createdAt) }}</span>
              </div>
              <p class="history-item-preview">{{ item.preview || '（无预览）' }}</p>
              <p class="history-item-meta">
                {{ item.messageCount }} 条消息
                <template v-if="openingSessionId === item.id"> · 打开中…</template>
              </p>
            </button>

            <div class="history-actions">
              <template v-if="renamingId === item.id">
                <button type="button" class="mini-btn" :disabled="historyBusy" @click="saveRename(item.id, $event)">
                  保存
                </button>
                <button type="button" class="mini-btn ghost" :disabled="historyBusy" @click="cancelRename($event)">
                  取消
                </button>
              </template>
              <template v-else>
                <button type="button" class="mini-btn" :disabled="historyBusy" @click="startRename(item, $event)">
                  重命名
                </button>
                <button type="button" class="mini-btn danger" :disabled="historyBusy" @click="deleteSession(item.id, $event)">
                  删除
                </button>
              </template>
            </div>
          </div>
        </div>

        <div class="history-foot">
          <button type="button" class="new-chat-btn" :disabled="loading || historyBusy" @click="clearChat(); closeHistory()">
            开始新会话
          </button>
          <button
            type="button"
            class="clear-all-btn"
            :disabled="historyBusy || sessions.length === 0"
            @click="clearAllSessions"
          >
            清空全部历史
          </button>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.stage {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 20px 12px;
  background:
    radial-gradient(ellipse 80% 50% at 50% -10%, #d9e8f6 0%, transparent 55%),
    linear-gradient(180deg, #eef4fa 0%, #c5d7ea 100%);
  font-family: 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  box-sizing: border-box;
}

.phone {
  width: min(100%, 390px);
  height: min(844px, calc(100dvh - 40px));
  display: flex;
  flex-direction: column;
  background: #f2f6fa;
  border-radius: 36px;
  box-shadow:
    0 0 0 10px #243447,
    0 0 0 12px #3d536b,
    0 28px 60px rgba(36, 52, 71, 0.32);
  overflow: hidden;
  position: relative;
}

.phone-notch {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  width: 112px;
  height: 28px;
  background: #243447;
  border-radius: 18px;
  z-index: 2;
}

.chat-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 48px 16px 14px;
  background: linear-gradient(180deg, #6ea4d4 0%, #548bbd 100%);
  color: #f5f9fd;
}

.brand {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.status {
  margin: 4px 0 0;
  font-size: 11px;
  opacity: 0.75;
}

.header-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.header-btn {
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: transparent;
  color: inherit;
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
}

.header-btn.dark {
  border-color: #c5d6e8;
  color: #2a3f55;
}

.header-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.chat-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  -webkit-overflow-scrolling: touch;
}

.empty {
  margin: auto;
  text-align: center;
  color: #5f748a;
  padding: 24px;
}

.empty-title {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
  color: #2a3f55;
}

.empty-hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
}

.row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  max-width: 100%;
}

.row-user {
  justify-content: flex-end;
}

.row-ai {
  justify-content: flex-start;
}

.avatar {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 700;
}

.avatar-ai {
  background: #d9e8f6;
  color: #3f6f9c;
}

.avatar-user {
  background: #6ea4d4;
  color: #fff;
}

.bubble {
  max-width: min(72%, 260px);
  padding: 10px 12px;
  border-radius: 16px;
  font-size: 14px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.bubble-user {
  background: #6ea4d4;
  color: #f5f9fd;
  border-top-right-radius: 4px;
}

.bubble-ai {
  background: #fff;
  color: #243447;
  border-top-left-radius: 4px;
  box-shadow: 0 1px 2px rgba(36, 52, 71, 0.06);
}

.bubble-typing {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 52px;
  min-height: 20px;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #8eabc6;
  animation: bounce 1.2s infinite ease-in-out;
}

.dot:nth-child(2) {
  animation-delay: 0.15s;
}

.dot:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes bounce {
  0%,
  80%,
  100% {
    transform: translateY(0);
    opacity: 0.45;
  }
  40% {
    transform: translateY(-4px);
    opacity: 1;
  }
}

.cursor {
  display: inline-block;
  width: 2px;
  height: 0.95em;
  margin-left: 2px;
  vertical-align: -2px;
  background: #548bbd;
  animation: blink 0.9s step-end infinite;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}

.composer {
  flex-shrink: 0;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 12px calc(12px + env(safe-area-inset-bottom));
  background: #fff;
  border-top: 1px solid #d5e2ef;
}

.composer textarea {
  flex: 1;
  min-height: 40px;
  max-height: 96px;
  resize: none;
  border: 1px solid #c5d6e8;
  border-radius: 18px;
  padding: 10px 14px;
  font: inherit;
  font-size: 14px;
  line-height: 1.4;
  background: #f5f9fd;
  outline: none;
}

.composer textarea:focus {
  border-color: #6ea4d4;
}

.composer textarea:disabled {
  opacity: 0.6;
}

.send-btn {
  flex-shrink: 0;
  height: 40px;
  min-width: 64px;
  border: none;
  border-radius: 18px;
  background: #6ea4d4;
  color: #fff;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.send-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.history-mask {
  position: absolute;
  inset: 0;
  background: rgba(36, 52, 71, 0.32);
  z-index: 4;
}

.history-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 86%;
  max-width: 320px;
  background: #f5f9fd;
  z-index: 5;
  display: flex;
  flex-direction: column;
  transform: translateX(105%);
  transition: transform 0.22s ease;
  box-shadow: -8px 0 24px rgba(36, 52, 71, 0.12);
}

.history-panel.open {
  transform: translateX(0);
}

.history-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 48px 14px 12px;
  border-bottom: 1px solid #d5e2ef;
  background: #fff;
}

.history-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #243447;
}

.history-sub {
  margin: 4px 0 0;
  font-size: 11px;
  color: #5f748a;
}

.history-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.history-state {
  margin: 24px 8px;
  text-align: center;
  font-size: 13px;
  color: #5f748a;
}

.history-state.error {
  color: #a33b2b;
}

.history-item {
  border: 1px solid #d5e2ef;
  background: #fff;
  border-radius: 12px;
  padding: 0;
  overflow: hidden;
}

.history-item.active {
  border-color: #6ea4d4;
  background: #e8f1f9;
}

.history-item.renaming {
  border-color: #6ea4d4;
}

.history-main {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  padding: 10px 12px 6px;
  cursor: pointer;
  font: inherit;
  color: inherit;
}

.history-main:disabled {
  opacity: 0.65;
  cursor: wait;
}

.history-actions {
  display: flex;
  gap: 6px;
  padding: 0 10px 10px;
}

.mini-btn {
  border: 1px solid #c5d6e8;
  background: #f5f9fd;
  color: #2a3f55;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
}

.mini-btn.ghost {
  background: transparent;
}

.mini-btn.danger {
  border-color: #e4b4ad;
  color: #a33b2b;
  background: #fff5f3;
}

.mini-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.rename-input {
  flex: 1;
  min-width: 0;
  border: 1px solid #6ea4d4;
  border-radius: 8px;
  padding: 4px 8px;
  font: inherit;
  font-size: 13px;
  outline: none;
  background: #fff;
}

.history-item-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: baseline;
}

.history-item-title {
  font-size: 13px;
  font-weight: 650;
  color: #243447;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-item-time {
  flex-shrink: 0;
  font-size: 11px;
  color: #7f93a8;
}

.history-item-preview {
  margin: 6px 0 0;
  font-size: 12px;
  color: #5f748a;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.history-item-meta {
  margin: 6px 0 0;
  font-size: 11px;
  color: #8eabc6;
}

.history-foot {
  padding: 10px 12px calc(12px + env(safe-area-inset-bottom));
  border-top: 1px solid #d5e2ef;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.new-chat-btn {
  width: 100%;
  height: 40px;
  border: none;
  border-radius: 18px;
  background: #6ea4d4;
  color: #fff;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.new-chat-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.clear-all-btn {
  width: 100%;
  height: 36px;
  border: 1px solid #e4b4ad;
  border-radius: 18px;
  background: #fff;
  color: #a33b2b;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.clear-all-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

@media (max-width: 420px) {
  .stage {
    padding: 0;
    background: #f2f6fa;
  }

  .phone {
    width: 100%;
    height: 100dvh;
    border-radius: 0;
    box-shadow: none;
  }

  .phone-notch {
    display: none;
  }

  .chat-header,
  .history-head {
    padding-top: calc(14px + env(safe-area-inset-top));
  }
}
</style>
