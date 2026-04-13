package dev.aiir.bonsai

/**
 * Platform abstraction for KMP.
 * Android implementation provides actual platform details.
 */
expect fun getPlatformName(): String
