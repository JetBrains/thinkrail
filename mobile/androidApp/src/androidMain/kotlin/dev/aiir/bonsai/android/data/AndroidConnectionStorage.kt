package dev.aiir.bonsai.android.data

import android.content.Context
import android.content.SharedPreferences
import dev.aiir.bonsai.data.ConnectionStorage
import dev.aiir.bonsai.data.model.RecentProject
import dev.aiir.bonsai.data.model.ServerAddress
import dev.aiir.bonsai.data.serialization.BonsaiJson
import kotlinx.serialization.builtins.ListSerializer

class AndroidConnectionStorage(context: Context) : ConnectionStorage {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("bonsai_connections", Context.MODE_PRIVATE)

    override fun getRecentServers(): List<ServerAddress> {
        val json = prefs.getString("recent_servers", null) ?: return emptyList()
        return try {
            BonsaiJson.decodeFromString(ListSerializer(ServerAddress.serializer()), json)
        } catch (_: Exception) { emptyList() }
    }

    override fun addRecentServer(host: String, port: Int, token: String?, connectionMode: String) {
        val existing = getRecentServers().toMutableList()
        existing.removeAll { it.host == host && it.port == port }
        existing.add(0, ServerAddress(host = host, port = port, token = token, connectionMode = connectionMode, lastConnected = System.currentTimeMillis()))
        val trimmed = existing.take(5)
        prefs.edit()
            .putString("recent_servers", BonsaiJson.encodeToString(ListSerializer(ServerAddress.serializer()), trimmed))
            .apply()
    }

    override fun getRecentProjects(host: String, port: Int): List<RecentProject> {
        val key = "recent_projects_${host}_${port}"
        val json = prefs.getString(key, null) ?: return emptyList()
        return try {
            BonsaiJson.decodeFromString(ListSerializer(RecentProject.serializer()), json)
        } catch (_: Exception) { emptyList() }
    }

    override fun addRecentProject(host: String, port: Int, path: String, name: String) {
        val key = "recent_projects_${host}_${port}"
        val existing = getRecentProjects(host, port).toMutableList()
        existing.removeAll { it.path == path }
        existing.add(0, RecentProject(path = path, name = name, lastOpened = System.currentTimeMillis()))
        val trimmed = existing.take(5)
        prefs.edit()
            .putString(key, BonsaiJson.encodeToString(ListSerializer(RecentProject.serializer()), trimmed))
            .apply()
    }
}
