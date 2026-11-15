// Two-level coupon picking (3-12): platform holdings plus one store coupon
// per seller in the cart. Pure selection rules; the server re-validates.
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_customer/models/coupon_selection.dart';

Map<String, dynamic> c(String id, String group, [String seller = '']) => {
      'user_coupon_id': id,
      if (group.isNotEmpty) 'dup_group': group,
      'seller_id': seller,
    };

void main() {
  test('platform() keeps PLATFORM and ungrouped holdings', () {
    final rows = [c('a', 'PLATFORM'), c('b', 'STORE', 's1'), c('d', '')];
    expect(platformCoupons(rows).map((e) => e['user_coupon_id']), ['a', 'd']);
  });

  test('storeBySeller() groups STORE holdings by seller', () {
    final rows = [c('a', 'PLATFORM'), c('b', 'STORE', 's1'), c('e', 'STORE', 's2')];
    final grouped = storeCouponsBySeller(rows);
    expect(grouped.keys.toSet(), {'s1', 's2'});
    expect(grouped['s1']!.map((e) => e['user_coupon_id']), ['b']);
  });

  test('pruneStorePicks() drops absent sellers and stale holdings', () {
    final picks = {'s1': 'b', 's9': 'x', 's2': 'gone'};
    final usable = [c('b', 'STORE', 's1'), c('e', 'STORE', 's2')];
    expect(pruneStorePicks(picks, {'s1', 's2'}, usable), {'s1': 'b'});
  });
}
