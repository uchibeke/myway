/**
 * Store barrel — import all persistence helpers from one place.
 *
 * softDelete is intentionally NOT re-exported here because every store has one
 * and they'd collide. Import directly from the relevant module when you need it:
 *
 *   import { softDelete } from '@/lib/store/messages'
 *   import { softDelete } from '@/lib/store/memories'
 *   import { softDelete } from '@/lib/store/artifacts'
 *   import { softDelete } from '@/lib/store/conversations'
 */

// ── Conversations ─────────────────────────────────────────────────────────────
export {
  getConversation,
  listConversations,
  getLastConversation,
  createConversation,
  ensureConversation,
  setTitle,
  touchConversation,
} from './conversations'
export type { Conversation } from './conversations'

// ── Messages ──────────────────────────────────────────────────────────────────
export {
  getMessages,
  getRecentByApp,
  getContextMessages,
  addMessage,
  addUser,
  addAssistant,
  addAppMessage,
} from './messages'
export type { Message, MessageRole, AddMessageOpts } from './messages'

// ── Memories ──────────────────────────────────────────────────────────────────
export {
  getMemories,
  getGlobalMemories,
  getContextMemories,
  addMemory,
} from './memories'
export type { Memory, MemoryType, AddMemoryOpts } from './memories'

// ── Artifacts ─────────────────────────────────────────────────────────────────
export {
  storeArtifact,
  getArtifact,
  listArtifacts,
} from './artifacts'
export type { Artifact, StoreArtifactOpts } from './artifacts'

// ── Personality state ─────────────────────────────────────────────────────────
export {
  getSignal,
  getValue,
  getAllSignals,
  setSignal,
  setSignals,
} from './personality'
export type { PersonalitySignal } from './personality'

// ── App message bus ───────────────────────────────────────────────────────────
export {
  subscribe,
  unsubscribeAll,
  publish,
  getPending,
  markDelivered,
  markFailed,
  clearPending,
} from './bus'
export type { BusMessage, PublishOpts } from './bus'

// ── Notifications ─────────────────────────────────────────────────────────────
export {
  getPendingNotifications,
  getActiveNotifications,
  getNotification,
  addNotification,
  markShown,
  markAllShown,
  dismissNotification,
  sweepExpired,
  hasTodaysBrief,
} from './notifications'
export type { Notification, NotificationType, NotificationStatus, AddNotificationOpts } from './notifications'

// ── Tasks ─────────────────────────────────────────────────────────────────────
export {
  getOpenTasks,
  getTodaysTasks,
  getTasksByApp,
  getTask,
  addTask,
  updateTask,
  completeTask,
  archiveTask,
  getDoneToday,
  getTaskSummary,
} from './tasks'
export type { Task, TaskStatus, TaskSource, TaskContext, AddTaskOpts, UpdateTaskOpts } from './tasks'

// ── Briefings ────────────────────────────────────────────────────────────────
export {
  getBriefing,
  listBriefings,
  getLatestBriefing,
  hasTodaysBriefing,
  hasThisWeeksBriefing,
  getBriefingsInRange,
  addBriefing,
} from './briefings'
export type { Briefing, BriefingType, BriefingSection, AddBriefingOpts } from './briefings'
