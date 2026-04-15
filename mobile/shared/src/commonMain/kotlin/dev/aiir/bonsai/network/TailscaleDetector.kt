package dev.aiir.bonsai.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.net.InetSocketAddress
import java.net.Socket

/**
 * Detects whether the Tailscale VPN is active on this device.
 *
 * Probes the Tailscale Quad100 DNS resolver at 100.100.100.100,
 * which is always reachable when the VPN tunnel is up.
 */
object TailscaleDetector {

    private const val QUAD100_HOST = "100.100.100.100"
    private const val QUAD100_PORT = 80
    private const val TIMEOUT_MS = 1500

    /**
     * Returns `true` if Tailscale VPN appears to be active.
     *
     * Any successful TCP connect to the Quad100 address means
     * the VPN is up. Only a timeout or connection failure means it is not.
     */
    suspend fun isVpnActive(): Boolean = withContext(Dispatchers.IO) {
        try {
            withTimeoutOrNull(TIMEOUT_MS.toLong()) {
                val socket = Socket()
                try {
                    socket.connect(InetSocketAddress(QUAD100_HOST, QUAD100_PORT), TIMEOUT_MS)
                    true
                } finally {
                    try { socket.close() } catch (_: Exception) {}
                }
            } ?: false
        } catch (_: Exception) {
            false
        }
    }
}
