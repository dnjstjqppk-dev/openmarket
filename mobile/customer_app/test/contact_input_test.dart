// N-05: contact validators accept real KR numbers and reject junk the old
// presence-only checks (and the old char-class regex) let through.
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_customer/models/contact_input.dart';

void main() {
  test('valid phones pass', () {
    for (final p in ['010-1234-5678', '01012345678', '02-123-4567', '031 900 1234', '011-123-4567']) {
      expect(validateKrPhone(p), isNull, reason: p);
    }
  });

  test('junk phones fail', () {
    for (final p in ['', '+++', '+++++++++', 'abc-def-ghij', '12345', '010-1234-56789012345', '1-800-0000']) {
      expect(validateKrPhone(p), isNotNull, reason: p);
    }
  });

  test('postal codes pass and fail', () {
    expect(validateKrPostal('06236'), isNull);
    for (final p in ['', '1234', '123456', 'ABCDE', '0623a']) {
      expect(validateKrPostal(p), isNotNull, reason: p);
    }
  });
}
