# 星河通讯 Android APP

这是现有公网 Web APP 的 Android WebView 客户端，默认连接：
`https://xinghe-chat.onrender.com/`

## 用 Android Studio 打包

1. 安装 Android Studio（包含 Android SDK 35）。
2. 用 Android Studio 打开本目录 `android`。
3. 等待 Gradle 同步完成。
4. 选择 `Build > Build Bundle(s) / APK(s) > Build APK(s)`。
5. APK 位于 `app/build/outputs/apk/debug/app-debug.apk`。

发布到应用商店时，请使用 `Build > Generate Signed Bundle / APK` 创建签名版本。

如需更换后端地址，修改 `app/src/main/java/com/xinghe/chat/MainActivity.kt` 中的 `appUrl`。
