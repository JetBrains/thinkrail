package dev.aiir.bonsai.di

import dev.aiir.bonsai.network.connection.ConnectionManager
import dev.aiir.bonsai.network.rest.RestClient
import dev.aiir.bonsai.network.rpc.RpcClient
import dev.aiir.bonsai.network.rpc.RpcMethods
import io.ktor.client.*
import io.ktor.client.plugins.websocket.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.koin.dsl.module

val appModule = module {
    single {
        CoroutineScope(Dispatchers.Default + SupervisorJob())
    }

    single {
        HttpClient {
            install(WebSockets)
        }
    }

    single { RpcClient(httpClient = get(), scope = get()) }
    single { RpcMethods(client = get()) }
    single { RestClient(httpClient = get()) }
    single { ConnectionManager(rpcClient = get(), restClient = get()) }
}
