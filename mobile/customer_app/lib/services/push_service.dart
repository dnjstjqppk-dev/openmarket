// mobile/customer_app/lib/services/push_service.dart
// Wave H-2: FCM push client. Every Firebase touch is guarded: without the
// Firebase console files (google-services.json / GoogleService-Info.plist —
// a human step) init fails and push stays dormant, with no UI and no crash.
// Foreground messages render through a local notification; background and
// terminated messages are displayed by the OS from the FCM notification block.

import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import '../models/push_message.dart';
import 'api_service.dart';

/// Background/terminated handler: must stay top-level for the engine.
/// Notification-block messages display automatically; this only re-inits
/// Firebase so the handler itself never crashes.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  try {
    await Firebase.initializeApp();
  } catch (_) {}
}

class PushService {
  static bool _ready = false;
  static String? _token;
  static StreamSubscription<String>? _refreshSub;
  static FlutterLocalNotificationsPlugin? _local;

  /// GAP-02: assigned by main() — tapping a notification navigates to the
  /// parsed route (order/product detail, inbox fallback). Null in tests and
  /// before boot, where taps are impossible.
  static Future<void> Function(OlmoaPushRoute)? onNotificationTap;

  static bool get isReady => _ready;

  static void _fireTap(OlmoaPushRoute route) {
    final cb = onNotificationTap;
    if (cb == null) return;
    try {
      unawaited(cb(route));
    } catch (_) {}
  }

  static OlmoaPushRoute _routeFromPayload(String? raw) {
    try {
      if (raw != null && raw.isNotEmpty) {
        final decoded = jsonDecode(raw);
        if (decoded is Map<String, dynamic>) {
          return OlmoaPushRoute.fromData(decoded);
        }
      }
    } catch (_) {}
    return OlmoaPushRoute.inbox;
  }

  static String get _platform => Platform.isIOS ? 'IOS' : 'ANDROID';

  static Future<void> init() async {
    if (_ready) return;
    try {
      await Firebase.initializeApp();
      _local = FlutterLocalNotificationsPlugin();
      await _local!.initialize(
        settings: const InitializationSettings(
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
          iOS: DarwinInitializationSettings(),
        ),
        onDidReceiveNotificationResponse: (response) {
          _fireTap(_routeFromPayload(response.payload));
        },
      );
      const channel = AndroidNotificationChannel(
        'olmoa_orders',
        '주문 알림',
        description: '출고·배송·환불 알림',
        importance: Importance.high,
      );
      await _local!
          .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(channel);
      await FirebaseMessaging.instance
          .setForegroundNotificationPresentationOptions(
              alert: true, badge: true, sound: true);
      FirebaseMessaging.onBackgroundMessage(
          firebaseMessagingBackgroundHandler);
      FirebaseMessaging.onMessage.listen(_showForeground);
      FirebaseMessaging.onMessageOpenedApp.listen((message) {
        try {
          _fireTap(OlmoaPushRoute.fromData(message.data));
        } catch (_) {}
      }, onError: (_) {});
      FirebaseMessaging.instance.getInitialMessage().then((message) {
        if (message != null) {
          try {
            _fireTap(OlmoaPushRoute.fromData(message.data));
          } catch (_) {}
        }
      }).catchError((_) => null);
      _ready = true;
    } catch (_) {
      _ready = false;
    }
  }

  static Future<void> _showForeground(RemoteMessage message) async {
    try {
      final parsed = OlmoaPushMessage.fromMap({
        'title': message.notification?.title,
        'body': message.notification?.body,
        'data': message.data,
      });
      await _local?.show(
        id: DateTime.now().millisecondsSinceEpoch ~/ 1000,
        title: parsed.title,
        body: parsed.body,
        payload: jsonEncode({
          'type': parsed.type,
          'order_no': parsed.orderNo,
          'product_id': parsed.productId,
        }),
        notificationDetails: const NotificationDetails(
          android: AndroidNotificationDetails(
            'olmoa_orders',
            '주문 알림',
            importance: Importance.high,
            priority: Priority.high,
          ),
          iOS: DarwinNotificationDetails(),
        ),
      );
    } catch (_) {}
  }

  /// Call after every successful sign-in (password, register, social).
  /// Requests permission, fetches the FCM token, and registers it server-side.
  /// Rotations re-register through the same listener.
  static Future<void> syncAfterLogin() async {
    if (!_ready || !AuthSession.isAuthenticated) return;
    try {
      final settings = await FirebaseMessaging.instance.requestPermission();
      if (settings.authorizationStatus != AuthorizationStatus.authorized &&
          settings.authorizationStatus != AuthorizationStatus.provisional) {
        return;
      }
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null && token.isNotEmpty) {
        _token = token;
        try {
          await ApiService.registerPushToken(
              token: token, platform: _platform);
        } catch (_) {}
      }
      _refreshSub ??=
          FirebaseMessaging.instance.onTokenRefresh.listen((t) async {
        _token = t;
        try {
          await ApiService.registerPushToken(token: t, platform: _platform);
        } catch (_) {}
      }, onError: (_) {});
    } catch (_) {}
  }

  /// Call BEFORE the local session is cleared (the DELETE needs auth).
  static Future<void> unregister() async {
    final token = _token;
    _token = null;
    try {
      await _refreshSub?.cancel();
    } catch (_) {}
    _refreshSub = null;
    if (token != null && token.isNotEmpty) {
      try {
        await ApiService.unregisterPushToken(token: token);
      } catch (_) {}
    }
    try {
      await FirebaseMessaging.instance.deleteToken();
    } catch (_) {}
  }

  /// Test seam: forget everything without touching plugins.
  static void debugReset() {
    _ready = false;
    _token = null;
  }
}
