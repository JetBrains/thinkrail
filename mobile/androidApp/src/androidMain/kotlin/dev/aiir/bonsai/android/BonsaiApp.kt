package dev.aiir.bonsai.android

import android.app.Application
import dev.aiir.bonsai.android.data.AndroidConnectionStorage
import dev.aiir.bonsai.data.ConnectionStorage
import dev.aiir.bonsai.di.appModule
import org.koin.android.ext.koin.androidContext
import org.koin.core.context.startKoin
import org.koin.dsl.module

class BonsaiApp : Application() {
    override fun onCreate() {
        super.onCreate()

        val androidModule = module {
            single<ConnectionStorage> { AndroidConnectionStorage(get()) }
        }

        startKoin {
            androidContext(this@BonsaiApp)
            modules(appModule, androidModule)
        }
    }
}
