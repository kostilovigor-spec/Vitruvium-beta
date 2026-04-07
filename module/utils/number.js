export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value))
}

export function toNumber(value, fallback = 0) {
    const n = Number(value)
    return Number.isNaN(n) ? fallback : n
}
