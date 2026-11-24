// mobile/partner_app/lib/services/partner_push_service.dart
// Wave J-2: FCM push client (new-order alerts). Every Firebase touch is
// guarded: without the Firebase console files (a human step) init fails and
// push stays dormant, with no UI and no crash. Foreground messages render
// through a local notification; background and terminated messages are
// displayed by the OS from the FCM notification block.

import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import '../models/push_message.dart';
import 'partner_api_service.dart';

@pragma('vm:entry-point')
Future<void> partnerMessagingBackgroundHandler(RemoteMessage message) async {
  try {
    await Firebase.initializeApp();
  } catch (_) {}
}

class PartnerPushService {
  static bool _ready = false;
  static String? _token;
  static StreamSubscription<String>? _refreshSub;
  static FlutterLocalNotificationsPlugin? _local;

  /// GAP-02: assigned by main() — tapping a new-order notification opens the
  /// shipment list pre-filtered to that order (plain dispatch fallback).
  static void Function(PartnerPushRoute)? onNotificationTap;

  static bool get isReady => _ready;

  static void _fireTap(PartnerPushRoute route) {
    try {
      onNotificationTap?.call(route);
    } catch (_) {}
  }

  static PartnerPushRoute _routeFromPayload(String? raw) {
    try {
      if (raw != null && raw.isNotEmpty) {
        final decoded = jsonDecode(raw);
        if (decoded is Map<String, dynamic>) {
          return PartnerPushRoute.fromData(decoded);
        }
      }
    } catch (_) {}
    return PartnerPushRoute.dispatch;
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
        'olmoa_seller_orders',
        '새 주문 알림',
        description: '결제 완료 새 주문 알림',
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
          partnerMessagingBackgroundHandler);
      FirebaseMessaging.onMessage.listen(_showForeground);
      FirebaseMessaging.onMessageOpenedApp.listen((message) {
        try {
          _fireTap(PartnerPushRoute.fromData(message.data));
        } catch (_) {}
      }, onError: (_) {});
      FirebaseMessaging.instance.getInitialMessage().then((message) {
        if (message != null) {
          try {
            _fireTap(PartnerPushRoute.fromData(message.data));
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
      final parsed = PartnerPushMessage.fromMap({
        'title': message.notification?.title,
        'body': message.notification?.body,
        'data': message.data,
      });
      await _local?.show(
        id: DateTime.now().millisecondsSinceEpoch ~/ 1000,
        title: parsed.title,
        body: parsed.body,
        payload: jsonEncode({'type': parsed.type, 'order_no': parsed.orderNo}),
        notificationDetails: const NotificationDetails(
          android: AndroidNotificationDetails(
            'olmoa_seller_orders',
            '새 주문 알림',
            importance: Importance.high,
            priority: Priority.high,
          ),
          iOS: DarwinNotificationDetails(),
        ),
      );
    } catch (_) {}
  }

  /// Call after a successful seller sign-in.
  static Future<void> syncAfterLogin() async {
    if (!_ready || !PartnerAuthSession.isAuthenticated) return;
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
          await PartnerApiService.registerPushToken(
              token: token, platform: _platform);
        } catch (_) {}
      }
      _refreshSub ??=
          FirebaseMessaging.instance.onTokenRefresh.listen((t) async {
        _token = t;
        try {
          await PartnerApiService.registerPushToken(
              token: t, platform: _platform);
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
        await PartnerApiService.unregisterPushToken(token: token);
      } catch (_) {}
    }
    try {
      await FirebaseMessaging.instance.deleteToken();
    } catch (_) {}
  }
}
