// NEW-22: the test double for keychain token storage round-trips without
// touching platform channels.
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_partner/services/token_store.dart';

void main() {
  test('MemoryTokenStore round-trips and deletes', () async {
    final store = MemoryTokenStore();
    expect(await store.read('k'), isNull);
    await store.write('k', 'jwt-1');
    expect(await store.read('k'), 'jwt-1');
    await store.write('k', 'jwt-2');
    expect(await store.read('k'), 'jwt-2');
    await store.delete('k');
    expect(await store.read('k'), isNull);
  });
}
