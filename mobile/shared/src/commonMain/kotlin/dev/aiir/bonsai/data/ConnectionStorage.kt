package dev.aiir.bonsai.data

import dev.aiir.bonsai.data.model.RecentProject
import dev.aiir.bonsai.data.model.ServerAddress

/**
 * Persists recent server addresses and recently opened projects.
 * Platform-specific implementations handle the actual storage (e.g., SharedPreferences on Android).
 */
interface ConnectionStorage {
    fun getRecentServers(): List<ServerAddress>
    fun addRecentServer(host: String, port: Int)
    fun getRecentProjects(host: String, port: Int): List<RecentProject>
    fun addRecentProject(host: String, port: Int, path: String, name: String)
}
