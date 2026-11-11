// N-05: checkout contact validation shared by the cart form. Mirrors the
// server contract (services/orders.js parseAddress): phone digits start with
// 0 and run 9-11 digits; postal code is exactly 5 digits.

String digitsOnly(String v) => v.replaceAll(RegExp(r'\D'), '');

/// Returns an error message, or null when the phone is acceptable.
String? validateKrPhone(String? v) {
  final d = digitsOnly(v ?? '');
  if (!RegExp(r'^0\d{8,10}$').hasMatch(d)) {
    return '연락처를 숫자로 입력해 주세요 (예: 010-1234-5678)';
  }
  return null;
}

/// Returns an error message, or null when the postal code is acceptable.
String? validateKrPostal(String? v) {
  if (!RegExp(r'^\d{5}$').hasMatch((v ?? '').trim())) {
    return '우편번호 5자리를 입력해 주세요';
  }
  return null;
}
