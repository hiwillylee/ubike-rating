package tw.bikerating

import android.app.Application
import androidx.camera.camera2.Camera2Config
import androidx.camera.core.CameraSelector
import androidx.camera.core.CameraXConfig

class BikeApp : Application(), CameraXConfig.Provider {
    /** 只用後鏡頭：沒有前鏡頭的裝置（例如模擬器）不會在 CameraX 初始化時重試好幾秒 */
    override fun getCameraXConfig(): CameraXConfig =
        CameraXConfig.Builder.fromConfig(Camera2Config.defaultConfig())
            .setAvailableCamerasLimiter(CameraSelector.DEFAULT_BACK_CAMERA)
            .build()
}
