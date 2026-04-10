package dev.aiir.bonsai.data.serialization

import kotlinx.serialization.json.Json

val BonsaiJson = Json {
    ignoreUnknownKeys = true
    coerceInputValues = true
    isLenient = true
    encodeDefaults = true
    explicitNulls = false
}
