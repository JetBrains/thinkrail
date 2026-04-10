package dev.aiir.bonsai.android

import android.app.Application
import dev.aiir.bonsai.di.appModule
import org.koin.android.ext.koin.androidContext
import org.koin.core.context.startKoin

class BonsaiApp : Application() {
    override fun onCreate() {
        super.onCreate()
        startKoin {
            androidContext(this@BonsaiApp)
            modules(appModule)
        }
    }
}
