/**
 * ActionStore — хранилище активных (незавершённых) action-контекстов.
 * Ключ: actionId (string)
 * Значение: { ctx, createdAt, userId }
 */
export const ActionStore = new Map();
