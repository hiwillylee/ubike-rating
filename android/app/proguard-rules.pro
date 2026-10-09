# ONNX Runtime 透過 JNI 呼叫 Java 類別，不能被 R8 移除或改名
-keep class ai.onnxruntime.** { *; }

# kotlinx.serialization 產生的序列化器
-keepattributes *Annotation*, InnerClasses
-keepclassmembers @kotlinx.serialization.Serializable class ** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}

# security-crypto 依賴的 Tink 參照了只在編譯期使用的 errorprone 註解
-dontwarn com.google.errorprone.annotations.**
