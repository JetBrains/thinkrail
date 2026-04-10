package dev.aiir.bonsai.android.service

import android.app.*
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import dev.aiir.bonsai.android.MainActivity
import dev.aiir.bonsai.data.model.SessionStatus
import dev.aiir.bonsai.network.rpc.ConnectionState
import dev.aiir.bonsai.network.rpc.RpcClient
import dev.aiir.bonsai.network.rpc.RpcMethods
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collectLatest
import org.koin.android.ext.android.inject

/**
 * Foreground service that keeps the WebSocket connection alive when the app is in the background.
 * Also monitors for sessions that need attention and shows notifications.
 */
class BonsaiConnectionService : Service() {

    private val rpcClient: RpcClient by inject()
    private val rpcMethods: RpcMethods by inject()
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = buildConnectionNotification("Connected")
        startForeground(NOTIFICATION_ID_CONNECTION, notification)

        // Monitor connection state
        scope.launch {
            rpcClient.connectionState.collectLatest { state ->
                val text = when (state) {
                    is ConnectionState.Connected -> "Connected"
                    is ConnectionState.Connecting -> "Reconnecting..."
                    is ConnectionState.Error -> "Disconnected: ${state.message}"
                    ConnectionState.Disconnected -> "Disconnected"
                }
                val updatedNotification = buildConnectionNotification(text)
                val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
                nm.notify(NOTIFICATION_ID_CONNECTION, updatedNotification)
            }
        }

        // Monitor for sessions needing attention
        scope.launch {
            rpcClient.notificationsFor("agent/").collect { notification ->
                if (notification.method in listOf("agent/askUserQuestion", "agent/confirmAction")) {
                    showAttentionNotification(notification.method)
                }
            }
        }

        return START_STICKY
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager

            val connectionChannel = NotificationChannel(
                CHANNEL_CONNECTION,
                "Connection Status",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Shows Bonsai connection status"
            }
            nm.createNotificationChannel(connectionChannel)

            val alertChannel = NotificationChannel(
                CHANNEL_ALERTS,
                "Session Alerts",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "Alerts when sessions need your attention"
            }
            nm.createNotificationChannel(alertChannel)
        }
    }

    private fun buildConnectionNotification(text: String): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE,
        )

        return NotificationCompat.Builder(this, CHANNEL_CONNECTION)
            .setContentTitle("Bonsai")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_manage)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }

    private fun showAttentionNotification(method: String) {
        val title = when (method) {
            "agent/askUserQuestion" -> "Session has a question"
            "agent/confirmAction" -> "Session needs approval"
            else -> "Session needs attention"
        }

        val pendingIntent = PendingIntent.getActivity(
            this, 1,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ALERTS)
            .setContentTitle(title)
            .setContentText("Tap to respond")
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIFICATION_ID_ALERT, notification)
    }

    companion object {
        const val CHANNEL_CONNECTION = "bonsai_connection"
        const val CHANNEL_ALERTS = "bonsai_alerts"
        const val NOTIFICATION_ID_CONNECTION = 1001
        const val NOTIFICATION_ID_ALERT = 1002
    }
}
