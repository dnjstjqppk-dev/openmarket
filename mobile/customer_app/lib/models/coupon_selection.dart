// mobile/customer_app/lib/models/coupon_selection.dart
// Pure two-level coupon picking (3-12): one platform coupon per order plus
// one store coupon per seller in the cart. Mirrors the web checkout and the
// server COUPON_DUPLICATE_GROUP rules; the server re-validates every pick.

/// Holdings usable in the platform slot (PLATFORM group or ungrouped legacy).
List<Map<String, dynamic>> platformCoupons(List<Map<String, dynamic>> usable) =>
    usable.where((c) => (c['dup_group'] ?? 'PLATFORM') == 'PLATFORM').toList();

/// STORE holdings grouped by seller id (empty seller ids dropped).
Map<String, List<Map<String, dynamic>>> storeCouponsBySeller(
    List<Map<String, dynamic>> usable) {
  final out = <String, List<Map<String, dynamic>>>{};
  for (final c in usable) {
    if (c['dup_group'] != 'STORE') continue;
    final seller = (c['seller_id'] ?? '').toString();
    if (seller.isEmpty) continue;
    out.putIfAbsent(seller, () => []).add(c);
  }
  return out;
}

/// Distinct non-empty seller ids in cart order.
List<String> cartSellerIds(List<String> linePartnerIds) {
  final seen = <String>{};
  for (final id in linePartnerIds) {
    if (id.isNotEmpty) seen.add(id);
  }
  return seen.toList();
}

/// Drops picks for sellers no longer in the cart and picks whose holding is
/// no longer usable (claimed elsewhere, expired, used).
Map<String, String> pruneStorePicks(
  Map<String, String> picks,
  Set<String> cartSellers,
  List<Map<String, dynamic>> usable,
) {
  final live = usable
      .where((c) => c['dup_group'] == 'STORE')
      .map((c) => '${c['seller_id']}:${c['user_coupon_id']}')
      .toSet();
  final out = <String, String>{};
  for (final e in picks.entries) {
    if (!cartSellers.contains(e.key)) continue;
    if (!live.contains('${e.key}:${e.value}')) continue;
    out[e.key] = e.value;
  }
  return out;
}
