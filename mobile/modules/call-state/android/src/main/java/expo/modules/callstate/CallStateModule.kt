package expo.modules.callstate

import android.app.PictureInPictureParams
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioManager
import android.os.Build
import android.util.Rational
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Two small phone-level helpers for calls:
// 1. Is the phone already in a call? Android puts the audio system in MODE_IN_CALL during a normal phone call and in
//    MODE_IN_COMMUNICATION during a VoIP call (WhatsApp, Meet, Telegram, ...), and MODE_RINGTONE while one rings.
//    Reading the mode needs no permission (unlike TelephonyManager.getCallState, which needs READ_PHONE_STATE).
// 2. Picture-in-picture: shrink the running video call into the small movable window that floats over other apps
//    (what WhatsApp does when you press back / home during a video call). Needs Android 8+ and the activity flags
//    added by the config plugin in mobile/app.config.js.
class CallStateModule : Module() {
  // True while a connected video call is on screen: leaving the app then turns the call into the floating window.
  @Volatile private var pipArmed = false

  private fun pipSupported(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
    val context = appContext.reactContext ?: return false
    return context.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)
  }

  private fun pipParams(autoEnter: Boolean): PictureInPictureParams {
    val builder = PictureInPictureParams.Builder().setAspectRatio(Rational(9, 16))
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      // Android 12+: swiping home or using the gesture bar enters the window by itself, with no flicker.
      builder.setAutoEnterEnabled(autoEnter)
      builder.setSeamlessResizeEnabled(false)
    }
    return builder.build()
  }

  override fun definition() = ModuleDefinition {
    Name("ChahatCallState")

    Function("getAudioMode") {
      val context: Context? = appContext.reactContext
      val audio = context?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      audio?.mode ?: AudioManager.MODE_NORMAL
    }

    Function("isPictureInPictureSupported") {
      pipSupported()
    }

    Function("isInPictureInPictureMode") {
      val activity = appContext.currentActivity
      if (activity != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) activity.isInPictureInPictureMode else false
    }

    // Turn the floating window on when a video call connects and off when it ends.
    AsyncFunction("setPictureInPictureArmed") { armed: Boolean ->
      pipArmed = armed
      val activity = appContext.currentActivity
      if (activity != null && pipSupported() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        try {
          activity.setPictureInPictureParams(pipParams(armed))
        } catch (_: Exception) {
          // Best effort: the back button still works through enterPictureInPicture.
        }
      }
    }.runOnQueue(Queues.MAIN)

    // Back button during a connected call: shrink into the floating window. Returns false if Android refuses.
    AsyncFunction("enterPictureInPicture") {
      val activity = appContext.currentActivity
      if (activity == null || !pipSupported()) {
        false
      } else {
        try {
          activity.enterPictureInPictureMode(pipParams(pipArmed))
        } catch (_: Exception) {
          false
        }
      }
    }.runOnQueue(Queues.MAIN)

    // Android 8 to 11 have no automatic entry: enter the window as the user leaves the app (home button).
    OnUserLeavesActivity {
      val activity = appContext.currentActivity
      if (pipArmed && activity != null && pipSupported() && Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        try {
          activity.enterPictureInPictureMode(pipParams(false))
        } catch (_: Exception) {
          // Not allowed right now (for example the activity is finishing): nothing to do.
        }
      }
    }
  }
}
